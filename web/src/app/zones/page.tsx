"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Filter, Plus, Edit2, Trash2, Loader2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { app } from "@/lib/firebase";
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";

interface ZoneRow {
  id: string;
  name: string;
  type: string;
  priority: string;
  source: string;
  pipeCount?: number;
  assetCount?: number;
  avgAge?: number;
  highRiskPipes?: number;
  avgRisk?: number;
  createdAt?: string;
  createdAtEpoch?: number;
  localPresent: boolean;
  firebaseRefs: Array<{ collection: string; docId: string }>;
}

interface ZoneAnalytics {
  pipeCount: number;
  highRiskPipes: number;
  avgAge?: number;
  avgRisk?: number;
}

interface ZoneDetailsDraft {
  id: string;
  name: string;
  type: string;
  priority: string;
  pipeCount: string;
  highRiskPipes: string;
  avgRisk: string;
}

const db = getFirestore(app);

const loadLocalZones = (): ZoneRow[] => {
  try {
    const raw = localStorage.getItem("pipeiq-map-layers");
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const features = Array.isArray(parsed?.features) ? parsed.features : [];

    const getStableZoneId = (feature: any, index: number) => {
      const props = feature?.properties || {};
      if (props.id) return props.id;
      const geometryType = feature?.geometry?.type;
      const coordinates = feature?.geometry?.coordinates;
      const point =
        geometryType === "Polygon"
          ? coordinates?.[0]?.[0]
          : Array.isArray(coordinates)
            ? coordinates
            : null;
      if (point && point.length >= 2) {
        return `ZN-${Number(point[1]).toFixed(5)}_${Number(point[0]).toFixed(5)}`;
      }
      return `ZN-${index + 1}`;
    };

    let mutated = false;

    const zones = features
      .filter(
        (feature: any) =>
          feature?.geometry?.type === "Polygon" ||
          feature?.properties?.type === "zone",
      )
      .map((feature: any, index: number) => {
        const props = feature?.properties || {};
        const id = getStableZoneId(feature, index);
        if (!props.id) {
          feature.properties = { ...props, id };
          mutated = true;
        }
        return {
          id,
          name: props.zoneName || props.name || `Zone ${index + 1}`,
          type: props.areaType || "Zone",
          priority: props.priority || "Medium",
          pipeCount: Number.isFinite(Number(props.ownedPipelineCount))
            ? Number(props.ownedPipelineCount)
            : Number.isFinite(Number(props.pipeCount))
              ? Number(props.pipeCount)
              : undefined,
          assetCount: Number.isFinite(Number(props.ownedAssetCount))
            ? Number(props.ownedAssetCount)
            : undefined,
          avgAge: Number.isFinite(Number(props.avgAge))
            ? Number(props.avgAge)
            : undefined,
          highRiskPipes: Number.isFinite(Number(props.highRiskPipes))
            ? Number(props.highRiskPipes)
            : undefined,
          avgRisk: Number.isFinite(Number(props.zoneRiskScore))
            ? Number(props.zoneRiskScore)
            : Number.isFinite(Number(props.avgRisk))
              ? Number(props.avgRisk)
              : undefined,
          createdAt: props.createdAt
            ? new Date(props.createdAt).toLocaleDateString()
            : undefined,
          createdAtEpoch: props.createdAt
            ? new Date(props.createdAt).getTime()
            : undefined,
          source: "Local",
          localPresent: true,
          firebaseRefs: [],
        };
      });

    if (mutated) {
      localStorage.setItem("pipeiq-map-layers", JSON.stringify(parsed));
      window.dispatchEvent(new Event("pipeiq_map_layers_updated"));
    }

    return zones;
  } catch {
    return [];
  }
};

const mergeZones = (localRows: ZoneRow[], firebaseRows: ZoneRow[]) => {
  const merged = new Map<string, ZoneRow>();
  [...localRows, ...firebaseRows].forEach((row) => {
    const existing = merged.get(row.id);
    if (!existing) {
      merged.set(row.id, row);
      return;
    }

    merged.set(row.id, {
      ...existing,
      name: existing.name || row.name,
      type: existing.type || row.type,
      priority: existing.priority || row.priority,
      pipeCount: Number.isFinite(existing.pipeCount)
        ? existing.pipeCount
        : row.pipeCount,
      avgAge: Number.isFinite(existing.avgAge) ? existing.avgAge : row.avgAge,
      highRiskPipes: Number.isFinite(existing.highRiskPipes)
        ? existing.highRiskPipes
        : row.highRiskPipes,
      avgRisk: Number.isFinite(existing.avgRisk)
        ? existing.avgRisk
        : row.avgRisk,
      createdAt: existing.createdAt || row.createdAt,
      createdAtEpoch: Number.isFinite(existing.createdAtEpoch)
        ? existing.createdAtEpoch
        : row.createdAtEpoch,
      source: existing.source === "Local" ? row.source : existing.source,
      localPresent: existing.localPresent || row.localPresent,
      firebaseRefs: [...existing.firebaseRefs, ...row.firebaseRefs],
    });
  });
  return Array.from(merged.values());
};

const toRiskScore100 = (pipeline: any): number | null => {
  const risk100 = Number(pipeline?.riskScore);
  if (Number.isFinite(risk100)) return Math.max(0, Math.min(100, risk100));

  const risk01 = Number(pipeline?.risk_score);
  if (Number.isFinite(risk01)) return Math.max(0, Math.min(100, risk01 * 100));

  const riskBand = String(
    pipeline?.risk_band || pipeline?.riskLevel || "",
  ).trim();
  if (riskBand === "High") return 84;
  if (riskBand === "Medium") return 50;
  if (riskBand === "Low") return 16;
  return null;
};

const isHighRiskPipeline = (pipeline: any): boolean => {
  const riskBand = String(
    pipeline?.risk_band || pipeline?.riskLevel || "",
  ).trim();
  if (riskBand === "High") return true;

  const risk100 = Number(pipeline?.riskScore);
  if (Number.isFinite(risk100)) return risk100 >= 67;

  const risk01 = Number(pipeline?.risk_score);
  if (Number.isFinite(risk01)) return risk01 >= 0.67;

  return false;
};

const getPipelineAgeYears = (pipeline: any): number | null => {
  const installationYear = Number(pipeline?.installationYear);
  if (!Number.isFinite(installationYear) || installationYear <= 0) return null;
  const age = new Date().getFullYear() - installationYear;
  if (!Number.isFinite(age) || age < 0 || age > 300) return null;
  return age;
};

const loadLocalQueuedPipelines = () => {
  try {
    const raw = localStorage.getItem("pipeiq-pipeline-queue");
    if (!raw) return [];
    const queue = JSON.parse(raw);
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
};

const buildZoneAnalytics = (pipelines: any[]): Map<string, ZoneAnalytics> => {
  const byZone = new Map<
    string,
    { count: number; highRisk: number; ageSum: number; ageCount: number }
  >();

  pipelines.forEach((pipeline) => {
    const zoneId = String(pipeline?.zoneId || "").trim();
    if (!zoneId) return;

    const bucket = byZone.get(zoneId) || {
      count: 0,
      highRisk: 0,
      ageSum: 0,
      ageCount: 0,
    };
    bucket.count += 1;
    if (isHighRiskPipeline(pipeline)) bucket.highRisk += 1;
    const age = getPipelineAgeYears(pipeline);
    if (age !== null) {
      bucket.ageSum += age;
      bucket.ageCount += 1;
    }
    byZone.set(zoneId, bucket);
  });

  const out = new Map<string, ZoneAnalytics>();
  byZone.forEach((bucket, zoneId) => {
    out.set(zoneId, {
      pipeCount: bucket.count,
      highRiskPipes: bucket.highRisk,
      avgAge:
        bucket.ageCount > 0
          ? Math.round(bucket.ageSum / bucket.ageCount)
          : undefined,
      avgRisk:
        bucket.count > 0
          ? Math.round((bucket.highRisk / bucket.count) * 100)
          : undefined,
    });
  });
  return out;
};

const applyZoneAnalytics = (
  rows: ZoneRow[],
  analytics: Map<string, ZoneAnalytics>,
) => {
  return rows.map((row) => {
    const data = analytics.get(row.id);
    if (!data) return row;
    return {
      ...row,
      pipeCount: data.pipeCount,
      highRiskPipes: data.highRiskPipes,
      avgAge: data.avgAge,
      avgRisk: data.avgRisk,
    };
  });
};

const updateLocalZoneStorage = (
  zoneId: string,
  updater: (props: any) => any,
) => {
  const raw = localStorage.getItem("pipeiq-map-layers");
  if (!raw) return;

  const parsed = JSON.parse(raw);
  const features = Array.isArray(parsed?.features) ? parsed.features : [];
  let changed = false;

  parsed.features = features.map((feature: any, index: number) => {
    const isZone =
      feature?.geometry?.type === "Polygon" ||
      feature?.properties?.type === "zone";
    if (!isZone) return feature;

    const props = feature.properties || {};
    const id = props.id || `ZN-${index + 1}`;
    if (id !== zoneId) return feature;
    changed = true;
    return {
      ...feature,
      properties: updater({ ...props, id }),
    };
  });

  if (changed) {
    localStorage.setItem("pipeiq-map-layers", JSON.stringify(parsed));
    window.dispatchEvent(new Event("pipeiq_map_layers_updated"));
  }
};

const removeLocalZoneStorage = (zoneId: string) => {
  const raw = localStorage.getItem("pipeiq-map-layers");
  if (!raw) return;

  const parsed = JSON.parse(raw);
  const features = Array.isArray(parsed?.features) ? parsed.features : [];

  parsed.features = features.filter((feature: any, index: number) => {
    const isZone =
      feature?.geometry?.type === "Polygon" ||
      feature?.properties?.type === "zone";
    if (!isZone) return true;

    const props = feature.properties || {};
    const id = props.id || `ZN-${index + 1}`;
    return id !== zoneId;
  });

  localStorage.setItem("pipeiq-map-layers", JSON.stringify(parsed));
  window.dispatchEvent(new Event("pipeiq_map_layers_updated"));
};

export default function ZonesPage() {
  type QuickFilter = "all" | "low-priority" | "medium-priority" | "high-priority";
  type SortField = "name" | "priority" | "pipes" | "avgRisk";
  type ZoneColumnKey =
    | "zone"
    | "pipes"
    | "assets"
    | "highRiskPipes"
    | "avgRisk"
    | "priority"
    | "action";
  const [searchTerm, setSearchTerm] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [zones, setZones] = useState<ZoneRow[]>(() => loadLocalZones());
  const [isLoading, setIsLoading] = useState(true);
  const [selectedZone, setSelectedZone] = useState<ZoneRow | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isDetailsEditMode, setIsDetailsEditMode] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState<ZoneDetailsDraft | null>(
    null,
  );
  const [isDetailsSaving, setIsDetailsSaving] = useState(false);
  const [selectedZoneIds, setSelectedZoneIds] = useState<Set<string>>(
    new Set(),
  );
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<ZoneColumnKey, boolean>
  >({
    zone: true,
    pipes: true,
    assets: true,
    highRiskPipes: true,
    avgRisk: true,
    priority: true,
    action: true,
  });

  useEffect(() => {
    let alive = true;
    let zonesRows: ZoneRow[] = [];
    let queueRows: ZoneRow[] = [];
    let pipelineRows: any[] = [];

    const emitAll = () => {
      if (!alive) return;
      const merged = mergeZones(loadLocalZones(), [...zonesRows, ...queueRows]);
      const analytics = buildZoneAnalytics([
        ...pipelineRows,
        ...loadLocalQueuedPipelines(),
      ]);
      setZones(applyZoneAnalytics(merged, analytics));
      setIsLoading(false);
    };

    const syncZonesLocal = () => {
      emitAll();
    };

    syncZonesLocal();

    const unsubZones = onSnapshot(
      collection(db, "zones"),
      (snapshot) => {
        zonesRows = snapshot.docs.map((entry) => {
          const data: any = entry.data() || {};
          const created = data.createdAt
            ? new Date(
                data.createdAt.toMillis?.() || data.createdAt,
              ).toLocaleDateString()
            : undefined;
          return {
            id: data.id || entry.id,
            name: data.zoneName || data.name || entry.id,
            type: data.areaType || "Zone",
            priority: data.priority || "Medium",
            pipeCount: Number.isFinite(Number(data.pipeCount))
              ? Number(data.pipeCount)
              : undefined,
            assetCount: Number.isFinite(Number(data.ownedAssetCount))
              ? Number(data.ownedAssetCount)
              : undefined,
            avgAge: Number.isFinite(Number(data.avgAge))
              ? Number(data.avgAge)
              : undefined,
            highRiskPipes: Number.isFinite(Number(data.highRiskPipes))
              ? Number(data.highRiskPipes)
              : undefined,
            avgRisk: Number.isFinite(Number(data.avgRisk))
              ? Number(data.avgRisk)
              : undefined,
            createdAt: created,
            createdAtEpoch:
              data.createdAt?.toMillis?.() ||
              (typeof data.createdAt === "number" ? data.createdAt : undefined),
            source: "Firebase",
            localPresent: false,
            firebaseRefs: [{ collection: "zones", docId: entry.id }],
          };
        });
        emitAll();
      },
      () => {
        zonesRows = [];
        emitAll();
      },
    );

    const unsubQueue = onSnapshot(
      collection(db, "zoneQueue"),
      (snapshot) => {
        queueRows = snapshot.docs.map((entry) => {
          const data: any = entry.data() || {};
          const created = data.createdAt
            ? new Date(
                data.createdAt.toMillis?.() || data.createdAt,
              ).toLocaleDateString()
            : undefined;
          return {
            id: data.id || entry.id,
            name: data.zoneName || data.name || entry.id,
            type: data.areaType || "Zone",
            priority: data.priority || "Medium",
            pipeCount: Number.isFinite(Number(data.pipeCount))
              ? Number(data.pipeCount)
              : undefined,
            assetCount: Number.isFinite(Number(data.ownedAssetCount))
              ? Number(data.ownedAssetCount)
              : undefined,
            avgAge: Number.isFinite(Number(data.avgAge))
              ? Number(data.avgAge)
              : undefined,
            highRiskPipes: Number.isFinite(Number(data.highRiskPipes))
              ? Number(data.highRiskPipes)
              : undefined,
            avgRisk: Number.isFinite(Number(data.avgRisk))
              ? Number(data.avgRisk)
              : undefined,
            createdAt: created,
            createdAtEpoch:
              data.createdAt?.toMillis?.() ||
              (typeof data.createdAt === "number" ? data.createdAt : undefined),
            source: "Queue",
            localPresent: false,
            firebaseRefs: [{ collection: "zoneQueue", docId: entry.id }],
          };
        });
        emitAll();
      },
      () => {
        queueRows = [];
        emitAll();
      },
    );

    const unsubPipelines = onSnapshot(
      collection(db, "pipelines"),
      (snapshot) => {
        pipelineRows = snapshot.docs.map((entry) => {
          const data: any = entry.data() || {};
          return {
            id: data.id || data.pipelineId || entry.id,
            zoneId: data.zoneId,
            installationYear: data.installationYear,
            riskScore: data.riskScore,
            risk_score: data.risk_score,
            risk_band: data.risk_band,
            riskLevel: data.riskLevel,
          };
        });
        emitAll();
      },
      () => {
        pipelineRows = [];
        emitAll();
      },
    );

    const onStorage = (event: StorageEvent) => {
      if (
        event.key === "pipeiq-map-layers" ||
        event.key === "pipeiq-pipeline-queue"
      ) {
        syncZonesLocal();
      }
    };

    const onMapLayersUpdated = () => syncZonesLocal();
    const onQueueUpdated = () => syncZonesLocal();

    window.addEventListener("storage", onStorage);
    window.addEventListener("pipeiq_map_layers_updated", onMapLayersUpdated);
    window.addEventListener("pipeiq_queue_updated", onQueueUpdated);
    return () => {
      alive = false;
      unsubZones();
      unsubQueue();
      unsubPipelines();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "pipeiq_map_layers_updated",
        onMapLayersUpdated,
      );
      window.removeEventListener("pipeiq_queue_updated", onQueueUpdated);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    const base = zones.filter((z) => {
      const matchesSearch =
        !q ||
        z.name.toLowerCase().includes(q) ||
        z.id.toLowerCase().includes(q);
      if (!matchesSearch) return false;

      if (quickFilter === "high-priority") return z.priority === "High";
      if (quickFilter === "medium-priority") return z.priority === "Medium";
      if (quickFilter === "low-priority") return z.priority === "Low";
      return true;
    });

    const priorityWeight: Record<string, number> = {
      High: 3,
      Medium: 2,
      Low: 1,
    };
    const dir = sortDirection === "asc" ? 1 : -1;

    return [...base].sort((a, b) => {
      if (sortField === "priority") {
        const av = priorityWeight[a.priority] || 0;
        const bv = priorityWeight[b.priority] || 0;
        return (av - bv) * dir;
      }
      if (sortField === "pipes") {
        const av = Number.isFinite(a.pipeCount) ? Number(a.pipeCount) : -1;
        const bv = Number.isFinite(b.pipeCount) ? Number(b.pipeCount) : -1;
        return (av - bv) * dir;
      }
      if (sortField === "avgRisk") {
        const av = Number.isFinite(a.avgRisk) ? Number(a.avgRisk) : -1;
        const bv = Number.isFinite(b.avgRisk) ? Number(b.avgRisk) : -1;
        return (av - bv) * dir;
      }
      return a.name.localeCompare(b.name) * dir;
    });
  }, [zones, searchTerm, quickFilter, sortField, sortDirection]);

  const paginatedRows = useMemo(
    () =>
      filtered.slice(
        (currentPage - 1) * rowsPerPage,
        currentPage * rowsPerPage,
      ),
    [filtered, currentPage, rowsPerPage],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));

  const hasActiveFilters =
    quickFilter !== "all" || searchTerm.trim().length > 0;

  const bandPillClass = (band?: string) => {
    const normalized = String(band || "Medium").toLowerCase();
    if (normalized === "high") {
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200";
    }
    if (normalized === "low") {
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200";
    }
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200";
  };

  const filterPillClass = (key: QuickFilter) => {
    const active = quickFilter === key;
    if (key === "high-priority") {
      return active
        ? "!border-red-600 !bg-red-600 !text-white"
        : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200";
    }
    if (key === "medium-priority") {
      return active
        ? "!border-amber-500 !bg-amber-500 !text-white"
        : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200";
    }
    if (key === "low-priority") {
      return active
        ? "!border-emerald-600 !bg-emerald-600 !text-white"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200";
    }
    return active
      ? "!border-sky-300 !bg-sky-200 !text-sky-950 dark:!border-amber-200/40 dark:!bg-amber-300 dark:!text-slate-900"
      : "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";
  };

  const gridStats = useMemo(() => {
    const total = zones.length;
    const highPriority = zones.filter((z) => z.priority === "High").length;
    const highRiskZones = zones.filter(
      (z) =>
        Number(z.highRiskPipes || 0) > 0 ||
        (Number.isFinite(Number(z.avgRisk)) && Number(z.avgRisk) >= 50),
    ).length;
    return { total, highPriority, highRiskZones };
  }, [zones]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, quickFilter, rowsPerPage]);

  const toDraft = (item: ZoneRow): ZoneDetailsDraft => ({
    id: item.id,
    name: item.name,
    type: item.type,
    priority: item.priority,
    pipeCount: Number.isFinite(item.pipeCount) ? String(item.pipeCount) : "",
    highRiskPipes: Number.isFinite(item.highRiskPipes)
      ? String(item.highRiskPipes)
      : "",
    avgRisk: Number.isFinite(item.avgRisk) ? String(item.avgRisk) : "",
  });

  const openZoneDetails = (item: ZoneRow, startInEditMode = false) => {
    setSelectedZone(item);
    setDetailsDraft(toDraft(item));
    setIsDetailsEditMode(startInEditMode);
    setIsDetailsOpen(true);
  };

  const closeZoneDetails = () => {
    setIsDetailsOpen(false);
    setIsDetailsEditMode(false);
    setIsDetailsSaving(false);
    setSelectedZone(null);
    setDetailsDraft(null);
  };

  const hasUnsavedZoneChanges = !!(
    isDetailsOpen &&
    isDetailsEditMode &&
    selectedZone &&
    detailsDraft &&
    JSON.stringify(detailsDraft) !== JSON.stringify(toDraft(selectedZone))
  );

  const requestCloseZoneDetails = () => {
    if (hasUnsavedZoneChanges) {
      toast.warning("Leave without saving?", {
        description: "You have unsaved changes for this zone.",
        action: {
          label: "Discard",
          onClick: () => closeZoneDetails(),
        },
        cancel: {
          label: "Keep Editing",
          onClick: () => undefined,
        },
      });
      return;
    }
    closeZoneDetails();
  };

  const saveZoneDetails = async () => {
    if (!selectedZone || !detailsDraft || isDetailsSaving) return;

    const payload: Record<string, any> = {
      name: detailsDraft.name,
      zoneName: detailsDraft.name,
      type: detailsDraft.type,
      areaType: detailsDraft.type,
      priority: detailsDraft.priority,
    };

    setIsDetailsSaving(true);
    try {
      if (selectedZone.localPresent) {
        updateLocalZoneStorage(selectedZone.id, (props) => ({
          ...props,
          ...payload,
        }));
      }

      await Promise.all(
        selectedZone.firebaseRefs.map(async (ref) => {
          try {
            await updateDoc(doc(db, ref.collection, ref.docId), payload);
          } catch {
            // Ignore one-off doc failures.
          }
        }),
      );

      const updated: ZoneRow = {
        ...selectedZone,
        name: detailsDraft.name,
        type: detailsDraft.type,
        priority: detailsDraft.priority,
      };

      setZones((prev) =>
        prev.map((z) => (z.id === selectedZone.id ? updated : z)),
      );
      setSelectedZone(updated);
      setDetailsDraft(toDraft(updated));
      setIsDetailsEditMode(false);
      toast.success("Zone details saved.");
    } finally {
      setIsDetailsSaving(false);
    }
  };

  const confirmSaveZoneDetails = () => {
    if (!selectedZone) return;
    toast.warning("Save zone changes?", {
      description: `Save updates for ${selectedZone.name || selectedZone.id}?`,
      action: {
        label: "Save",
        onClick: () => {
          void saveZoneDetails();
        },
      },
      cancel: {
        label: "Cancel",
        onClick: () => undefined,
      },
    });
  };

  const handleEditZone = async (item: ZoneRow) => {
    openZoneDetails(item, true);
  };

  const handleDeleteZone = async (item: ZoneRow) => {
    setZones((prev) => prev.filter((zone) => zone.id !== item.id));

    if (item.localPresent) {
      removeLocalZoneStorage(item.id);
    }

    await Promise.all(
      item.firebaseRefs.map(async (ref) => {
        try {
          await deleteDoc(doc(db, ref.collection, ref.docId));
        } catch {
          // Continue even if one backend source fails.
        }
      }),
    );

    toast.success(`Zone ${item.id} was deleted.`);
  };

  const handleBulkDeleteZones = async () => {
    if (isBulkDeleting || selectedZoneIds.size === 0) return;
    const targets = zones.filter((z) => selectedZoneIds.has(z.id));
    if (targets.length === 0) return;

    setIsBulkDeleting(true);
    setZones((prev) => prev.filter((z) => !selectedZoneIds.has(z.id)));

    try {
      await Promise.all(
        targets.flatMap((item) =>
          item.firebaseRefs.map(async (ref) => {
            try {
              await deleteDoc(doc(db, ref.collection, ref.docId));
            } catch {
              // Ignore one-off failures in bulk delete.
            }
          }),
        ),
      );

      targets.forEach((item) => {
        if (item.localPresent) removeLocalZoneStorage(item.id);
      });

      toast.success(`${targets.length} zone(s) deleted.`);
      setSelectedZoneIds(new Set());
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const exportToCSV = () => {
    const headers = [
      "Zone",
      "Pipes",
      "Assets",
      "High Risk Pipes",
      "Avg Risk",
      "Priority",
    ];
    const rows = filtered.map((z) => [
      z.name || z.id,
      Number.isFinite(z.pipeCount) ? z.pipeCount : "-",
      Number.isFinite(z.assetCount) ? z.assetCount : "-",
      Number.isFinite(z.highRiskPipes) ? z.highRiskPipes : "-",
      Number.isFinite(z.avgRisk) ? z.avgRisk : "-",
      z.priority || "-",
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      headers.join(",") +
      "\n" +
      rows.map((e) => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "zones_data.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const readOnlyInputClass =
    "px-3 py-2.5 border rounded-xl text-sm font-medium shadow-sm transition-all bg-white/40 dark:bg-slate-800/60 border-white/40 dark:border-white/10 text-slate-600 dark:text-slate-200";
  const editableInputClass =
    "px-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/20 dark:focus:ring-white/15 text-sm font-medium shadow-sm transition-all bg-white/70 dark:bg-slate-800/85 border-white/50 dark:border-white/10 text-slate-900 dark:text-white";
  const checkboxClass =
    "h-4 w-4 appearance-none rounded-md border border-slate-300/80 dark:border-white/20 bg-white/90 dark:bg-slate-800/80 checked:bg-amber-500 checked:border-amber-500 focus:ring-2 focus:ring-amber-400/60 focus:ring-offset-0 transition-colors cursor-pointer";

  return (
    <div className="h-full flex flex-col p-6 gap-6 relative overflow-hidden pointer-events-none">
      {/* Full Page Liquid Glass Overlay - Animated Entry */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="absolute inset-4 rounded-3xl glass-panel pointer-events-auto flex flex-col overflow-hidden"
      >
        <div className="p-6 border-b border-white/20 flex justify-between items-center flex-none">
          <div>
            <h1 className="text-3xl font-light tracking-tight text-[hsl(var(--foreground))]">
              Zones
            </h1>
            <p className="text-[hsl(var(--muted-foreground))] text-sm font-light flex items-center gap-2">
              <span>Manage District Metered Areas (DMAs) and Zones.</span>
              {isLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" />
                  Syncing...
                </span>
              ) : (
                <span>{`${zones.length} loaded`}</span>
              )}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={exportToCSV}
              className="glass-button flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm text-[hsl(var(--foreground))] hover:bg-sky-100/80 hover:text-sky-900 dark:hover:bg-amber-800/25 dark:hover:text-amber-200 shadow-sm border border-white/30"
            >
              Export
            </button>
            <button
              onClick={() =>
                toast.info("Add new zones from the map drawing tools.")
              }
              className="glass-button flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm text-[hsl(var(--foreground))] hover:bg-sky-100/80 hover:text-sky-900 dark:hover:bg-amber-800/25 dark:hover:text-amber-200 shadow-sm"
            >
              <Plus size={16} />
              Add Zone
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
              placeholder="Search zones..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-white/40 border border-white/30 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/5 placeholder:text-gray-500 transition-all focus:bg-white/60"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              Sort
            </span>
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="glass-button px-2.5 py-2 rounded-xl text-sm bg-white/40 border border-white/30"
            >
              <option value="name">Name</option>
              <option value="priority">Priority</option>
              <option value="pipes">Pipes</option>
              <option value="avgRisk">Avg Risk</option>
            </select>
            <button
              onClick={() =>
                setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
              }
              className="glass-button px-2.5 py-2 rounded-xl text-sm bg-white/40 border border-white/30 hover:bg-sky-100/80 dark:hover:bg-amber-800/25 hover:text-sky-900 dark:hover:text-amber-200"
              title="Toggle sort direction"
            >
              {sortDirection === "asc" ? "Asc" : "Desc"}
            </button>
          </div>
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
            <Filter size={14} />
            Quick Filters
          </span>
          {(
            [
              { key: "all", label: "All" },
              { key: "low-priority", label: "Low" },
              { key: "medium-priority", label: "Medium" },
              { key: "high-priority", label: "High Priority" },
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
              className="ml-auto px-2.5 py-1.5 rounded-lg text-xs border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-sky-100/80 dark:hover:bg-amber-800/25 hover:text-sky-900 dark:hover:text-amber-200"
            >
              Reset Filters
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowColumnMenu((prev) => !prev)}
              className="px-2.5 py-1.5 rounded-lg text-xs border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-sky-100/80 dark:hover:bg-amber-800/25 hover:text-sky-900 dark:hover:text-amber-200"
            >
              Columns
            </button>
            <button
              disabled={selectedZoneIds.size === 0 || isBulkDeleting}
              onClick={() => {
                toast.error("Delete selected zones?", {
                  description: `This will permanently remove ${selectedZoneIds.size} zone(s).`,
                  action: {
                    label: "Delete",
                    onClick: () => {
                      void handleBulkDeleteZones();
                    },
                  },
                  actionButtonStyle: {
                    backgroundColor: "#ef4444",
                    color: "white",
                  },
                });
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs border border-red-300/40 dark:border-red-500/30 bg-red-50/70 dark:bg-red-500/15 text-red-600 dark:text-red-300 hover:bg-sky-100/80 dark:hover:bg-amber-800/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBulkDeleting
                ? "Deleting..."
                : `Delete Selected (${selectedZoneIds.size})`}
            </button>
          </div>
          {showColumnMenu && (
            <div className="w-full mt-2 p-2 rounded-xl border border-white/30 dark:border-white/10 bg-white/60 dark:bg-slate-800/70 grid grid-cols-2 md:grid-cols-4 gap-2">
              {(
                [
                  ["zone", "Zone"],
                  ["pipes", "Pipes"],
                  ["assets", "Assets"],
                  ["highRiskPipes", "High Risk Pipes"],
                  ["avgRisk", "Avg Risk"],
                  ["priority", "Priority"],
                  ["action", "Action"],
                ] as Array<[ZoneColumnKey, string]>
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

        <div className="px-4 py-3 border-b border-white/20 grid grid-cols-1 md:grid-cols-3 gap-2 bg-white/5">
          <div className="rounded-xl border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total Zones
            </p>
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {gridStats.total}
            </p>
          </div>
          <div className="rounded-xl border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              High Priority
            </p>
            <p className="text-base font-semibold text-red-700 dark:text-red-200">
              {gridStats.highPriority}
            </p>
          </div>
          <div className="rounded-xl border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              High Risk Zones
            </p>
            <p className="text-base font-semibold text-red-700 dark:text-red-200">
              {gridStats.highRiskZones}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 relative">
          {isLoading && (
            <div className="absolute inset-4 z-10 flex items-center justify-center pointer-events-none">
              <div className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/70 dark:bg-slate-900/70 px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] backdrop-blur-md">
                <Loader2 size={15} className="animate-spin" />
                Loading zones...
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
                        paginatedRows.every((z) => selectedZoneIds.has(z.id))
                      }
                      onChange={(e) => {
                        const next = new Set(selectedZoneIds);
                        if (e.target.checked)
                          paginatedRows.forEach((z) => next.add(z.id));
                        else paginatedRows.forEach((z) => next.delete(z.id));
                        setSelectedZoneIds(next);
                      }}
                      className={checkboxClass}
                    />
                  </th>
                  {columnVisibility.zone && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Zone
                    </th>
                  )}
                  {columnVisibility.pipes && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Pipes
                    </th>
                  )}
                  {columnVisibility.assets && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Assets
                    </th>
                  )}
                  {columnVisibility.highRiskPipes && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      High Risk Pipes
                    </th>
                  )}
                  {columnVisibility.avgRisk && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Avg Risk
                    </th>
                  )}
                  {columnVisibility.priority && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Priority
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
                {paginatedRows.map((item, rowIndex) => {
                  const rowBgClass =
                    rowIndex % 2 === 0
                      ? "bg-white/35 dark:bg-slate-900/25"
                      : "bg-white/20 dark:bg-slate-900/15";
                  const cellBgClass = rowBgClass;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => openZoneDetails(item, false)}
                      className="border-t border-white/15 dark:border-white/5"
                    >
                      <td
                        className={`px-4 py-3 w-10 ${cellBgClass}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedZoneIds.has(item.id)}
                          onChange={(e) => {
                            const next = new Set(selectedZoneIds);
                            if (e.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            setSelectedZoneIds(next);
                          }}
                          className={checkboxClass}
                        />
                      </td>
                      {columnVisibility.zone && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                        >
                          {item.name || item.id}
                        </td>
                      )}
                      {columnVisibility.pipes && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                        >
                          {Number.isFinite(item.pipeCount)
                            ? item.pipeCount
                            : "-"}
                        </td>
                      )}
                      {columnVisibility.assets && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                        >
                          {Number.isFinite(item.assetCount)
                            ? item.assetCount
                            : "-"}
                        </td>
                      )}
                      {columnVisibility.highRiskPipes && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                        >
                          {Number.isFinite(item.highRiskPipes)
                            ? item.highRiskPipes
                            : "-"}
                        </td>
                      )}
                      {columnVisibility.avgRisk && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                        >
                          {Number.isFinite(item.avgRisk) ? item.avgRisk : "-"}
                        </td>
                      )}
                      {columnVisibility.priority && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${cellBgClass}`}
                        >
                          <span
                            className={`inline-flex min-w-[4.75rem] items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold ${bandPillClass(item.priority)}`}
                          >
                            {item.priority || "Medium"}
                          </span>
                        </td>
                      )}
                      {columnVisibility.action && (
                        <td
                          className={`px-4 py-3 text-right sticky right-0 ${cellBgClass}`}
                        >
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditZone(item);
                              }}
                              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 bg-white/40 dark:bg-slate-800/60 border border-white/30 dark:border-white/10 hover:bg-sky-100/80 dark:hover:bg-amber-800/25 hover:text-sky-900 dark:hover:text-amber-200"
                              title="Edit zone"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteZone(item);
                              }}
                              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 bg-white/40 dark:bg-slate-800/60 border border-white/30 dark:border-white/10 hover:bg-sky-100/80 dark:hover:bg-amber-800/25 hover:text-sky-900 dark:hover:text-amber-200"
                              title="Delete zone"
                            >
                              <Trash2 size={15} />
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
                        (columnVisibility.zone ? 1 : 0) +
                        (columnVisibility.pipes ? 1 : 0) +
                        (columnVisibility.assets ? 1 : 0) +
                        (columnVisibility.highRiskPipes ? 1 : 0) +
                        (columnVisibility.avgRisk ? 1 : 0) +
                        (columnVisibility.priority ? 1 : 0) +
                        (columnVisibility.action ? 1 : 0)
                      }
                      className="px-4 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]"
                    >
                      No zones found in Firebase.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

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
              className="px-3 py-1 bg-white/40 rounded-lg hover:bg-sky-100/80 hover:text-sky-900 dark:hover:bg-amber-800/25 dark:hover:text-amber-200 disabled:opacity-50 disabled:hover:bg-white/40 transition-colors"
            >
              Previous
            </button>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((c) => Math.min(totalPages, c + 1))}
              className="px-3 py-1 bg-white/40 rounded-lg hover:bg-sky-100/80 hover:text-sky-900 dark:hover:bg-amber-800/25 dark:hover:text-amber-200 disabled:opacity-50 disabled:hover:bg-white/40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {isDetailsOpen && selectedZone && detailsDraft && (
          <div className="fixed inset-0 z-[10001] flex items-center justify-center pointer-events-auto p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={requestCloseZoneDetails}
              className="absolute inset-0 bg-slate-900/20 dark:bg-black/60 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative w-full max-w-2xl bg-white/40 dark:bg-slate-900/95 backdrop-blur-3xl border border-white/50 dark:border-white/10 rounded-2xl shadow-[0_8px_32px_0_rgba(31,38,135,0.15)] dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-800/60">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                    Zone Details
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {selectedZone.name || selectedZone.id}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!isDetailsEditMode ? (
                    <button
                      type="button"
                      onClick={() => setIsDetailsEditMode(true)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/80 dark:border-white/10 text-slate-700 dark:text-slate-200 bg-white/60 dark:bg-slate-700/80 hover:bg-sky-100/80 dark:hover:bg-amber-800/25 hover:text-sky-900 dark:hover:text-amber-200 transition-all"
                    >
                      Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsDetailsEditMode(false);
                        setDetailsDraft(toDraft(selectedZone));
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/80 dark:border-white/10 text-slate-700 dark:text-slate-200 bg-white/60 dark:bg-slate-700/80 hover:bg-sky-100/80 dark:hover:bg-amber-800/25 hover:text-sky-900 dark:hover:text-amber-200 transition-all"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={requestCloseZoneDetails}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-sky-900 hover:bg-sky-100/80 dark:text-slate-400 dark:hover:text-amber-200 dark:hover:bg-amber-800/25 transition-colors"
                    aria-label="Close zone details"
                    title="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto max-h-[70vh] bg-white/10 dark:bg-white/5">
                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-600 dark:text-slate-400 flex items-center gap-2 mb-3">
                  <span className="w-4 h-[1px] bg-current opacity-40" />
                  Identifiers & Core Details
                  <span className="flex-1 h-[1px] bg-current opacity-40" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Zone ID
                    </label>
                    <input
                      type="text"
                      value={detailsDraft.id}
                      disabled
                      className={readOnlyInputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Zone Name
                    </label>
                    <input
                      type="text"
                      value={detailsDraft.name}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, name: e.target.value } : prev,
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Area Type
                    </label>
                    <input
                      type="text"
                      value={detailsDraft.type}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, type: e.target.value } : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Priority
                    </label>
                    <select
                      value={detailsDraft.priority}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, priority: e.target.value } : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    >
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </div>
                </div>

                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-600 dark:text-slate-400 flex items-center gap-2 mt-5 mb-3">
                  <span className="w-4 h-[1px] bg-current opacity-40" />
                  Analytics
                  <span className="flex-1 h-[1px] bg-current opacity-40" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Pipes
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={detailsDraft.pipeCount}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, pipeCount: e.target.value } : prev,
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      High Risk Pipes
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={detailsDraft.highRiskPipes}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev
                            ? { ...prev, highRiskPipes: e.target.value }
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
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Avg Risk
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={detailsDraft.avgRisk}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, avgRisk: e.target.value } : prev,
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

              </div>

              <div className="p-5 border-t border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-800/60 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isDetailsEditMode
                    ? "Review your edits, then save."
                    : "Click Edit to update zone details."}
                </p>
                {isDetailsEditMode && (
                  <button
                    type="button"
                    disabled={isDetailsSaving}
                    onClick={confirmSaveZoneDetails}
                    className="px-8 py-2.5 rounded-xl text-sm font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:bg-sky-200 hover:text-sky-950 dark:hover:bg-amber-700/40 dark:hover:text-amber-100 transition-all disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center gap-2"
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
    </div>
  );
}
