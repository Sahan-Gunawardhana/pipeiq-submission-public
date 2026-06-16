import AsyncStorage from "@react-native-async-storage/async-storage";

export type QueuedRepairStatus = "pending";

export interface QueuedRepairImage {
  uri: string;
  fileName: string;
}

export interface QueuedRepairFormData {
  latitude: number;
  longitude: number;
  issueType: string;
  severity: string;
  flowRate: string;
  notes: string;
  depthM?: number;
}

export interface QueuedRepairItem {
  id: string;
  repairId: string;
  pipelineId: string;
  status: QueuedRepairStatus;
  createdAt: string;
  lastAttemptAt: string | null;
  formData: QueuedRepairFormData;
  images: QueuedRepairImage[];
}

const REPAIR_QUEUE_STORAGE_KEY = "@nrw_repair_queue";

const parseQueue = (value: string | null): QueuedRepairItem[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as QueuedRepairItem[]) : [];
  } catch (_error) {
    return [];
  }
};

export const getQueuedRepairs = async (): Promise<QueuedRepairItem[]> => {
  try {
    const value = await AsyncStorage.getItem(REPAIR_QUEUE_STORAGE_KEY);
    return parseQueue(value);
  } catch (error) {
    console.warn("[RepairQueue] Failed to load queue", error);
    return [];
  }
};

export const setQueuedRepairs = async (
  items: QueuedRepairItem[],
): Promise<void> => {
  try {
    await AsyncStorage.setItem(REPAIR_QUEUE_STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.warn("[RepairQueue] Failed to persist queue", error);
    throw error;
  }
};

export const enqueueRepair = async (
  input: Omit<QueuedRepairItem, "id" | "createdAt" | "status" | "lastAttemptAt">,
): Promise<{ item: QueuedRepairItem; queueDepth: number }> => {
  const nextItem: QueuedRepairItem = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    lastAttemptAt: null,
    ...input,
  };

  try {
    const existing = await getQueuedRepairs();
    const nextQueue = [...existing, nextItem];
    await setQueuedRepairs(nextQueue);
    return { item: nextItem, queueDepth: nextQueue.length };
  } catch (error) {
    console.warn("[RepairQueue] Failed to enqueue repair", error);
    throw error;
  }
};

export const clearRepairQueue = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(REPAIR_QUEUE_STORAGE_KEY);
  } catch (error) {
    console.warn("[RepairQueue] Failed to clear queue", error);
  }
};

export const REPAIR_QUEUE_KEY = REPAIR_QUEUE_STORAGE_KEY;