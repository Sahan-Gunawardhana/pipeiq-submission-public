import NetInfo from "@react-native-community/netinfo";
import { addRepairToPipelineFromMobile, uploadRepairImages } from "./firebase";
import { addRepairLog } from "./repairLogs";
import { getQueuedRepairs, setQueuedRepairs } from "./repairQueue";

let syncInProgress = false;

export interface RepairSyncState {
  isSyncing: boolean;
  trigger: "app-start" | "reconnect" | "manual" | null;
  pendingCount: number;
  processedCount: number;
  syncedCount: number;
  failedCount: number;
}

const initialSyncState: RepairSyncState = {
  isSyncing: false,
  trigger: null,
  pendingCount: 0,
  processedCount: 0,
  syncedCount: 0,
  failedCount: 0,
};

let currentSyncState: RepairSyncState = { ...initialSyncState };
const syncSubscribers = new Set<(state: RepairSyncState) => void>();

const publishSyncState = () => {
  for (const subscriber of syncSubscribers) {
    subscriber(currentSyncState);
  }
};

const setSyncState = (nextState: Partial<RepairSyncState>) => {
  currentSyncState = {
    ...currentSyncState,
    ...nextState,
  };
  publishSyncState();
};

export const subscribeToRepairSyncState = (
  callback: (state: RepairSyncState) => void,
): (() => void) => {
  syncSubscribers.add(callback);
  callback(currentSyncState);

  return () => {
    syncSubscribers.delete(callback);
  };
};

export const getRepairSyncState = (): RepairSyncState => ({
  ...currentSyncState,
});

export interface RepairSyncSummary {
  pendingCount: number;
  syncedCount: number;
  failedCount: number;
}

export const syncQueuedRepairs = async (
  trigger: "app-start" | "reconnect" | "manual" = "manual",
): Promise<RepairSyncSummary> => {
  if (syncInProgress) {
    return { pendingCount: 0, syncedCount: 0, failedCount: 0 };
  }

  const netState = await NetInfo.fetch();
  const isOnlineNow =
    !!netState.isConnected && netState.isInternetReachable !== false;

  if (!isOnlineNow) {
    return { pendingCount: 0, syncedCount: 0, failedCount: 0 };
  }

  syncInProgress = true;

  try {
    const queued = await getQueuedRepairs();

    if (!queued.length) {
      setSyncState({
        ...initialSyncState,
        isSyncing: false,
        trigger: null,
      });
      return { pendingCount: 0, syncedCount: 0, failedCount: 0 };
    }

    setSyncState({
      isSyncing: true,
      trigger,
      pendingCount: queued.length,
      processedCount: 0,
      syncedCount: 0,
      failedCount: 0,
    });

    await addRepairLog({
      level: "info",
      action: "repair_sync_start",
      stage: "queue",
      status: "start",
      message: `trigger=${trigger}`,
      metadata: {
        pendingCount: queued.length,
      },
    });

    const syncedIds = new Set<string>();
    const failedById = new Map<string, string>();

    for (const item of queued) {
      try {
        await addRepairLog({
          level: "info",
          action: "repair_sync_item_start",
          stage: "queue",
          status: "start",
          repairId: item.repairId,
          pipelineId: item.pipelineId,
        });

        let imageUrls: string[] = [];
        if (item.images.length > 0) {
          imageUrls = await uploadRepairImages({
            pipelineId: item.pipelineId,
            repairId: item.repairId,
            imageData: item.images,
          });
        }

        const result = await addRepairToPipelineFromMobile({
          latitude: item.formData.latitude,
          longitude: item.formData.longitude,
          issueType: item.formData.issueType,
          severity: item.formData.severity,
          flowRate: item.formData.flowRate,
          notes: item.formData.notes,
          depthM: item.formData.depthM,
          repairId: item.repairId,
          imageUrls,
          pipelineId: item.pipelineId,
        });

        syncedIds.add(item.id);

        if ((result as any)?.wasDuplicate) {
          await addRepairLog({
            level: "info",
            action: "repair_sync_item_duplicate",
            stage: "queue",
            status: "success",
            repairId: item.repairId,
            pipelineId: item.pipelineId,
            message: "Duplicate repairId detected; skipped duplicate write",
          });
        } else {
          await addRepairLog({
            level: "info",
            action: "repair_sync_item_success",
            stage: "queue",
            status: "success",
            repairId: item.repairId,
            pipelineId: item.pipelineId,
          });
        }

        setSyncState({
          processedCount:
            currentSyncState.processedCount + 1,
          syncedCount: currentSyncState.syncedCount + 1,
        });
      } catch (error: any) {
        failedById.set(item.id, new Date().toISOString());

        await addRepairLog({
          level: "error",
          action: "repair_sync_item_failed",
          stage: "queue",
          status: "failed",
          repairId: item.repairId,
          pipelineId: item.pipelineId,
          message: error?.message || "Unknown sync error",
        });

        setSyncState({
          processedCount:
            currentSyncState.processedCount + 1,
          failedCount: currentSyncState.failedCount + 1,
        });
      }
    }

    const nextQueue = queued
      .filter((item) => !syncedIds.has(item.id))
      .map((item) =>
        failedById.has(item.id)
          ? {
            ...item,
            lastAttemptAt: failedById.get(item.id) || item.lastAttemptAt,
          }
          : item,
      );

    await setQueuedRepairs(nextQueue);

    const summary = {
      pendingCount: queued.length,
      syncedCount: syncedIds.size,
      failedCount: failedById.size,
    };

    await addRepairLog({
      level: "info",
      action: "repair_sync_complete",
      stage: "queue",
      status: "success",
      metadata: summary,
    });

    return summary;
  } finally {
    syncInProgress = false;
    setSyncState({
      ...initialSyncState,
      isSyncing: false,
      trigger: null,
    });
  }
};
