import { savePipelineToFirestore } from '@/lib/firebase';
import { backendApiUrl } from '@/lib/backend-api';

export interface QueuePipelineItem {
    id: string;
    pipelineId?: string;
    predictionStatus?: 'pending' | 'complete';
    status?: string;
    riskScore?: number;
    riskLevel?: string;
    risk_score?: number;
    confidence_score?: number;
    risk_band?: string;
    confidence_band?: string;
    retryCount?: number;
    apiFailureCycle?: number;
    nextAttemptAt?: number;
    lastError?: string | null;
    retryNotified?: boolean;
    [key: string]: any;
}

interface ScoringResponse {
    pipelineId: string;
    risk_score: number;
    confidence_score: number;
    risk_band: string;
    confidence_band: string;
    riskScore?: number;
    riskLevel?: string;
    modelVersion?: string;
    processedAt?: string;
    degraded?: boolean;
    fallbackReason?: string;
}

const PIPELINE_QUEUE_KEY = 'pipeiq-pipeline-queue';
const QUEUE_MAX_ITEMS = 20;
const PROCESS_INTERVAL_MS = 10_000;
const RETRY_DELAYS_MS = [
    10_000,           // 10s
    20_000,           // 20s
    30_000,           // 30s
    60_000,           // 1m
    2 * 60_000,       // 2m
    4 * 60_000,       // 4m
    16 * 60_000,      // 16m
];

let processorInterval: ReturnType<typeof setInterval> | null = null;
let isTickRunning = false;
let runPredictHandler: (() => void) | null = null;
let runPredictForceHandler: (() => void) | null = null;
let completionClearTimer: ReturnType<typeof setTimeout> | null = null;
let hasActiveRecoveryCycle = false;

const now = () => Date.now();

const formatRetryDelay = (ms: number) => {
    const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins < 60) return secs ? `${mins}m ${secs}s` : `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins ? `${hours}h ${remMins}m` : `${hours}h`;
};

const getRetryDelayMs = (retryCount: number) => {
    const idx = Math.max(0, Math.min(retryCount - 1, RETRY_DELAYS_MS.length - 1));
    return RETRY_DELAYS_MS[idx];
};

const sanitizeForFirestore = (value: unknown): unknown => {
    if (value === undefined) return null;
    if (value === null) return null;
    if (Array.isArray(value)) return value.map((item) => sanitizeForFirestore(item));
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'object') {
        const output: Record<string, unknown> = {};
        Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
            if (item === undefined) return;
            output[key] = sanitizeForFirestore(item);
        });
        return output;
    }
    return value;
};

const getQueue = (): QueuePipelineItem[] => {
    try {
        const raw = localStorage.getItem(PIPELINE_QUEUE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const setQueue = (queue: QueuePipelineItem[]) => {
    localStorage.setItem(PIPELINE_QUEUE_KEY, JSON.stringify(queue));
    localStorage.setItem(
        'pipeiq_pending_count',
        String(queue.filter((item) => !isCompletedItem(item)).length),
    );
    window.dispatchEvent(new Event('pipeiq_pending_updated'));
    window.dispatchEvent(new Event('pipeiq_queue_updated'));
};

const isCompletedItem = (item: QueuePipelineItem) => {
    return item.status === 'scored' || item.predictionStatus === 'complete';
};

const getPendingQueue = (queue: QueuePipelineItem[]) => {
    return queue.filter((item) => !isCompletedItem(item));
};

const clearCompletionTimer = () => {
    if (completionClearTimer) {
        clearTimeout(completionClearTimer);
        completionClearTimer = null;
    }
};

const scheduleQueueClearIfComplete = (queue: QueuePipelineItem[]) => {
    clearCompletionTimer();
    if (queue.length === 0 || queue.some((item) => !isCompletedItem(item))) return;

    completionClearTimer = setTimeout(() => {
        setQueue([]);
        if (hasActiveRecoveryCycle) {
            window.dispatchEvent(new Event('pipeiq_predictions_complete'));
            hasActiveRecoveryCycle = false;
        }
        completionClearTimer = null;
    }, 700);
};

const moveItemToBack = (queue: QueuePipelineItem[], id: string, patch: Partial<QueuePipelineItem>) => {
    const idx = queue.findIndex((entry) => (entry.id || entry.pipelineId) === id);
    if (idx < 0) return queue;
    const item = queue[idx];
    const without = queue.filter((_, i) => i !== idx);
    return [...without, { ...item, ...patch }];
};

const notifyRetryOnce = (item: QueuePipelineItem, nextAttemptAtOverride?: number) => {
    if (item.retryNotified) return;
    hasActiveRecoveryCycle = true;
    // Minimal one-time notification per item; avoid spam.
    const nextAttemptAt = Number(nextAttemptAtOverride ?? item.nextAttemptAt ?? 0);
    const remainingMs = Math.max(0, nextAttemptAt - now());
    const retryIn = formatRetryDelay(remainingMs);
    window.dispatchEvent(new CustomEvent('pipeiq_queue_retrying', {
        detail: {
            pipelineId: item.id || item.pipelineId,
            message: `Pipeline queued. Service unavailable, retrying in ${retryIn}.`,
        },
    }));
};

const hasScoreData = (item: QueuePipelineItem) => {
    return Number.isFinite(Number(item.risk_score))
        || Number.isFinite(Number(item.riskScore))
        || typeof item.risk_band === 'string'
        || typeof item.confidence_band === 'string';
};

const scoreWithBackend = async (pipeline: QueuePipelineItem): Promise<ScoringResponse> => {
    const response = await fetch(backendApiUrl('/api/score-pipeline'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pipeline),
        signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`API ${response.status}: ${details || 'score failed'}`);
    }

    return (await response.json()) as ScoringResponse;
};

const saveToFirebase = async (pipeline: QueuePipelineItem): Promise<void> => {
    const cleaned = sanitizeForFirestore({
        ...pipeline,
        predictionStatus: 'complete',
        status: 'scored',
        updatedAt: new Date().toISOString(),
    }) as Record<string, unknown>;

    await savePipelineToFirestore(cleaned);
};

export async function attemptImmediateScore(pipeline: QueuePipelineItem): Promise<boolean> {
    try {
        const score = await scoreWithBackend(pipeline);
        const scored: QueuePipelineItem = {
            ...pipeline,
            ...score,
            predictionStatus: 'complete',
            status: 'scored',
            riskScore: score.riskScore ?? Math.round((Number(score.risk_score) || 0) * 100),
            riskLevel: score.riskLevel ?? score.risk_band,
            lastError: null,
            retryCount: 0,
            nextAttemptAt: undefined,
            retryNotified: false,
        };

        await saveToFirebase(scored);

        // Keep the scored item so the sidebar can show progress until the batch is done.
        const itemId = pipeline.id || pipeline.pipelineId;
        const queue = getQueue();
        const nextQueue: QueuePipelineItem[] = queue.map((entry) => {
            const entryId = entry.id || entry.pipelineId;
            if (entryId !== itemId) return entry;
            return {
                ...entry,
                ...scored,
                source: 'firebase',
                status: 'scored',
                predictionStatus: 'complete',
                retryCount: 0,
                nextAttemptAt: undefined,
                lastError: null,
                retryNotified: false,
            };
        });
        setQueue(nextQueue);

        window.dispatchEvent(new Event('pipeiq_pipeline_saved'));
        window.dispatchEvent(new Event('pipeiq_map_layers_updated'));
        window.dispatchEvent(new Event('pipeiq_queue_updated'));

        scheduleQueueClearIfComplete(nextQueue);

        // Restart processor from the start to process any remaining pending items.
        if (getPendingQueue(nextQueue).length > 0) {
            setTimeout(() => processNextInQueue(true), 50);
        }

        return true;
    } catch (error) {
        // Immediate score failed; item stays in queue for scheduled retry
        return false;
    }
}

const nextRetryPatch = (item: QueuePipelineItem, message: string): Partial<QueuePipelineItem> => {
    const nextRetryCount = Number(item.retryCount || 0) + 1;
    return {
        status: 'pending-retry',
        retryCount: nextRetryCount,
        nextAttemptAt: now() + getRetryDelayMs(nextRetryCount),
        lastError: message,
        retryNotified: true,
    };
};

async function processNextInQueue(force = false): Promise<void> {
    if (isTickRunning) return;
    isTickRunning = true;

    try {
        const queue = getQueue();
        if (queue.length === 0) {
            clearCompletionTimer();
            localStorage.setItem('pipeiq_pending_count', '0');
            window.dispatchEvent(new Event('pipeiq_pending_updated'));
            return;
        }

        // Keep hard cap if legacy queue already exceeded.
        if (queue.length > QUEUE_MAX_ITEMS) {
            setQueue(queue.slice(0, QUEUE_MAX_ITEMS));
            return;
        }

        const nextIndex = queue.findIndex((entry) => {
            if (isCompletedItem(entry)) return false;
            if (force) return true;
            const notBefore = Number(entry.nextAttemptAt || 0);
            return notBefore <= now();
        });

        if (nextIndex < 0) {
            scheduleQueueClearIfComplete(queue);
            return;
        }

        const item = queue[nextIndex];
        const itemId = item.id || item.pipelineId;
        if (!itemId) {
            const withoutInvalid = queue.filter((_, index) => index !== nextIndex);
            setQueue(withoutInvalid);
            return;
        }

        try {
            let working = item;
            const hadPreviousFailure = Number(item.retryCount || 0) > 0 || !!item.lastError;

            // If score already exists, skip API and retry Firebase write only.
            if (!hasScoreData(working)) {
                const score = await scoreWithBackend(working);
                working = {
                    ...working,
                    ...score,
                    predictionStatus: 'complete',
                    status: 'scored',
                    riskScore: score.riskScore ?? Math.round((Number(score.risk_score) || 0) * 100),
                    riskLevel: score.riskLevel ?? score.risk_band,
                    lastError: null,
                    retryCount: 0,
                    nextAttemptAt: undefined,
                    retryNotified: false,
                };
            }

            await saveToFirebase(working);

            const nextQueue: QueuePipelineItem[] = getQueue().map((entry) => {
                const entryId = entry.id || entry.pipelineId;
                if (entryId !== itemId) return entry;
                return {
                    ...entry,
                    ...working,
                    source: 'firebase',
                    status: 'scored',
                    predictionStatus: 'complete',
                    retryCount: 0,
                    nextAttemptAt: undefined,
                    lastError: null,
                    retryNotified: false,
                };
            });
            setQueue(nextQueue);
            window.dispatchEvent(new Event('pipeiq_pipeline_saved'));
            window.dispatchEvent(new Event('pipeiq_map_layers_updated'));
            window.dispatchEvent(new Event('pipeiq_queue_updated'));
            if (hadPreviousFailure) {
                window.dispatchEvent(new CustomEvent('pipeiq_queue_recovered', {
                    detail: {
                        pipelineId: itemId,
                        message: 'System back online. Queue processing resumed.',
                    },
                }));
            }

            scheduleQueueClearIfComplete(nextQueue);

            if (getPendingQueue(nextQueue).length > 0) {
                setTimeout(() => processNextInQueue(true), 50);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const latestQueue = getQueue();
            const currentItem = latestQueue.find((entry) => (entry.id || entry.pipelineId) === itemId) || item;

            if (hasScoreData(currentItem)) {
                // Score exists -> Firebase failed path.
                const patch = nextRetryPatch(currentItem, `firebase:${message}`);
                const patchedQueue = moveItemToBack(latestQueue, itemId, patch);
                setQueue(patchedQueue);
                notifyRetryOnce(currentItem, patch.nextAttemptAt);
            } else {
                // API failed path.
                const patch = nextRetryPatch(currentItem, `api:${message}`);
                const patchedQueue = moveItemToBack(latestQueue, itemId, patch);
                setQueue(patchedQueue);
                notifyRetryOnce(currentItem, patch.nextAttemptAt);
            }
        }
    } finally {
        isTickRunning = false;
    }
}

export async function processPipelineQueue(): Promise<void> {
    await processNextInQueue();
}

export function startQueueProcessor(): void {
    if (processorInterval) clearInterval(processorInterval);
    clearCompletionTimer();

    processorInterval = setInterval(() => {
        processNextInQueue();
    }, PROCESS_INTERVAL_MS);

    if (runPredictHandler) {
        window.removeEventListener('pipeiq_run_predict', runPredictHandler);
    }

    runPredictHandler = () => {
        setTimeout(() => {
            processNextInQueue();
        }, 50);
    };

    runPredictForceHandler = () => {
        setTimeout(() => {
            processNextInQueue(true);
        }, 50);
    };

    window.addEventListener('pipeiq_run_predict', runPredictHandler);
    window.addEventListener('pipeiq_run_predict_force', runPredictForceHandler);
    processNextInQueue();
}

export function stopQueueProcessor(): void {
    if (processorInterval) {
        clearInterval(processorInterval);
        processorInterval = null;
    }
    clearCompletionTimer();
    if (runPredictHandler) {
        window.removeEventListener('pipeiq_run_predict', runPredictHandler);
        runPredictHandler = null;
    }
    if (runPredictForceHandler) {
        window.removeEventListener('pipeiq_run_predict_force', runPredictForceHandler);
        runPredictForceHandler = null;
    }
}
