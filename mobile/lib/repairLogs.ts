import AsyncStorage from "@react-native-async-storage/async-storage";

export type RepairLogLevel = "info" | "error";
export type RepairLogStage = "submit" | "upload" | "firestore" | "queue";
export type RepairLogStatus = "start" | "success" | "failed";

export interface RepairLogEntry {
  id: string;
  timestamp: string;
  level: RepairLogLevel;
  action: string;
  stage: RepairLogStage;
  status: RepairLogStatus;
  repairId?: string;
  pipelineId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

const REPAIR_LOGS_STORAGE_KEY = "@nrw_repair_logs";
const MAX_REPAIR_LOGS = 100;

const parseLogs = (value: string | null): RepairLogEntry[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as RepairLogEntry[]) : [];
  } catch (_error) {
    return [];
  }
};

export const addRepairLog = async (
  entry: Omit<RepairLogEntry, "id" | "timestamp">,
): Promise<RepairLogEntry> => {
  const timestamp = new Date().toISOString();
  const created: RepairLogEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp,
    ...entry,
  };

  try {
    const existing = parseLogs(
      await AsyncStorage.getItem(REPAIR_LOGS_STORAGE_KEY),
    );
    const nextLogs = [...existing, created].slice(-MAX_REPAIR_LOGS);
    await AsyncStorage.setItem(REPAIR_LOGS_STORAGE_KEY, JSON.stringify(nextLogs));
  } catch (error) {
    console.warn("[RepairLogs] Failed to persist log", error);
  }

  return created;
};

export const getRepairLogs = async (): Promise<RepairLogEntry[]> => {
  try {
    return parseLogs(await AsyncStorage.getItem(REPAIR_LOGS_STORAGE_KEY));
  } catch (error) {
    console.warn("[RepairLogs] Failed to load logs", error);
    return [];
  }
};

export const clearRepairLogs = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(REPAIR_LOGS_STORAGE_KEY);
  } catch (error) {
    console.warn("[RepairLogs] Failed to clear logs", error);
  }
};

export const REPAIR_LOGS_KEY = REPAIR_LOGS_STORAGE_KEY;