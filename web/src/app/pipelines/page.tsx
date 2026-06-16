"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Download,
  ArrowUpDown,
  Trash2,
  Edit2,
  Loader2,
  History,
  X,
  AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import RiskBadge from "@/components/ui/RiskBadge";
import { toast } from "sonner";
import { app } from "@/lib/firebase";
import { backendApiUrl } from "@/lib/backend-api";
import {
  getFirestore,
  collection,
  doc,
  deleteDoc,
  updateDoc,
  onSnapshot,
} from "firebase/firestore";

interface PipelineRow {
  id: string;
  zoneId: string;
  startLocation?: string;
  endLocation?: string;
  material: string;
  age: number;
  diameter?: number;
  repairs?: number;
  confidence?: number;
  riskScore: number;
  riskBand?: "Low" | "Medium" | "High";
  confidenceBand?: "Low" | "Medium" | "High";
  risk_score?: number;
  confidence_score?: number;
  repair_history?: RepairHistoryEntry[];
  lastRepairAt?: unknown;
  lastRepairType?: string;
  otherData?: any;
  modelOutput?: any;
  scoringRequest?: any;
  scorePayload?: any;
  status: string;
  predictionStatus: "pending" | "complete";
  createdAt?: string;
  createdAtEpoch?: number;
  localPresent: boolean;
  firebaseRefs: Array<{ collection: string; docId: string }>;
}

interface RepairHistoryEntry {
  repairId?: string;
  issueType?: string;
  repairType?: string;
  severity?: string;
  flowRate?: string | number;
  waterLoss?: string | number;
  notes?: string;
  depthM?: number;
  source?: string;
  imageUrls?: string[];
  imageUrl?: string;
  createdAt?: unknown;
  timestamp?: unknown;
  repairedAt?: unknown;
  repairAt?: unknown;
  date?: unknown;
  createdAtIso?: string;
  createdAtMs?: number;
}

interface PipelineDetailsDraft {
  id: string;
  startLocation: string;
  endLocation: string;
  dmaId: string;
  installationYear: string;
  material: string;
  diameter: string;
  pipeLengthM: string;
  roadCategory: string;
  elevationM: string;
  operatingPressure: string;
  pastRepairs: string;
  soilType: string;
  depthM: string;
}

const db = getFirestore(app);
const PIPELINE_QUEUE_KEY = "pipeiq-pipeline-queue";
const PIPELINES_CACHE_KEY = "pipeiq-pipelines-cache";

const deriveRiskBand = (
  rawBand: unknown,
  score100: number,
  score01?: number,
): "Low" | "Medium" | "High" => {
  if (rawBand === "Low" || rawBand === "Medium" || rawBand === "High")
    return rawBand;
  if (Number.isFinite(score01)) {
    if ((score01 as number) >= 0.5) return "High";
    if ((score01 as number) >= 0.27) return "Medium";
    return "Low";
  }
  if (score100 >= 75) return "High";
  if (score100 >= 40) return "Medium";
  return "Low";
};

const deriveConfidenceBand = (
  rawBand: unknown,
  score01?: number,
): "Low" | "Medium" | "High" => {
  if (rawBand === "Low" || rawBand === "Medium" || rawBand === "High")
    return rawBand;
  if (Number.isFinite(score01)) {
    if ((score01 as number) >= 0.5) return "High";
    if ((score01 as number) >= 0.2) return "Medium";
  }
  return "Low";
};

const toDateFromValue = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object") {
    const candidate = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof candidate.toDate === "function") {
      const parsed = candidate.toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime())
        ? parsed
        : null;
    }
    if (Number.isFinite(candidate.seconds)) {
      const parsed = new Date(
        (candidate.seconds ?? 0) * 1000 + (candidate.nanoseconds ?? 0) / 1e6,
      );
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  return null;
};

const getRepairHistoryEntryDate = (entry: RepairHistoryEntry) => {
  return (
    toDateFromValue(entry.createdAt) ||
    toDateFromValue(entry.createdAtIso) ||
    toDateFromValue(entry.createdAtMs) ||
    toDateFromValue(entry.timestamp) ||
    toDateFromValue(entry.repairedAt) ||
    toDateFromValue(entry.repairAt) ||
    toDateFromValue(entry.date)
  );
};

const formatRepairHistoryDate = (entry: RepairHistoryEntry) => {
  const date = getRepairHistoryEntryDate(entry);
  return date ? date.toLocaleString() : "Unknown date";
};

const normalizeRepairHistory = (value: unknown): RepairHistoryEntry[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is RepairHistoryEntry =>
        !!entry && typeof entry === "object",
    )
    .map((entry) => ({
      ...entry,
      imageUrls: [
        ...(Array.isArray(entry.imageUrls) ? entry.imageUrls : []),
        ...(typeof entry.imageUrl === "string" ? [entry.imageUrl] : []),
      ].filter(
        (url): url is string =>
          typeof url === "string" && url.trim().length > 0,
      ),
    }))
    .sort((a, b) => {
      const aTime = getRepairHistoryEntryDate(a)?.getTime() ?? 0;
      const bTime = getRepairHistoryEntryDate(b)?.getTime() ?? 0;
      return bTime - aTime;
    });
};

const buildScoringRequestFromProps = (props: any, pipelineId?: string) => {
  const installYear = Number(props?.install_year ?? props?.installationYear);
  const diameterMm = Number(props?.diameter_mm ?? props?.diameter);
  const pipeLengthM = Number(props?.pipe_length_m ?? props?.pipeLengthM);
  const elevationM = Number(props?.elevation_m ?? props?.elevationM);
  const pressureBar = Number(props?.pressure_bar ?? props?.operatingPressure);
  const repairs = Number(
    props?.n_past_repairs ?? props?.pastRepairs ?? props?.repairs,
  );
  const depthM = Number(props?.depth_m ?? props?.depthM);

  const req = {
    pipe_id:
      props?.pipe_id || props?.id || props?.pipelineId || pipelineId || null,
    dma_id:
      props?.zoneId || props?.zone || props?.dma_id || props?.dmaId || null,
    install_year: Number.isFinite(installYear) ? installYear : undefined,
    material: props?.material || undefined,
    diameter_mm: Number.isFinite(diameterMm) ? diameterMm : undefined,
    pipe_length_m: Number.isFinite(pipeLengthM) ? pipeLengthM : undefined,
    road_category: props?.road_category || props?.roadCategory || undefined,
    elevation_m: Number.isFinite(elevationM) ? elevationM : undefined,
    pressure_bar: Number.isFinite(pressureBar) ? pressureBar : undefined,
    n_past_repairs: Number.isFinite(repairs) ? repairs : undefined,
    soil_type: props?.soil_type || props?.soilType || undefined,
    depth_m: Number.isFinite(depthM) ? depthM : undefined,
  };

  const hasAny = Object.values(req).some(
    (value) => value !== undefined && value !== null && value !== "",
  );
  return hasAny ? req : null;
};

const buildStablePipelineId = (props: any, coords: [number, number][]) => {
  if (props?.id) return props.id;
  if (props?.pipelineId) return props.pipelineId;
  if (Array.isArray(coords) && coords.length > 1) {
    const start = coords[0];
    const end = coords[coords.length - 1];
    const startKey = `${Number(start[1]).toFixed(5)}_${Number(start[0]).toFixed(5)}`;
    const endKey = `${Number(end[1]).toFixed(5)}_${Number(end[0]).toFixed(5)}`;
    const material = props?.material || "NA";
    const year = props?.installationYear || "NA";
    return `PL-${startKey}-${endKey}-${material}-${year}`;
  }
  return `PL-${Math.random().toString(36).slice(2, 10)}`;
};

const loadPipelinesFromMapStorage = (): PipelineRow[] => {
  try {
    const raw = localStorage.getItem("pipeiq-map-layers");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const features = Array.isArray(parsed?.features) ? parsed.features : [];
    let localMutated = false;

    const mapped = features
      .filter((feature: any) => feature?.geometry?.type === "LineString")
      .map((feature: any) => {
        const props = feature?.properties || {};
        const coords: [number, number][] = feature?.geometry?.coordinates || [];
        const installationYear = Number(props.installationYear);
        const age = Number.isFinite(installationYear)
          ? Math.max(new Date().getFullYear() - installationYear, 0)
          : 0;

        const id = buildStablePipelineId(props, coords);
        if (!props.id) {
          props.id = id;
          feature.properties = props;
          localMutated = true;
        }

        const predictionStatus: "pending" | "complete" =
          props.predictionStatus === "pending" ? "pending" : "complete";
        const riskScore01 = Number.isFinite(Number(props.risk_score))
          ? Number(props.risk_score)
          : undefined;
        const scoringRequest =
          props.scoringRequest ||
          props.scorePayload?.scoringRequest ||
          buildScoringRequestFromProps(props, id);
        const riskScore = Number.isFinite(Number(props.riskScore))
          ? Number(props.riskScore)
          : Number.isFinite(riskScore01)
            ? Math.round((riskScore01 as number) * 100)
            : predictionStatus === "pending"
              ? 0
              : 35;
        const confidenceScore01 = Number.isFinite(
          Number(props.confidence_score),
        )
          ? Number(props.confidence_score)
          : undefined;

        return {
          id,
          zoneId:
            props.zoneId ||
            props.zone ||
            props.dma_id ||
            props.dmaId ||
            scoringRequest?.dma_id ||
            "N/A",
          startLocation:
            props.startLocation || props.startPoint || props.start || "",
          endLocation: props.endLocation || props.endPoint || props.end || "",
          material: props.material || "Unknown",
          age,
          diameter: Number.isFinite(Number(props.diameter))
            ? Number(props.diameter)
            : undefined,
          repairs: Number.isFinite(Number(props.repairs ?? props.pastRepairs))
            ? Number(props.repairs ?? props.pastRepairs)
            : undefined,
          confidence: Number.isFinite(Number(props.confidence))
            ? Number(props.confidence)
            : undefined,
          riskScore,
          riskBand: deriveRiskBand(
            props.risk_band || props.riskLevel,
            riskScore,
            riskScore01,
          ),
          confidenceBand: deriveConfidenceBand(
            props.confidence_band,
            confidenceScore01,
          ),
          risk_score: riskScore01,
          confidence_score: confidenceScore01,
          repair_history: normalizeRepairHistory(props.repair_history),
          lastRepairAt: props.lastRepairAt || null,
          lastRepairType: props.lastRepairType || undefined,
          otherData:
            props.otherData ||
            props.other_data ||
            props.scorePayload?.otherData ||
            props.scorePayload?.other_data ||
            null,
          modelOutput:
            props.modelOutput ||
            props.scorePayload?.modelOutput ||
            props.scorePayload ||
            null,
          scoringRequest,
          scorePayload: props.scorePayload || null,
          status:
            predictionStatus === "pending" ? "Under Maintenance" : "Active",
          predictionStatus,
          createdAt: props.createdAt
            ? new Date(
                props.createdAt.toMillis?.() || props.createdAt,
              ).toLocaleDateString()
            : undefined,
          createdAtEpoch:
            props.createdAt?.toMillis?.() ||
            (typeof props.createdAt === "number" ? props.createdAt : undefined),
          localPresent: true,
          firebaseRefs: [],
        } as PipelineRow;
      });

    if (localMutated) {
      localStorage.setItem("pipeiq-map-layers", JSON.stringify(parsed));
    }

    return mapped;
  } catch {
    return [];
  }
};

const loadPipelinesFromQueueStorage = (): PipelineRow[] => {
  try {
    const queue = JSON.parse(
      localStorage.getItem(PIPELINE_QUEUE_KEY) || "[]",
    ) as any[];
    return queue.map((item: any) => {
      const installationYear = Number(item.installationYear);
      const age = Number.isFinite(installationYear)
        ? Math.max(new Date().getFullYear() - installationYear, 0)
        : 0;
      const predictionStatus: "pending" | "complete" =
        item?.predictionStatus === "complete" ? "complete" : "pending";
      const riskScore01 = Number.isFinite(Number(item?.risk_score))
        ? Number(item.risk_score)
        : undefined;
      const scoringRequest =
        item?.scoringRequest ||
        item?.scorePayload?.scoringRequest ||
        buildScoringRequestFromProps(item, item?.id || item?.pipelineId);
      const riskScore = Number.isFinite(Number(item?.riskScore))
        ? Number(item.riskScore)
        : Number.isFinite(riskScore01)
          ? Math.round((riskScore01 as number) * 100)
          : 0;
      const confidenceScore01 = Number.isFinite(Number(item?.confidence_score))
        ? Number(item.confidence_score)
        : undefined;

      return {
        id:
          item?.id ||
          item?.pipelineId ||
          `PL-${Math.random().toString(36).slice(2, 10)}`,
        zoneId:
          item?.zoneId ||
          item?.zone ||
          item?.dma_id ||
          item?.dmaId ||
          scoringRequest?.dma_id ||
          "N/A",
        startLocation:
          item?.startLocation || item?.startPoint || item?.start || "",
        endLocation: item?.endLocation || item?.endPoint || item?.end || "",
        material: item?.material || "Unknown",
        age,
        diameter: Number.isFinite(Number(item?.diameter))
          ? Number(item.diameter)
          : undefined,
        repairs: Number.isFinite(Number(item?.repairs ?? item?.pastRepairs))
          ? Number(item.repairs ?? item.pastRepairs)
          : undefined,
        confidence: Number.isFinite(Number(item?.confidence))
          ? Number(item.confidence)
          : undefined,
        riskScore,
        riskBand: deriveRiskBand(
          item?.risk_band || item?.riskLevel,
          riskScore,
          riskScore01,
        ),
        confidenceBand: deriveConfidenceBand(
          item?.confidence_band,
          confidenceScore01,
        ),
        risk_score: riskScore01,
        confidence_score: confidenceScore01,
        otherData:
          item?.otherData ||
          item?.other_data ||
          item?.scorePayload?.otherData ||
          item?.scorePayload?.other_data ||
          null,
        modelOutput:
          item?.modelOutput ||
          item?.scorePayload?.modelOutput ||
          item?.scorePayload ||
          null,
        scoringRequest,
        scorePayload: item?.scorePayload || null,
        status: predictionStatus === "pending" ? "Under Maintenance" : "Active",
        predictionStatus,
        localPresent: true,
        firebaseRefs: [],
      } as PipelineRow;
    });
  } catch {
    return [];
  }
};

const loadCachedFirebaseRows = (): PipelineRow[] => {
  try {
    const raw = localStorage.getItem(PIPELINES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PipelineRow[];
  } catch {
    return [];
  }
};

const loadInitialRows = (): PipelineRow[] => {
  return loadCachedFirebaseRows();
};

const mapFirebaseDocToRow = (
  docId: string,
  collectionName: string,
  data: any,
): PipelineRow | null => {
  const props = data || {};
  // Deserialize geometry if it's stored as a JSON string
  const geometry =
    typeof props.geometry === "string"
      ? (() => {
          try {
            return JSON.parse(props.geometry);
          } catch {
            return null;
          }
        })()
      : props.geometry;
  const coords = geometry?.coordinates || props?.coordinates || [];
  const id = props.id || props.pipelineId || docId;
  const installationYear = Number(props.installationYear);
  const age = Number.isFinite(installationYear)
    ? Math.max(new Date().getFullYear() - installationYear, 0)
    : Number(props.age) || 0;
  const predictionStatus: "pending" | "complete" =
    props.predictionStatus === "pending" || collectionName === "pipelineQueue"
      ? "pending"
      : "complete";
  const riskScore01 = Number.isFinite(Number(props.risk_score))
    ? Number(props.risk_score)
    : undefined;
  const scoringRequest =
    props.scoringRequest ||
    props.scorePayload?.scoringRequest ||
    buildScoringRequestFromProps(props, id);
  const riskScore = Number.isFinite(Number(props.riskScore))
    ? Number(props.riskScore)
    : Number.isFinite(riskScore01)
      ? Math.round((riskScore01 as number) * 100)
      : predictionStatus === "pending"
        ? 0
        : 35;
  const confidenceScore01 = Number.isFinite(Number(props.confidence_score))
    ? Number(props.confidence_score)
    : undefined;

  return {
    id,
    zoneId:
      props.zoneId ||
      props.zone ||
      props.dma_id ||
      props.dmaId ||
      scoringRequest?.dma_id ||
      "N/A",
    startLocation: props.startLocation || props.startPoint || props.start || "",
    endLocation: props.endLocation || props.endPoint || props.end || "",
    material: props.material || "Unknown",
    age,
    diameter: Number.isFinite(Number(props.diameter))
      ? Number(props.diameter)
      : undefined,
    repairs: Number.isFinite(Number(props.repairs ?? props.pastRepairs))
      ? Number(props.repairs ?? props.pastRepairs)
      : undefined,
    confidence: Number.isFinite(Number(props.confidence))
      ? Number(props.confidence)
      : undefined,
    riskScore,
    riskBand: deriveRiskBand(
      props.risk_band || props.riskLevel,
      riskScore,
      riskScore01,
    ),
    confidenceBand: deriveConfidenceBand(
      props.confidence_band,
      confidenceScore01,
    ),
    risk_score: riskScore01,
    confidence_score: confidenceScore01,
    repair_history: normalizeRepairHistory(props.repair_history),
    lastRepairAt: props.lastRepairAt || null,
    lastRepairType: props.lastRepairType || undefined,
    otherData:
      props.otherData ||
      props.other_data ||
      props.scorePayload?.otherData ||
      props.scorePayload?.other_data ||
      null,
    modelOutput:
      props.modelOutput ||
      props.scorePayload?.modelOutput ||
      props.scorePayload ||
      null,
    scoringRequest,
    scorePayload: props.scorePayload || null,
    status: predictionStatus === "pending" ? "Under Maintenance" : "Active",
    predictionStatus,
    createdAt: props.createdAt
      ? new Date(
          props.createdAt.toMillis?.() || props.createdAt,
        ).toLocaleDateString()
      : undefined,
    createdAtEpoch:
      props.createdAt?.toMillis?.() ||
      (typeof props.createdAt === "number" ? props.createdAt : undefined),
    localPresent: false,
    firebaseRefs: [{ collection: collectionName, docId }],
  };
};

const mergeRows = (localRows: PipelineRow[], firebaseRows: PipelineRow[]) => {
  const merged = new Map<string, PipelineRow>();

  const upsert = (incoming: PipelineRow) => {
    const existing = merged.get(incoming.id);
    if (!existing) {
      merged.set(incoming.id, incoming);
      return;
    }

    // Firebase data (complete) wins over local (pending) data
    const useIncoming =
      incoming.predictionStatus === "complete" &&
      existing.predictionStatus === "pending";

    merged.set(incoming.id, {
      ...existing,
      zoneId: incoming.zoneId !== "N/A" ? incoming.zoneId : existing.zoneId,
      startLocation: incoming.startLocation || existing.startLocation,
      endLocation: incoming.endLocation || existing.endLocation,
      material:
        incoming.material !== "Unknown" ? incoming.material : existing.material,
      age: Math.max(existing.age, incoming.age),
      diameter: Number.isFinite(incoming.diameter)
        ? incoming.diameter
        : existing.diameter,
      repairs: Number.isFinite(incoming.repairs)
        ? incoming.repairs
        : existing.repairs,
      confidence: Number.isFinite(incoming.confidence)
        ? incoming.confidence
        : existing.confidence,
      riskScore: useIncoming ? incoming.riskScore : existing.riskScore,
      riskBand: useIncoming ? incoming.riskBand : existing.riskBand,
      confidenceBand: useIncoming
        ? incoming.confidenceBand
        : existing.confidenceBand,
      risk_score: useIncoming ? incoming.risk_score : existing.risk_score,
      confidence_score: useIncoming
        ? incoming.confidence_score
        : existing.confidence_score,
      repair_history:
        (incoming.repair_history?.length ?? 0) > 0
          ? incoming.repair_history
          : existing.repair_history,
      lastRepairAt: incoming.lastRepairAt ?? existing.lastRepairAt,
      lastRepairType: incoming.lastRepairType ?? existing.lastRepairType,
      otherData: incoming.otherData ?? existing.otherData,
      modelOutput: incoming.modelOutput ?? existing.modelOutput,
      scoringRequest: incoming.scoringRequest ?? existing.scoringRequest,
      scorePayload: incoming.scorePayload ?? existing.scorePayload,
      status: useIncoming ? incoming.status : existing.status,
      predictionStatus: useIncoming ? "complete" : existing.predictionStatus,
      createdAt: incoming.createdAt || existing.createdAt,
      createdAtEpoch: Number.isFinite(incoming.createdAtEpoch)
        ? incoming.createdAtEpoch
        : existing.createdAtEpoch,
      localPresent: existing.localPresent || incoming.localPresent,
      firebaseRefs:
        incoming.firebaseRefs.length > 0
          ? incoming.firebaseRefs
          : existing.firebaseRefs,
    });
  };

  // Queue/local rows first (they're being worked on)
  localRows.forEach(upsert);
  // Firebase rows overlay (completed scores)
  firebaseRows.forEach(upsert);

  return Array.from(merged.values());
};

const updateLocalPipelineStorage = (
  pipelineId: string,
  updater: (props: any) => any,
) => {
  const raw = localStorage.getItem("pipeiq-map-layers");
  if (!raw) return;

  const parsed = JSON.parse(raw);
  const features = Array.isArray(parsed?.features) ? parsed.features : [];
  let changed = false;

  parsed.features = features.map((feature: any) => {
    if (feature?.geometry?.type !== "LineString") return feature;
    const props = feature.properties || {};
    const id = buildStablePipelineId(
      props,
      feature?.geometry?.coordinates || [],
    );
    if (id !== pipelineId) return feature;
    changed = true;
    return {
      ...feature,
      properties: updater({ ...props, id }),
    };
  });

  if (changed) {
    localStorage.setItem("pipeiq-map-layers", JSON.stringify(parsed));
    window.dispatchEvent(new Event("pipeiq_pending_updated"));
    window.dispatchEvent(new Event("pipeiq_map_layers_updated"));
  }
};

const removeLocalPipelineStorage = (pipelineId: string) => {
  const raw = localStorage.getItem("pipeiq-map-layers");
  if (!raw) return;

  const parsed = JSON.parse(raw);
  const features = Array.isArray(parsed?.features) ? parsed.features : [];

  parsed.features = features.filter((feature: any) => {
    if (feature?.geometry?.type !== "LineString") return true;
    const props = feature.properties || {};
    const id = buildStablePipelineId(
      props,
      feature?.geometry?.coordinates || [],
    );
    return id !== pipelineId;
  });

  localStorage.setItem("pipeiq-map-layers", JSON.stringify(parsed));
  window.dispatchEvent(new Event("pipeiq_pending_updated"));
  window.dispatchEvent(new Event("pipeiq_map_layers_updated"));
};

export default function PipelinesPage() {
  type QuickFilter = "all" | "high-risk" | "maintenance";
  type PipelineColumnKey =
    | "pipeId"
    | "age"
    | "material"
    | "diameter"
    | "repairs"
    | "riskScore"
    | "confidence"
    | "action";
  const [isHydrated, setIsHydrated] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortByRisk, setSortByRisk] = useState(true);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [highlightedPipelineId, setHighlightedPipelineId] = useState<
    string | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingPipelineIds, setSavingPipelineIds] = useState<Set<string>>(
    new Set(),
  );
  const [deletingPipelineIds, setDeletingPipelineIds] = useState<Set<string>>(
    new Set(),
  );
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineRow | null>(
    null,
  );
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isDetailsEditMode, setIsDetailsEditMode] = useState(false);
  const [isRepairHistoryOpen, setIsRepairHistoryOpen] = useState(false);
  const [expandedRepairKeys, setExpandedRepairKeys] = useState<Set<string>>(
    new Set(),
  );
  const [selectedRepairImageUrl, setSelectedRepairImageUrl] = useState<
    string | null
  >(null);
  const [repairImageLoadState, setRepairImageLoadState] = useState<
    Record<string, "loading" | "loaded" | "error">
  >({});
  const [detailsDraft, setDetailsDraft] = useState<PipelineDetailsDraft | null>(
    null,
  );
  const [isDetailsSaving, setIsDetailsSaving] = useState(false);
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<Set<string>>(
    new Set(),
  );
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<PipelineColumnKey, boolean>
  >({
    pipeId: true,
    age: true,
    material: true,
    diameter: true,
    repairs: true,
    riskScore: true,
    confidence: true,
    action: true,
  });
  const firebaseRowsRef = useRef<PipelineRow[]>([]);

  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);

  // Hydration effect: sync client state after mount
  useEffect(() => {
    setIsHydrated(true);

    const selectedId = localStorage.getItem("pipeiq_pipelines_highlighted");
    if (selectedId) {
      setHighlightedPipelineId(selectedId);
    }

    const cachedRows = loadInitialRows();
    if (cachedRows.length > 0) {
      setPipelines(cachedRows);
    }
  }, []);

  const getRiskLevel = (item: PipelineRow) => {
    return (
      item.riskBand ||
      deriveRiskBand(undefined, item.riskScore, item.risk_score)
    );
  };

  const toDraft = (item: PipelineRow): PipelineDetailsDraft => {
    const scoringRequest =
      item.scoringRequest && typeof item.scoringRequest === "object"
        ? item.scoringRequest
        : {};
    return {
      id: item.id,
      startLocation: item.startLocation || "",
      endLocation: item.endLocation || "",
      dmaId: String(item.zoneId || scoringRequest.dma_id || ""),
      installationYear: Number.isFinite(Number(scoringRequest.install_year))
        ? String(scoringRequest.install_year)
        : "",
      material: item.material || "",
      diameter: Number.isFinite(item.diameter) ? String(item.diameter) : "",
      pipeLengthM: Number.isFinite(
        Number(
          scoringRequest.pipe_length_m ??
            item?.scorePayload?.scoringRequest?.pipe_length_m,
        ),
      )
        ? String(
            scoringRequest.pipe_length_m ??
              item?.scorePayload?.scoringRequest?.pipe_length_m,
          )
        : "",
      roadCategory: String(
        scoringRequest.road_category ||
          item?.scorePayload?.scoringRequest?.road_category ||
          "",
      ),
      elevationM: Number.isFinite(
        Number(
          scoringRequest.elevation_m ??
            item?.scorePayload?.scoringRequest?.elevation_m,
        ),
      )
        ? String(
            scoringRequest.elevation_m ??
              item?.scorePayload?.scoringRequest?.elevation_m,
          )
        : "",
      operatingPressure: Number.isFinite(
        Number(
          scoringRequest.pressure_bar ??
            item?.scorePayload?.scoringRequest?.pressure_bar,
        ),
      )
        ? String(
            scoringRequest.pressure_bar ??
              item?.scorePayload?.scoringRequest?.pressure_bar,
          )
        : "",
      pastRepairs: Number.isFinite(Number(scoringRequest.n_past_repairs))
        ? String(scoringRequest.n_past_repairs)
        : Number.isFinite(item.repairs)
          ? String(item.repairs)
          : "",
      soilType: String(
        scoringRequest.soil_type ||
          item?.scorePayload?.scoringRequest?.soil_type ||
          "",
      ),
      depthM: Number.isFinite(
        Number(
          scoringRequest.depth_m ?? item?.scorePayload?.scoringRequest?.depth_m,
        ),
      )
        ? String(
            scoringRequest.depth_m ??
              item?.scorePayload?.scoringRequest?.depth_m,
          )
        : "",
    };
  };

  const getPipelineDisplayId = (item: PipelineRow) => {
    const start = item.startLocation?.trim();
    const end = item.endLocation?.trim();
    if (start && end) return `${start} - ${end}`;
    return item.id;
  };

  const openPipelineDetails = (item: PipelineRow, startInEditMode = false) => {
    setSelectedPipeline(item);
    setDetailsDraft(toDraft(item));
    setIsDetailsEditMode(startInEditMode);
    setIsRepairHistoryOpen(false);
    setIsDetailsOpen(true);
    setHighlightedPipelineId(item.id);
    localStorage.setItem("pipeiq_pipelines_highlighted", item.id);
  };

  const openRepairHistory = (item: PipelineRow) => {
    setSelectedPipeline(item);
    setIsRepairHistoryOpen(true);
    setExpandedRepairKeys(new Set());
    setRepairImageLoadState({});
    setIsDetailsOpen(false);
    setIsDetailsEditMode(false);
    setDetailsDraft(null);
    setHighlightedPipelineId(item.id);
    localStorage.setItem("pipeiq_pipelines_highlighted", item.id);
  };

  const closePipelineDetails = () => {
    setIsDetailsOpen(false);
    setIsDetailsEditMode(false);
    setIsDetailsSaving(false);
    setIsRepairHistoryOpen(false);
    setExpandedRepairKeys(new Set());
    setSelectedRepairImageUrl(null);
    setRepairImageLoadState({});
    setSelectedPipeline(null);
    setDetailsDraft(null);
  };

  const hasUnsavedPipelineChanges = !!(
    isDetailsOpen &&
    isDetailsEditMode &&
    selectedPipeline &&
    detailsDraft &&
    JSON.stringify(detailsDraft) !== JSON.stringify(toDraft(selectedPipeline))
  );

  const requestClosePipelineDetails = () => {
    if (hasUnsavedPipelineChanges) {
      toast.warning("Leave without saving?", {
        description: "You have unsaved changes for this pipeline.",
        action: {
          label: "Discard",
          onClick: () => closePipelineDetails(),
        },
        cancel: {
          label: "Keep Editing",
          onClick: () => undefined,
        },
      });
      return;
    }
    closePipelineDetails();
  };

  const savePipelineDetails = async () => {
    if (!selectedPipeline || !detailsDraft || isDetailsSaving) return;

    const installYear = Number(detailsDraft.installationYear);
    const diameter = Number(detailsDraft.diameter);
    const repairs = Number(detailsDraft.pastRepairs);
    const pipeLengthM = Number(detailsDraft.pipeLengthM);
    const elevationM = Number(detailsDraft.elevationM);
    const operatingPressure = Number(detailsDraft.operatingPressure);
    const depthM = Number(detailsDraft.depthM);
    const currentYear = new Date().getFullYear();

    const didChange =
      JSON.stringify(detailsDraft) !==
      JSON.stringify(toDraft(selectedPipeline));
    let rescored: any = null;

    if (didChange) {
      const existingScoringRequest =
        selectedPipeline.scoringRequest &&
        typeof selectedPipeline.scoringRequest === "object"
          ? selectedPipeline.scoringRequest
          : {};

      const scorePayload = {
        ...existingScoringRequest,
        id: selectedPipeline.id,
        pipelineId: selectedPipeline.id,
        startLocation: detailsDraft.startLocation,
        endLocation: detailsDraft.endLocation,
        zoneId: selectedPipeline.zoneId,
        dmaId: selectedPipeline.zoneId,
        dma_id: selectedPipeline.zoneId,
        material: detailsDraft.material,
        diameter: Number.isFinite(diameter) ? diameter : undefined,
        diameter_mm: Number.isFinite(diameter)
          ? diameter
          : existingScoringRequest.diameter_mm,
        pipe_length_m: Number.isFinite(pipeLengthM)
          ? pipeLengthM
          : existingScoringRequest.pipe_length_m,
        road_category:
          detailsDraft.roadCategory || existingScoringRequest.road_category,
        elevation_m: Number.isFinite(elevationM)
          ? elevationM
          : existingScoringRequest.elevation_m,
        pressure_bar: Number.isFinite(operatingPressure)
          ? operatingPressure
          : existingScoringRequest.pressure_bar,
        pastRepairs: Number.isFinite(repairs) ? repairs : undefined,
        n_past_repairs: Number.isFinite(repairs)
          ? repairs
          : existingScoringRequest.n_past_repairs,
        soil_type: detailsDraft.soilType || existingScoringRequest.soil_type,
        depth_m: Number.isFinite(depthM)
          ? depthM
          : existingScoringRequest.depth_m,
        installationYear: Number.isFinite(installYear)
          ? installYear
          : undefined,
        install_year: Number.isFinite(installYear)
          ? installYear
          : existingScoringRequest.install_year,
      };

      try {
        const scoreResponse = await fetch(
          backendApiUrl("/api/score-pipeline"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(scorePayload),
          },
        );

        if (!scoreResponse.ok) {
          const details = await scoreResponse.text();
          throw new Error(
            details || `Scoring failed (${scoreResponse.status})`,
          );
        }

        rescored = await scoreResponse.json();
      } catch {
        toast.error("We couldn't refresh this pipeline right now.", {
          description: "Please try again in a moment.",
        });
        return;
      }
    }

    const rescoredRisk01 = Number(rescored?.risk_score);
    const rescoredConfidence01 = Number(rescored?.confidence_score);
    const rescoredRisk100 = Number.isFinite(Number(rescored?.riskScore))
      ? Number(rescored?.riskScore)
      : Number.isFinite(rescoredRisk01)
        ? Math.round(rescoredRisk01 * 100)
        : undefined;

    const payload: Record<string, any> = {
      material: detailsDraft.material,
      startLocation: detailsDraft.startLocation,
      endLocation: detailsDraft.endLocation,
      dmaId: selectedPipeline.zoneId,
      installationYear: Number.isFinite(installYear) ? installYear : undefined,
      status: "scored",
      predictionStatus: "complete",
      riskScore: Number.isFinite(rescoredRisk100)
        ? rescoredRisk100
        : selectedPipeline.riskScore,
      zoneId: selectedPipeline.zoneId || "N/A",
    };

    if (Number.isFinite(diameter) && diameter >= 0) payload.diameter = diameter;
    if (Number.isFinite(repairs) && repairs >= 0) {
      payload.repairs = repairs;
      payload.pastRepairs = repairs;
    }
    if (Number.isFinite(pipeLengthM) && pipeLengthM > 0)
      payload.pipeLengthM = pipeLengthM;
    if (detailsDraft.roadCategory)
      payload.roadCategory = detailsDraft.roadCategory;
    if (Number.isFinite(elevationM)) payload.elevationM = elevationM;
    if (Number.isFinite(operatingPressure))
      payload.operatingPressure = operatingPressure;
    if (detailsDraft.soilType) payload.soilType = detailsDraft.soilType;
    if (Number.isFinite(depthM) && depthM > 0) payload.depthM = depthM;

    if (Number.isFinite(rescoredConfidence01)) {
      payload.confidence = Math.round(rescoredConfidence01 * 100);
      payload.confidence_score = rescoredConfidence01;
      payload.confidence_band =
        rescored?.confidence_band ||
        deriveConfidenceBand(undefined, rescoredConfidence01);
    }

    if (Number.isFinite(rescoredRisk01)) payload.risk_score = rescoredRisk01;
    if (rescored?.risk_band) payload.riskBand = rescored.risk_band;
    if (rescored?.risk_band) payload.risk_band = rescored.risk_band;

    setIsDetailsSaving(true);
    setSavingPipelineIds((prev) => new Set(prev).add(selectedPipeline.id));

    try {
      await Promise.all(
        selectedPipeline.firebaseRefs.map(async (ref) => {
          try {
            await updateDoc(doc(db, ref.collection, ref.docId), payload);
          } catch {
            // Ignore individual doc failures and continue others.
          }
        }),
      );

      updateLocalPipelineStorage(selectedPipeline.id, (props) => ({
        ...props,
        ...payload,
      }));

      const updatedPipeline: PipelineRow = {
        ...selectedPipeline,
        zoneId: payload.zoneId,
        startLocation: payload.startLocation || selectedPipeline.startLocation,
        endLocation: payload.endLocation || selectedPipeline.endLocation,
        material: payload.material,
        age: Number.isFinite(installYear)
          ? Math.max(currentYear - installYear, 0)
          : selectedPipeline.age,
        diameter:
          Number.isFinite(diameter) && diameter >= 0
            ? diameter
            : selectedPipeline.diameter,
        repairs:
          Number.isFinite(repairs) && repairs >= 0
            ? repairs
            : selectedPipeline.repairs,
        confidence: Number.isFinite(payload.confidence)
          ? payload.confidence
          : selectedPipeline.confidence,
        riskScore: Number.isFinite(payload.riskScore)
          ? payload.riskScore
          : selectedPipeline.riskScore,
        riskBand:
          payload.risk_band || payload.riskBand || selectedPipeline.riskBand,
        confidenceBand:
          payload.confidence_band || selectedPipeline.confidenceBand,
        risk_score: Number.isFinite(payload.risk_score)
          ? payload.risk_score
          : selectedPipeline.risk_score,
        confidence_score: Number.isFinite(payload.confidence_score)
          ? payload.confidence_score
          : selectedPipeline.confidence_score,
        repair_history: selectedPipeline.repair_history,
        lastRepairAt: selectedPipeline.lastRepairAt,
        lastRepairType: selectedPipeline.lastRepairType,
        otherData:
          payload.otherData !== undefined
            ? payload.otherData
            : selectedPipeline.otherData,
        modelOutput:
          payload.modelOutput !== undefined
            ? payload.modelOutput
            : selectedPipeline.modelOutput,
        scoringRequest:
          payload.scoringRequest !== undefined
            ? payload.scoringRequest
            : selectedPipeline.scoringRequest,
        scorePayload:
          payload.scorePayload !== undefined
            ? payload.scorePayload
            : selectedPipeline.scorePayload,
        status: payload.status,
        predictionStatus: payload.predictionStatus,
      };

      setPipelines((prev) =>
        prev.map((p) => (p.id === selectedPipeline.id ? updatedPipeline : p)),
      );
      setSelectedPipeline(updatedPipeline);
      setDetailsDraft(toDraft(updatedPipeline));
      setIsDetailsEditMode(false);
      toast.success("Pipeline details saved.");
    } finally {
      setIsDetailsSaving(false);
      setSavingPipelineIds((prev) => {
        const next = new Set(prev);
        next.delete(selectedPipeline.id);
        return next;
      });
    }
  };

  const confirmSavePipelineDetails = () => {
    if (!selectedPipeline || !detailsDraft) return;
    toast.warning("Save pipeline changes?", {
      description: `Save updates for ${selectedPipeline.id}?`,
      action: {
        label: "Save",
        onClick: () => {
          void savePipelineDetails();
        },
      },
      cancel: {
        label: "Cancel",
        onClick: () => undefined,
      },
    });
  };

  useEffect(() => {
    let alive = true;
    let firebaseRows: PipelineRow[] = [];
    let queueRows: PipelineRow[] = [];

    const syncPipelinesLocal = () => {
      const localRows = loadPipelinesFromMapStorage();
      if (alive)
        setPipelines(mergeRows(localRows, [...firebaseRows, ...queueRows]));
    };

    const emitFirebase = () => {
      if (!alive) return;
      setPipelines(
        mergeRows(loadPipelinesFromMapStorage(), [
          ...firebaseRows,
          ...queueRows,
        ]),
      );
      setIsLoading(false);
    };

    // Load queue pipelines
    syncPipelinesLocal();

    const unsubscribe = onSnapshot(
      collection(db, "pipelines"),
      (snapshot) => {
        if (!alive) return;
        firebaseRows = snapshot.docs
          .map((entry) =>
            mapFirebaseDocToRow(entry.id, "pipelines", entry.data()),
          )
          .filter((row): row is PipelineRow => !!row);

        localStorage.setItem(PIPELINES_CACHE_KEY, JSON.stringify(firebaseRows));
        emitFirebase();
      },
      () => {
        firebaseRows = [];
        emitFirebase();
      },
    );

    const unsubQueue = onSnapshot(
      collection(db, "pipelineQueue"),
      (snapshot) => {
        if (!alive) return;
        queueRows = snapshot.docs
          .map((entry) =>
            mapFirebaseDocToRow(entry.id, "pipelineQueue", entry.data()),
          )
          .filter((row): row is PipelineRow => !!row);

        emitFirebase();
      },
      () => {
        queueRows = [];
        emitFirebase();
      },
    );

    const onPipelineSelected = () => {
      const selectedId = localStorage.getItem("pipeiq_pipelines_highlighted");
      setHighlightedPipelineId(selectedId);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === "pipeiq-map-layers") {
        syncPipelinesLocal();
      }
    };

    const onMapLayersUpdated = () => syncPipelinesLocal();

    window.addEventListener("pipeiq_pipeline_selected", onPipelineSelected);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pipeiq_map_layers_updated", onMapLayersUpdated);

    return () => {
      alive = false;
      unsubscribe();
      unsubQueue();
      window.removeEventListener(
        "pipeiq_pipeline_selected",
        onPipelineSelected,
      );
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "pipeiq_map_layers_updated",
        onMapLayersUpdated,
      );
    };
  }, []);

  const filtered = useMemo(() => {
    const searchKey = searchTerm.toLowerCase().trim();

    return pipelines
      .filter((p) => {
        // Exclude failed and pending-retry items from main display
        if (p.status === "failed" || p.status === "pending-retry") return false;

        const displayId = getPipelineDisplayId(p).toLowerCase();
        const matchesSearch =
          !searchKey ||
          displayId.includes(searchKey) ||
          p.id.toLowerCase().includes(searchKey) ||
          p.material.toLowerCase().includes(searchKey);

        if (!matchesSearch) return false;

        if (quickFilter === "high-risk") return getRiskLevel(p) === "High";
        if (quickFilter === "maintenance")
          return p.status === "Under Maintenance";
        return true;
      })
      .sort((a, b) => {
        if (sortByRisk) return b.riskScore - a.riskScore;
        return 0;
      });
  }, [pipelines, searchTerm, quickFilter, sortByRisk]);

  const paginatedRows = useMemo(
    () =>
      filtered.slice(
        (currentPage - 1) * rowsPerPage,
        currentPage * rowsPerPage,
      ),
    [filtered, currentPage, rowsPerPage],
  );

  const gridStats = useMemo(() => {
    // Count only valid pipelines (exclude failed/retry items)
    const valid = pipelines.filter(
      (p) => p.status !== "failed" && p.status !== "pending-retry",
    );
    const total = valid.length;
    const highRisk = valid.filter((p) => getRiskLevel(p) === "High").length;
    const maintenance = valid.filter(
      (p) => p.status === "Under Maintenance",
    ).length;
    return { total, highRisk, maintenance };
  }, [pipelines]);

  const repairHistory = useMemo(
    () => normalizeRepairHistory(selectedPipeline?.repair_history),
    [selectedPipeline?.repair_history],
  );

  const hasActiveFilters =
    quickFilter !== "all" || searchTerm.trim().length > 0;

  const filterPillClass = (key: QuickFilter) => {
    const active = quickFilter === key;
    if (key === "high-risk") {
      return active
        ? "!border-red-600 !bg-red-600 !text-white"
        : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200";
    }
    if (key === "maintenance") {
      return active
        ? "!border-amber-500 !bg-amber-500 !text-white"
        : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200";
    }
    return active
      ? "!border-sky-300 !bg-sky-200 !text-sky-950 dark:!border-amber-200/40 dark:!bg-amber-300 dark:!text-slate-900"
      : "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, quickFilter, rowsPerPage]);

  useEffect(() => {
    if (!highlightedPipelineId) return;

    const selectedIndex = filtered.findIndex(
      (p) => p.id === highlightedPipelineId,
    );
    if (selectedIndex < 0) return;

    const selectedPage = Math.floor(selectedIndex / rowsPerPage) + 1;
    if (selectedPage !== currentPage) {
      setCurrentPage(selectedPage);
    }
  }, [filtered, highlightedPipelineId, currentPage, rowsPerPage]);

  useEffect(() => {
    if (!highlightedPipelineId) return;

    const target = document.querySelector(
      `[data-pipeline-id="${highlightedPipelineId.replace(/"/g, '\\"')}"]`,
    );
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedPipelineId, currentPage]);

  const exportToCSV = () => {
    const headers = ["ID", "Zone", "Material", "Age", "Risk Score", "Status"];
    const rows = filtered.map((p) => [
      p.id,
      p.zoneId,
      p.material,
      p.age,
      p.riskScore,
      p.status,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      headers.join(",") +
      "\n" +
      rows.map((e) => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "pipeline_risk_data.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDeletePipeline = async (item: PipelineRow) => {
    if (deletingPipelineIds.has(item.id) || savingPipelineIds.has(item.id))
      return;
    setDeletingPipelineIds((prev) => new Set(prev).add(item.id));

    setPipelines((prev) => prev.filter((pipeline) => pipeline.id !== item.id));

    try {
      await Promise.all(
        item.firebaseRefs.map(async (ref) => {
          try {
            await deleteDoc(doc(db, ref.collection, ref.docId));
          } catch {
            // Ignore write failures per doc and continue others.
          }
        }),
      );
      toast.success("Pipeline deleted.");
    } finally {
      setDeletingPipelineIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleBulkDeletePipelines = async () => {
    if (isBulkDeleting || selectedPipelineIds.size === 0) return;
    const targets = pipelines.filter((p) => selectedPipelineIds.has(p.id));
    if (targets.length === 0) return;

    setIsBulkDeleting(true);
    setPipelines((prev) => prev.filter((p) => !selectedPipelineIds.has(p.id)));

    try {
      await Promise.all(
        targets.flatMap((item) =>
          item.firebaseRefs.map(async (ref) => {
            try {
              await deleteDoc(doc(db, ref.collection, ref.docId));
            } catch {
              // Ignore individual failures in bulk delete.
            }
          }),
        ),
      );

      targets.forEach((item) => {
        if (item.localPresent) removeLocalPipelineStorage(item.id);
      });

      toast.success(`${targets.length} pipeline(s) deleted.`);
      setSelectedPipelineIds(new Set());
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleClearAllPipelines = async () => {
    if (isClearingAll) return;
    setIsClearingAll(true);
    setPipelines([]);

    try {
      await Promise.all(
        pipelines.flatMap((pipeline) =>
          pipeline.firebaseRefs.map(async (ref) => {
            try {
              await deleteDoc(doc(db, ref.collection, ref.docId));
            } catch {
              // Ignore failures to avoid blocking full clear flow.
            }
          }),
        ),
      );

      setShowClearConfirm(false);
      toast.success("All pipelines were cleared.");
    } finally {
      setIsClearingAll(false);
    }
  };

  const readOnlyInputClass =
    "px-3 py-2.5 border rounded-xl text-sm font-medium shadow-sm transition-all bg-white/35 dark:bg-slate-800/60 border-white/40 dark:border-white/10 text-slate-600 dark:text-slate-200 backdrop-blur-md";
  const editableInputClass =
    "px-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/35 dark:focus:ring-sky-300/35 focus:border-sky-400/55 dark:focus:border-sky-300/50 text-sm font-medium shadow-sm transition-all bg-white/65 dark:bg-slate-800/80 border-white/55 dark:border-white/10 text-slate-900 dark:text-white backdrop-blur-md";
  const checkboxClass =
    "h-4 w-4 appearance-none rounded-md border border-slate-300/80 dark:border-white/20 bg-white/90 dark:bg-slate-800/80 checked:bg-sky-500 checked:border-sky-500 dark:checked:bg-amber-500 dark:checked:border-amber-500 focus:ring-2 focus:ring-sky-400/60 dark:focus:ring-amber-400/60 focus:ring-offset-0 transition-colors cursor-pointer";

  return (
    <div className="h-full flex flex-col p-6 gap-6 relative overflow-hidden pointer-events-none">
      {/* Full Page Liquid Glass Overlay - Animated Entry */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="absolute inset-4 rounded-3xl glass-panel pointer-events-auto flex flex-col overflow-hidden"
      >
        <div className="p-6 border-b border-white/20 flex justify-between items-center flex-none">
          <div>
            <h1 className="text-3xl font-light tracking-tight text-[hsl(var(--foreground))]">
              Pipelines
            </h1>
            <p className="text-[hsl(var(--muted-foreground))] text-sm font-light flex items-center gap-2">
              <span>Manage network pipeline segments and risk.</span>
              {isLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" />
                  Syncing...
                </span>
              ) : (
                <span>{`${pipelines.length} loaded`}</span>
              )}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              disabled={isClearingAll}
              onClick={() => setShowClearConfirm(true)}
              className="glass-button flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm text-red-500 hover:bg-sky-900/12 hover:text-red-700 dark:hover:bg-amber-400/20 dark:hover:text-red-300 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed border border-red-200/40 dark:border-red-400/20"
            >
              {isClearingAll ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Trash2 size={16} />
              )}
              Clear All
            </button>
            <button
              onClick={exportToCSV}
              className="glass-button flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm text-[hsl(var(--foreground))] hover:bg-sky-900/12 hover:text-sky-900 dark:hover:bg-amber-400/20 dark:hover:text-amber-100 shadow-sm border border-white/30"
            >
              <Download size={16} />
              Export
            </button>
          </div>
        </div>

        <div className="p-4 border-b border-white/20 flex items-center gap-3 flex-none bg-white/10">
          <div className="relative flex-1 max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
              size={16}
            />
            <input
              type="text"
              placeholder="Search ID, route, or material..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-white/40 border border-white/30 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/5 placeholder:text-gray-500 transition-all focus:bg-white/60"
            />
          </div>
          <button
            onClick={() => setSortByRisk((prev) => !prev)}
            className="glass-button px-3 py-2 rounded-xl text-sm bg-white/35 border border-white/30 text-slate-700 dark:text-slate-200 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 hover:text-sky-900 dark:hover:text-amber-100"
            title="Toggle risk sorting"
          >
            {sortByRisk ? "Risk Sort: On" : "Risk Sort: Off"}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              Rows
            </span>
            <select
              value={rowsPerPage}
              onChange={(e) => setRowsPerPage(Number(e.target.value))}
              className="glass-button px-2.5 py-2 rounded-xl text-sm bg-white/40 border border-white/30"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        <div className="px-4 py-2.5 border-b border-white/20 flex items-center gap-2 flex-wrap bg-white/5">
          <span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] mr-1">
            Quick Filters
          </span>
          {(
            [
              { key: "all", label: "All" },
              { key: "high-risk", label: "High Risk" },
              { key: "maintenance", label: "Maintenance" },
            ] as Array<{ key: QuickFilter; label: string }>
          ).map((option) => (
            <button
              key={option.key}
              onClick={() => setQuickFilter(option.key)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${filterPillClass(option.key)}`}
            >
              {option.label}
            </button>
          ))}
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearchTerm("");
                setQuickFilter("all");
              }}
              className="ml-auto px-2.5 py-1.5 rounded-lg text-xs border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 hover:text-sky-900 dark:hover:text-amber-100"
            >
              Reset Filters
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowColumnMenu((prev) => !prev)}
              className="px-2.5 py-1.5 rounded-lg text-xs border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 hover:text-sky-900 dark:hover:text-amber-100"
            >
              Columns
            </button>
            <button
              disabled={selectedPipelineIds.size === 0 || isBulkDeleting}
              onClick={() => {
                toast.error("Delete selected pipelines?", {
                  description: `This will permanently remove ${selectedPipelineIds.size} pipeline(s).`,
                  action: {
                    label: "Delete",
                    onClick: () => {
                      void handleBulkDeletePipelines();
                    },
                  },
                  actionButtonStyle: {
                    backgroundColor: "#ef4444",
                    color: "white",
                  },
                });
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs border border-red-300/40 dark:border-red-500/30 bg-red-50/70 dark:bg-red-500/15 text-red-600 dark:text-red-300 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBulkDeleting
                ? "Deleting..."
                : `Delete Selected (${selectedPipelineIds.size})`}
            </button>
          </div>
          {showColumnMenu && (
            <div className="w-full mt-2 p-2 rounded-xl border border-white/30 dark:border-white/10 bg-white/60 dark:bg-slate-800/70 grid grid-cols-2 md:grid-cols-5 gap-2">
              {(
                [
                  ["pipeId", "Pipe ID"],
                  ["age", "Age"],
                  ["material", "Material"],
                  ["diameter", "Diameter"],
                  ["repairs", "Repairs"],
                  ["riskScore", "Risk"],
                  ["confidence", "Confidence"],
                  ["action", "Action"],
                ] as Array<[PipelineColumnKey, string]>
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200"
                >
                  <input
                    type="checkbox"
                    checked={columnVisibility[key]}
                    onChange={(e) =>
                      setColumnVisibility((prev) => ({
                        ...prev,
                        [key]: e.target.checked,
                      }))
                    }
                    className={checkboxClass}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-b border-white/20 grid grid-cols-2 md:grid-cols-3 gap-2 bg-white/5">
          <div className="rounded-xl border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total
            </p>
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {isHydrated ? gridStats.total : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              High Risk
            </p>
            <p className="text-base font-semibold text-red-700 dark:text-red-200">
              {isHydrated ? gridStats.highRisk : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Maintenance
            </p>
            <p className="text-base font-semibold text-amber-700 dark:text-amber-200">
              {isHydrated ? gridStats.maintenance : "—"}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 relative">
          {isLoading && (
            <div className="absolute inset-4 z-10 flex items-center justify-center pointer-events-none">
              <div className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/70 dark:bg-slate-900/70 px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] backdrop-blur-md">
                <Loader2 size={15} className="animate-spin" />
                Loading pipelines...
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-white/25 dark:border-white/10 overflow-hidden bg-white/20 dark:bg-slate-900/35">
            <table
              className={`w-full text-sm text-left ${isLoading ? "opacity-70" : ""}`}
            >
              <thead className="text-[hsl(var(--muted-foreground))] sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide w-10 bg-white/35 dark:bg-slate-900/55">
                    <input
                      type="checkbox"
                      checked={
                        paginatedRows.length > 0 &&
                        paginatedRows.every((p) =>
                          selectedPipelineIds.has(p.id),
                        )
                      }
                      onChange={(e) => {
                        const next = new Set(selectedPipelineIds);
                        if (e.target.checked)
                          paginatedRows.forEach((p) => next.add(p.id));
                        else paginatedRows.forEach((p) => next.delete(p.id));
                        setSelectedPipelineIds(next);
                      }}
                      className={checkboxClass}
                    />
                  </th>
                  {columnVisibility.pipeId && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Pipe ID
                    </th>
                  )}
                  {columnVisibility.age && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Age
                    </th>
                  )}
                  {columnVisibility.material && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Material
                    </th>
                  )}
                  {columnVisibility.diameter && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Diameter
                    </th>
                  )}
                  {columnVisibility.repairs && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Repairs
                    </th>
                  )}
                  {columnVisibility.riskScore && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      <button
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 hover:text-sky-900 dark:hover:text-amber-100"
                        onClick={() => setSortByRisk(!sortByRisk)}
                      >
                        Risk
                        <ArrowUpDown
                          size={14}
                          className={sortByRisk ? "opacity-100" : "opacity-40"}
                        />
                      </button>
                    </th>
                  )}
                  {columnVisibility.confidence && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Confidence
                    </th>
                  )}
                  {columnVisibility.action && (
                    <th className="px-4 py-3 text-right font-medium text-[11px] uppercase tracking-wide sticky right-0 bg-white/35 dark:bg-slate-900/55">
                      Action
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* Pagination Logic */}
                {paginatedRows.map((item, rowIndex) => {
                  const isSaving = savingPipelineIds.has(item.id);
                  const isDeleting = deletingPipelineIds.has(item.id);
                  const actionDisabled = isSaving || isDeleting;
                  const ageDisplay =
                    Number.isFinite(item.age) && item.age > 0
                      ? String(item.age)
                      : "-";
                  const materialDisplay = item.material?.trim()
                    ? item.material
                    : "-";
                  const riskScoreDisplay = Number.isFinite(item.riskScore)
                    ? item.riskScore
                    : null;
                  const confidence01 = Number.isFinite(item.confidence_score)
                    ? (item.confidence_score as number)
                    : undefined;
                  const confidenceBand =
                    item.confidenceBand ||
                    deriveConfidenceBand(undefined, confidence01);
                  const pipelineDisplayId = getPipelineDisplayId(item);
                  const rowBgClass =
                    rowIndex % 2 === 0
                      ? "bg-white/35 dark:bg-slate-900/25"
                      : "bg-white/20 dark:bg-slate-900/15";
                  const cellBgClass = rowBgClass;
                  return (
                    <tr
                      key={item.id}
                      data-pipeline-id={item.id}
                      onClick={() => {
                        openPipelineDetails(item, false);
                      }}
                      className="cursor-pointer border-t border-white/15 dark:border-white/5"
                    >
                      <td
                        className={`px-4 py-3 w-10 ${cellBgClass}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPipelineIds.has(item.id)}
                          onChange={(e) => {
                            const next = new Set(selectedPipelineIds);
                            if (e.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            setSelectedPipelineIds(next);
                          }}
                          className={checkboxClass}
                        />
                      </td>
                      {columnVisibility.pipeId && (
                        <td
                          className={`px-4 py-3 text-xs opacity-80 text-slate-700 dark:text-slate-300 ${cellBgClass}`}
                        >
                          {pipelineDisplayId}
                        </td>
                      )}
                      {columnVisibility.age && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                        >
                          {ageDisplay}
                        </td>
                      )}
                      {columnVisibility.material && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                        >
                          {materialDisplay}
                        </td>
                      )}
                      {columnVisibility.diameter && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                        >
                          {Number.isFinite(item.diameter) ? item.diameter : "-"}
                        </td>
                      )}
                      {columnVisibility.repairs && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {(() => {
                            const itemRepairHistory = normalizeRepairHistory(
                              item.repair_history,
                            );
                            const repairCount = itemRepairHistory.length;
                            return (
                              <div className="inline-flex items-center gap-2">
                                <span>
                                  {Number.isFinite(item.repairs)
                                    ? item.repairs
                                    : "-"}
                                </span>
                                <button
                                  type="button"
                                  disabled={repairCount === 0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openRepairHistory(item);
                                  }}
                                  className="inline-flex items-center justify-center rounded-full border border-white/30 dark:border-white/10 bg-white/45 dark:bg-slate-800/60 p-1.5 text-slate-700 dark:text-slate-200 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 hover:text-sky-900 dark:hover:text-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
                                  title="View repair history"
                                >
                                  <History size={13} />
                                </button>
                              </div>
                            );
                          })()}
                        </td>
                      )}
                      {columnVisibility.riskScore && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                        >
                          {riskScoreDisplay === null ? (
                            "-"
                          ) : (
                            <RiskBadge
                              score={item.riskScore}
                              riskBand={item.riskBand}
                            />
                          )}
                        </td>
                      )}
                      {columnVisibility.confidence && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                        >
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                              confidenceBand === "High"
                                ? "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/20 dark:text-blue-200 dark:border-blue-500/30"
                                : confidenceBand === "Medium"
                                  ? "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-500/20 dark:text-violet-200 dark:border-violet-500/30"
                                  : "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-500/20 dark:text-slate-200 dark:border-slate-500/30"
                            }`}
                          >
                            {confidenceBand}
                          </span>
                        </td>
                      )}
                      {columnVisibility.action && (
                        <td
                          className={`px-4 py-3 text-right sticky right-0 ${cellBgClass}`}
                        >
                          <div className="flex items-center justify-end gap-1">
                            <button
                              disabled={actionDisabled}
                              onClick={(e) => {
                                e.stopPropagation();
                                openPipelineDetails(item, true);
                              }}
                              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 bg-white/40 dark:bg-slate-800/60 border border-white/30 dark:border-white/10 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 hover:text-sky-900 dark:hover:text-amber-100 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {isSaving ? (
                                <Loader2 size={15} className="animate-spin" />
                              ) : (
                                <Edit2 size={15} />
                              )}
                            </button>
                            <button
                              disabled={actionDisabled}
                              onClick={(e) => {
                                e.stopPropagation();
                                toast.error("Delete this pipeline?", {
                                  description: `This will permanently remove ${item.id}.`,
                                  action: {
                                    label: "Delete",
                                    onClick: () => {
                                      handleDeletePipeline(item);
                                    },
                                  },
                                  actionButtonStyle: {
                                    backgroundColor: "#ef4444",
                                    color: "white",
                                  },
                                });
                              }}
                              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 bg-white/40 dark:bg-slate-800/60 border border-white/30 dark:border-white/10 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 hover:text-sky-900 dark:hover:text-amber-100 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {isDeleting ? (
                                <Loader2 size={15} className="animate-spin" />
                              ) : (
                                <Trash2 size={15} />
                              )}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={
                        1 +
                        (columnVisibility.pipeId ? 1 : 0) +
                        (columnVisibility.age ? 1 : 0) +
                        (columnVisibility.material ? 1 : 0) +
                        (columnVisibility.diameter ? 1 : 0) +
                        (columnVisibility.repairs ? 1 : 0) +
                        (columnVisibility.riskScore ? 1 : 0) +
                        (columnVisibility.confidence ? 1 : 0) +
                        (columnVisibility.action ? 1 : 0)
                      }
                      className="px-4 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]"
                    >
                      No completed pipelines found in Firebase.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination Controls */}
        <div className="p-4 border-t border-white/20 flex items-center justify-between text-sm text-[hsl(var(--muted-foreground))] flex-none bg-white/10">
          <span>
            Showing{" "}
            {filtered.length === 0
              ? 0
              : Math.min(
                  (currentPage - 1) * rowsPerPage + 1,
                  filtered.length,
                )}{" "}
            - {Math.min(currentPage * rowsPerPage, filtered.length)} of{" "}
            {filtered.length}
          </span>
          <div className="flex gap-2">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((c) => Math.max(1, c - 1))}
              className="px-3 py-1 bg-white/40 rounded-lg hover:bg-sky-900/12 hover:text-sky-900 dark:hover:bg-amber-400/20 dark:hover:text-amber-100 disabled:opacity-50 disabled:hover:bg-white/40 transition-colors"
            >
              Previous
            </button>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((c) => Math.min(totalPages, c + 1))}
              className="px-3 py-1 bg-white/40 rounded-lg hover:bg-sky-900/12 hover:text-sky-900 dark:hover:bg-amber-400/20 dark:hover:text-amber-100 disabled:opacity-50 disabled:hover:bg-white/40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {isDetailsOpen && selectedPipeline && detailsDraft && (
          <div className="fixed inset-0 z-[10001] flex items-center justify-center pointer-events-auto p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={requestClosePipelineDetails}
              className="absolute inset-0 bg-slate-900/30 dark:bg-black/60 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative w-full max-w-2xl bg-white/45 dark:bg-slate-900/80 backdrop-blur-2xl border border-white/55 dark:border-white/15 rounded-2xl shadow-[0_20px_70px_rgba(14,116,144,0.22)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)] overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/35 dark:border-white/10 bg-gradient-to-r from-sky-100/50 via-white/35 to-cyan-100/45 dark:from-sky-500/10 dark:via-slate-800/65 dark:to-cyan-500/10">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                    Pipeline Details
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {getPipelineDisplayId(selectedPipeline)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!isDetailsEditMode ? (
                    <button
                      type="button"
                      onClick={() => setIsDetailsEditMode(true)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/80 dark:border-white/10 text-slate-700 dark:text-slate-200 bg-white/60 dark:bg-slate-700/80 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 hover:text-sky-900 dark:hover:text-amber-100 transition-all"
                    >
                      Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsDetailsEditMode(false);
                        setDetailsDraft(toDraft(selectedPipeline));
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/80 dark:border-white/10 text-slate-700 dark:text-slate-200 bg-white/60 dark:bg-slate-700/80 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 hover:text-sky-900 dark:hover:text-amber-100 transition-all"
                    >
                      Discard Changes
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={requestClosePipelineDetails}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-sky-900 hover:bg-sky-100/80 dark:text-slate-400 dark:hover:text-amber-200 dark:hover:bg-amber-800/25 transition-colors"
                    aria-label="Close pipeline details"
                    title="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto max-h-[70vh] bg-white/10 dark:bg-white/5">
                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-600 dark:text-slate-400 flex items-center gap-2 mb-3">
                  <span className="w-4 h-[1px] bg-current opacity-40" />
                  Identifiers
                  <span className="flex-1 h-[1px] bg-current opacity-40" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Pipeline ID
                    </label>
                    <input
                      type="text"
                      value={getPipelineDisplayId(selectedPipeline)}
                      disabled
                      className={readOnlyInputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      DMA ID
                    </label>
                    <input
                      type="text"
                      value={selectedPipeline.zoneId}
                      disabled
                      className={readOnlyInputClass}
                    />
                  </div>
                </div>

                <div className="text-[10px] uppercase tracking-widest font-bold text-sky-700 dark:text-amber-300 flex items-center gap-2 mb-3 pb-2 border-b border-white/20">
                  <span className="w-4 h-[1px] bg-current opacity-40" />
                  Design &amp; Location
                  <span className="flex-1 h-[1px] bg-current opacity-40" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Start Location
                    </label>
                    <input
                      type="text"
                      value={detailsDraft.startLocation}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev
                            ? { ...prev, startLocation: e.target.value }
                            : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      End Location
                    </label>
                    <input
                      type="text"
                      value={detailsDraft.endLocation}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev
                            ? { ...prev, endLocation: e.target.value }
                            : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Pipe Length (m)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={detailsDraft.pipeLengthM}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev
                            ? { ...prev, pipeLengthM: e.target.value }
                            : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Operating Pressure (bar)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={detailsDraft.operatingPressure}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev
                            ? { ...prev, operatingPressure: e.target.value }
                            : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Elevation (m)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={detailsDraft.elevationM}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, elevationM: e.target.value } : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Depth (m)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={detailsDraft.depthM}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, depthM: e.target.value } : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Soil Type
                    </label>
                    <input
                      type="text"
                      value={detailsDraft.soilType}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, soilType: e.target.value } : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Road Category
                    </label>
                    <input
                      type="text"
                      value={detailsDraft.roadCategory}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev
                            ? { ...prev, roadCategory: e.target.value }
                            : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Past Repairs
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={detailsDraft.pastRepairs}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev
                            ? { ...prev, pastRepairs: e.target.value }
                            : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Installation Year
                    </label>
                    <input
                      type="number"
                      min="1850"
                      max={new Date().getFullYear()}
                      value={detailsDraft.installationYear}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev
                            ? { ...prev, installationYear: e.target.value }
                            : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                </div>

                <div className="text-[10px] uppercase tracking-widest font-bold text-sky-700 dark:text-amber-300 flex items-center gap-2 mt-5 mb-3 pb-2 border-b border-white/20">
                  <span className="w-4 h-[1px] bg-current opacity-40" />
                  Physical Properties
                  <span className="flex-1 h-[1px] bg-current opacity-40" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Material
                    </label>
                    <select
                      value={detailsDraft.material}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, material: e.target.value } : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    >
                      {!["DI", "CI", "PVC", "PE", "Steel", "AC"].includes(
                        detailsDraft.material,
                      ) &&
                        detailsDraft.material && (
                          <option value={detailsDraft.material}>
                            {detailsDraft.material}
                          </option>
                        )}
                      <option value="DI">Ductile Iron</option>
                      <option value="CI">Cast Iron</option>
                      <option value="PVC">PVC</option>
                      <option value="PE">Polyethylene</option>
                      <option value="Steel">Steel</option>
                      <option value="AC">Asbestos</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Nominal Diameter (mm)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={detailsDraft.diameter}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, diameter: e.target.value } : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                </div>

                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-600 dark:text-slate-400 flex items-center gap-2 mt-5 mb-3 pb-2 border-b border-white/20">
                  <span className="w-4 h-[1px] bg-current opacity-40" />
                  Assessment Results
                  <span className="flex-1 h-[1px] bg-current opacity-40" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Risk Score (0-100)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={
                        Number.isFinite(selectedPipeline.riskScore)
                          ? selectedPipeline.riskScore
                          : ""
                      }
                      disabled
                      className={readOnlyInputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Risk Assessment Level
                    </label>
                    <input
                      type="text"
                      value={
                        selectedPipeline.riskBand ||
                        deriveRiskBand(
                          undefined,
                          Number(selectedPipeline.riskScore) || 0,
                          Number(selectedPipeline.risk_score),
                        )
                      }
                      disabled
                      className={readOnlyInputClass}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Model Confidence Level
                    </label>
                    <input
                      type="text"
                      value={
                        selectedPipeline.confidenceBand ||
                        deriveConfidenceBand(
                          undefined,
                          selectedPipeline.confidence_score,
                        )
                      }
                      disabled
                      className={readOnlyInputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Current Pipeline Status
                    </label>
                    <input
                      type="text"
                      value={selectedPipeline.status}
                      disabled
                      className={readOnlyInputClass}
                    />
                  </div>
                </div>
              </div>

              <div className="p-5 border-t border-white/35 dark:border-white/10 bg-gradient-to-r from-sky-100/45 via-white/35 to-cyan-100/45 dark:from-sky-500/10 dark:via-slate-800/65 dark:to-cyan-500/10 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isDetailsEditMode
                    ? "Review your edits, then save."
                    : "Click Edit to update pipeline details."}
                </p>
                {isDetailsEditMode && (
                  <button
                    type="button"
                    disabled={isDetailsSaving}
                    onClick={confirmSavePipelineDetails}
                    className="px-8 py-2.5 rounded-xl text-sm font-bold bg-sky-700 text-white dark:bg-amber-400 dark:text-slate-900 hover:bg-sky-800 dark:hover:bg-amber-500 transition-all disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center gap-2 shadow-lg shadow-sky-700/20 dark:shadow-amber-400/20"
                  >
                    {isDetailsSaving && (
                      <Loader2 size={14} className="animate-spin" />
                    )}
                    {isDetailsSaving ? "Saving..." : "Save Changes"}
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isRepairHistoryOpen && selectedPipeline && (
          <div className="fixed inset-0 z-[10002] flex items-center justify-center pointer-events-auto p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsRepairHistoryOpen(false)}
              className="absolute inset-0 bg-slate-900/35 dark:bg-black/65 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 18 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-2xl border border-white/55 dark:border-white/15 bg-white/55 dark:bg-slate-900/88 backdrop-blur-2xl shadow-[0_24px_90px_rgba(14,116,144,0.24)] dark:shadow-[0_28px_100px_rgba(0,0,0,0.6)]"
            >
              <div className="flex items-center justify-between gap-4 border-b border-white/35 dark:border-white/10 bg-gradient-to-r from-sky-100/55 via-white/40 to-cyan-100/50 dark:from-sky-500/10 dark:via-slate-800/70 dark:to-cyan-500/10 px-6 py-4">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                    Repair History
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {getPipelineDisplayId(selectedPipeline)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsRepairHistoryOpen(false)}
                  className="inline-flex items-center justify-center rounded-lg border border-white/70 dark:border-white/10 bg-white/70 dark:bg-slate-700/80 p-2 text-slate-700 dark:text-slate-200 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 hover:text-sky-900 dark:hover:text-amber-100 transition-colors"
                  aria-label="Close repair history"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="max-h-[calc(80vh-73px)] overflow-y-auto px-6 py-5 bg-white/10 dark:bg-white/5">
                {repairHistory.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/30 dark:border-white/10 bg-white/10 dark:bg-slate-900/20 px-4 py-5 text-sm text-slate-600 dark:text-slate-400">
                    No repair history has been stored for this pipeline yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {repairHistory.map((entry, index) => {
                      const repairKey =
                        entry.repairId ||
                        `${selectedPipeline.id}-${index}-${formatRepairHistoryDate(entry)}`;
                      const isExpanded = expandedRepairKeys.has(repairKey);
                      const severity = entry.severity || "Unknown";
                      const repairType = entry.repairType || "Repair";
                      const waterLossDisplay =
                        entry.waterLoss ?? entry.flowRate ?? "-";
                      const notesText = entry.notes?.trim() || "-";
                      const imageUrls = Array.isArray(entry.imageUrls)
                        ? entry.imageUrls.filter(
                            (url): url is string =>
                              typeof url === "string" && url.trim().length > 0,
                          )
                        : [];
                      const imageCount = imageUrls.length;
                      const hasDetails =
                        !!entry.repairId ||
                        !!entry.issueType ||
                        !!entry.source ||
                        Number.isFinite(Number(entry.depthM)) ||
                        Number.isFinite(Number(entry.createdAtMs));

                      return (
                        <div
                          key={repairKey}
                          className="rounded-xl border border-white/30 dark:border-white/10 bg-white/12 dark:bg-slate-900/20 px-4 py-4 shadow-sm space-y-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                {repairType}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                {formatRepairHistoryDate(entry)}
                              </p>
                            </div>
                            <span className="inline-flex items-center rounded-full border border-sky-200/70 dark:border-amber-400/25 bg-sky-50/80 dark:bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-sky-700 dark:text-amber-100">
                              {severity}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-slate-700 dark:text-slate-200">
                            <div className="rounded-lg bg-white/45 dark:bg-white/5 px-3 py-2">
                              <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                Water Loss
                              </span>
                              <span className="font-medium">
                                {String(waterLossDisplay)}
                              </span>
                            </div>
                            <div className="rounded-lg bg-white/45 dark:bg-white/5 px-3 py-2">
                              <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                Notes
                              </span>
                              <span className="font-medium">
                                {notesText.length > 90
                                  ? `${notesText.slice(0, 90)}...`
                                  : notesText}
                              </span>
                            </div>
                          </div>

                          <div className="rounded-lg border border-dashed border-white/35 dark:border-white/15 bg-white/25 dark:bg-white/5 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                Repair Images
                              </span>
                              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                {imageCount > 0
                                  ? `${imageCount} image${imageCount > 1 ? "s" : ""} available`
                                  : "No images uploaded."}
                              </span>
                            </div>
                            {imageCount > 0 ? (
                              <div className="grid grid-cols-3 gap-2 mt-2">
                                {imageUrls.map((url, imageIndex) => {
                                  const imageKey = `${repairKey}-image-${imageIndex}`;
                                  const loadState =
                                    repairImageLoadState[imageKey] || "loading";

                                  return (
                                    <button
                                      type="button"
                                      key={imageKey}
                                      onClick={() =>
                                        setSelectedRepairImageUrl(url)
                                      }
                                      className="relative block h-20 rounded-lg overflow-hidden border border-white/30 dark:border-white/10 bg-slate-100/70 dark:bg-slate-800/70"
                                      title="Open image preview"
                                    >
                                      <img
                                        src={url}
                                        alt={`Repair image ${imageIndex + 1}`}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                        onLoad={() =>
                                          setRepairImageLoadState((prev) => ({
                                            ...prev,
                                            [imageKey]: "loaded",
                                          }))
                                        }
                                        onError={() =>
                                          setRepairImageLoadState((prev) => ({
                                            ...prev,
                                            [imageKey]: "error",
                                          }))
                                        }
                                      />
                                      {loadState === "loading" && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-slate-100/85 dark:bg-slate-900/80">
                                          <Loader2
                                            size={14}
                                            className="animate-spin text-slate-500 dark:text-slate-300"
                                          />
                                        </div>
                                      )}
                                      {loadState === "error" && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-slate-100/95 dark:bg-slate-900/90">
                                          <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 px-1 text-center">
                                            Failed to load
                                          </span>
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                                No images uploaded.
                              </p>
                            )}
                          </div>

                          {hasDetails && (
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedRepairKeys((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(repairKey))
                                      next.delete(repairKey);
                                    else next.add(repairKey);
                                    return next;
                                  })
                                }
                                className="inline-flex items-center rounded-lg border border-white/30 dark:border-white/10 bg-white/45 dark:bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-sky-900/12 dark:hover:bg-amber-400/20 hover:text-sky-900 dark:hover:text-amber-100 transition-colors"
                              >
                                {isExpanded ? "View less" : "View more"}
                              </button>
                            </div>
                          )}

                          {isExpanded && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-200 pt-1">
                              <div className="rounded-lg bg-white/45 dark:bg-white/5 px-3 py-2">
                                <span className="uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                  Repair ID
                                </span>
                                <span className="font-medium break-all">
                                  {entry.repairId || "-"}
                                </span>
                              </div>
                              <div className="rounded-lg bg-white/45 dark:bg-white/5 px-3 py-2">
                                <span className="uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                  Source
                                </span>
                                <span className="font-medium">
                                  {entry.source || "-"}
                                </span>
                              </div>
                              <div className="rounded-lg bg-white/45 dark:bg-white/5 px-3 py-2">
                                <span className="uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                  Issue Type
                                </span>
                                <span className="font-medium">
                                  {entry.issueType || "-"}
                                </span>
                              </div>
                              <div className="rounded-lg bg-white/45 dark:bg-white/5 px-3 py-2">
                                <span className="uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                  Depth (m)
                                </span>
                                <span className="font-medium">
                                  {Number.isFinite(Number(entry.depthM))
                                    ? Number(entry.depthM)
                                    : "-"}
                                </span>
                              </div>
                              <div className="rounded-lg bg-white/45 dark:bg-white/5 px-3 py-2 sm:col-span-2">
                                <span className="uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                  Timestamp (ms)
                                </span>
                                <span className="font-medium">
                                  {Number.isFinite(Number(entry.createdAtMs))
                                    ? Number(entry.createdAtMs)
                                    : "-"}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>

            <AnimatePresence>
              {selectedRepairImageUrl && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-[10003]"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedRepairImageUrl(null)}
                    className="absolute inset-0 bg-slate-900/75"
                    aria-label="Close image preview"
                  />

                  <div className="relative z-[10004] h-full w-full flex items-center justify-center p-6">
                    <div className="relative max-h-full max-w-5xl w-full">
                      <button
                        type="button"
                        onClick={() => setSelectedRepairImageUrl(null)}
                        className="absolute -top-12 right-0 inline-flex items-center justify-center rounded-lg border border-white/30 bg-black/40 p-2 text-white hover:bg-black/60 transition-colors"
                        aria-label="Close image preview"
                      >
                        <X size={18} />
                      </button>

                      <img
                        src={selectedRepairImageUrl}
                        alt="Repair image preview"
                        className="w-full max-h-[78vh] object-contain rounded-xl border border-white/20 bg-black/30"
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </AnimatePresence>

      {/* In-Your-Face Clear All Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-auto p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/20 dark:bg-black/60 backdrop-blur-md"
              onClick={() => setShowClearConfirm(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white/40 dark:bg-slate-900/95 backdrop-blur-3xl rounded-3xl shadow-[0_8px_32px_0_rgba(31,38,135,0.15)] dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] p-7 max-w-sm w-full border border-white/50 dark:border-white/10 relative z-10"
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center mb-4 text-red-600">
                  <AlertCircle size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                  Clear All Pipelines
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 px-2">
                  Are you absolutely sure? This action cannot be undone and will
                  permanently delete all records from the grid.
                </p>

                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={isClearingAll}
                    onClick={() => {
                      handleClearAllPipelines();
                    }}
                    className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isClearingAll && (
                      <Loader2 size={14} className="animate-spin" />
                    )}
                    {isClearingAll ? "Deleting..." : "Yes, Delete All"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
