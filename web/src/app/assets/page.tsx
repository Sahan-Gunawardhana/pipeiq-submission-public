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

interface AssetRow {
  id: string;
  name: string;
  type: string;
  zoneId?: string;
  zone: string;
  location: string;
  severity: string;
  status: string;
  createdAt: string;
  createdAtEpoch?: number;
  localPresent: boolean;
  firebaseRefs: Array<{ collection: string; docId: string }>;
}

interface AssetDetailsDraft {
  id: string;
  name: string;
  type: string;
  zone: string;
  severity: string;
  status: string;
  createdAt: string;
}

const db = getFirestore(app);

type QuickFilter = "all" | "high-severity" | "inactive";
type SortField = "id" | "severity";
type AssetColumnKey =
  | "markerId"
  | "assetName"
  | "type"
  | "zone"
  | "location"
  | "severity"
  | "status"
  | "action";

const normalizeSeverity = (value: unknown): string => {
  const raw = String(value || "Medium")
    .trim()
    .toLowerCase();
  if (raw === "high" || raw === "critical") return "High";
  if (raw === "low") return "Low";
  return "Medium";
};

const normalizeStatus = (value: unknown): string => {
  const raw = String(value || "Active")
    .trim()
    .toLowerCase();
  if (raw === "inactive" || raw === "disabled") return "Inactive";
  if (raw === "maintenance" || raw === "under maintenance")
    return "Maintenance";
  return "Active";
};

const parseCreatedAt = (value: any): { label: string; epoch?: number } => {
  if (!value) return { label: "-" };

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return { label: date.toLocaleDateString(), epoch: date.getTime() };
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const date = new Date(numeric);
    return { label: date.toLocaleDateString(), epoch: date.getTime() };
  }

  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return { label: parsed.toLocaleDateString(), epoch: parsed.getTime() };
  }

  return { label: String(value) };
};

const NWSDB_ASSET_TYPES = [
  "Water Meter",
  "Leak Detection Point",
  "Service Connection",
  "Pressure Monitoring Point",
  "Quality Monitoring Point",
  "Valve (Ball)",
  "Valve (Gate)",
  "Valve (Check)",
  "Pump Station Connection",
  "Reservoir / Tank",
  "Standpipe",
  "Boundary Marker",
  "Dead End",
  "Bulk Meter",
  "PRV Station",
  "Air Valve",
  "Sump/Clean-out",
  "Other",
];

const loadLocalAssets = (): AssetRow[] => {
  try {
    const raw = localStorage.getItem("pipeiq-map-layers");
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const features = Array.isArray(parsed?.features) ? parsed.features : [];

    return features
      .filter((feature: any) => {
        if (feature?.geometry?.type !== "Point") return false;
        const leafletType = feature?.properties?._leafletType;
        return leafletType !== "CircleMarker";
      })
      .map((feature: any, index: number) => {
        const props = feature?.properties || {};
        const created = parseCreatedAt(
          props.createdAt || props.created_at || props.timestamp,
        );
        const coords = feature?.geometry?.coordinates;
        const locationFromCoords =
          Array.isArray(coords) && coords.length === 2
            ? `${Number(coords[1]).toFixed(5)}, ${Number(coords[0]).toFixed(5)}`
            : "";

        return {
          id: String(props.id || props.markerId || `MK-${index + 1}`),
          name: String(
            props.name ||
              props.assetName ||
              props.location ||
              `Asset ${index + 1}`,
          ),
          type: props.type || "Marker",
          zoneId: props.zoneId ? String(props.zoneId) : undefined,
          zone: String(
            props.zoneName || props.zone || props.zoneId || "Unassigned",
          ),
          location: String(
            props.location || props.address || locationFromCoords || "-",
          ),
          severity: normalizeSeverity(
            props.severity || props.priority || props.riskLevel,
          ),
          status: normalizeStatus(props.status || props.condition),
          createdAt: created.label,
          createdAtEpoch: created.epoch,
          localPresent: true,
          firebaseRefs: [],
        };
      });
  } catch {
    return [];
  }
};

const mergeAssets = (localRows: AssetRow[], firebaseRows: AssetRow[]) => {
  const merged = new Map<string, AssetRow>();

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
      zoneId: existing.zoneId || row.zoneId,
      zone: existing.zone || row.zone,
      location:
        existing.location && existing.location !== "-"
          ? existing.location
          : row.location,
      severity: existing.severity || row.severity,
      status: existing.status || row.status,
      createdAt:
        existing.createdAt !== "-" ? existing.createdAt : row.createdAt,
      createdAtEpoch: Number.isFinite(existing.createdAtEpoch)
        ? existing.createdAtEpoch
        : row.createdAtEpoch,
      localPresent: existing.localPresent || row.localPresent,
      firebaseRefs: [...existing.firebaseRefs, ...row.firebaseRefs],
    });
  });

  return Array.from(merged.values());
};

const updateLocalAssetStorage = (
  assetId: string,
  updater: (props: any) => any,
) => {
  const raw = localStorage.getItem("pipeiq-map-layers");
  if (!raw) return;

  const parsed = JSON.parse(raw);
  const features = Array.isArray(parsed?.features) ? parsed.features : [];
  let changed = false;

  parsed.features = features.map((feature: any, index: number) => {
    if (feature?.geometry?.type !== "Point") return feature;
    const props = feature?.properties || {};
    const id = String(props.id || props.markerId || `MK-${index + 1}`);
    if (id !== assetId) return feature;
    changed = true;
    return {
      ...feature,
      properties: updater({ ...props, id, markerId: id }),
    };
  });

  if (changed) {
    localStorage.setItem("pipeiq-map-layers", JSON.stringify(parsed));
    window.dispatchEvent(new Event("pipeiq_map_layers_updated"));
  }
};

const removeLocalAssetStorage = (assetId: string) => {
  const raw = localStorage.getItem("pipeiq-map-layers");
  if (!raw) return;

  const parsed = JSON.parse(raw);
  const features = Array.isArray(parsed?.features) ? parsed.features : [];

  parsed.features = features.filter((feature: any, index: number) => {
    if (feature?.geometry?.type !== "Point") return true;
    const props = feature?.properties || {};
    const id = String(props.id || props.markerId || `MK-${index + 1}`);
    return id !== assetId;
  });

  localStorage.setItem("pipeiq-map-layers", JSON.stringify(parsed));
  window.dispatchEvent(new Event("pipeiq_map_layers_updated"));
};

export default function AssetsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [sortField, setSortField] = useState<SortField>("id");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const [assets, setAssets] = useState<AssetRow[]>(() => loadLocalAssets());
  const [isLoading, setIsLoading] = useState(true);

  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isDetailsEditMode, setIsDetailsEditMode] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState<AssetDetailsDraft | null>(
    null,
  );
  const [isDetailsSaving, setIsDetailsSaving] = useState(false);

  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    new Set(),
  );
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  const [columnVisibility, setColumnVisibility] = useState<
    Record<AssetColumnKey, boolean>
  >({
    markerId: true,
    assetName: true,
    type: true,
    zone: true,
    location: true,
    severity: true,
    status: true,
    action: true,
  });

  useEffect(() => {
    let alive = true;
    let markersRows: AssetRow[] = [];
    let queueRows: AssetRow[] = [];

    const syncLocal = () => {
      const localRows = loadLocalAssets();
      if (alive)
        setAssets(mergeAssets(localRows, [...markersRows, ...queueRows]));
    };

    const emitFirebase = () => {
      if (!alive) return;
      setAssets(mergeAssets(loadLocalAssets(), [...markersRows, ...queueRows]));
      setIsLoading(false);
    };

    syncLocal();

    const unsubMarkers = onSnapshot(
      collection(db, "markers"),
      (snapshot) => {
        markersRows = snapshot.docs.map((entry) => {
          const data: any = entry.data() || {};
          const created = parseCreatedAt(
            data.createdAt || data.created_at || data.timestamp,
          );
          return {
            id: String(data.id || data.markerId || entry.id),
            name: String(
              data.name || data.assetName || data.location || "Unnamed Asset",
            ),
            type: data.type || "Marker",
            zoneId: data.zoneId ? String(data.zoneId) : undefined,
            zone: String(
              data.zoneName || data.zone || data.zoneId || "Unassigned",
            ),
            location: String(data.location || data.address || "-"),
            severity: normalizeSeverity(
              data.severity || data.priority || data.riskLevel,
            ),
            status: normalizeStatus(data.status || data.condition),
            createdAt: created.label,
            createdAtEpoch: created.epoch,
            localPresent: false,
            firebaseRefs: [{ collection: "markers", docId: entry.id }],
          };
        });
        emitFirebase();
      },
      () => {
        markersRows = [];
        emitFirebase();
      },
    );

    const unsubQueue = onSnapshot(
      collection(db, "markerQueue"),
      (snapshot) => {
        queueRows = snapshot.docs.map((entry) => {
          const data: any = entry.data() || {};
          const created = parseCreatedAt(
            data.createdAt || data.created_at || data.timestamp,
          );
          return {
            id: String(data.id || data.markerId || entry.id),
            name: String(
              data.name || data.assetName || data.location || "Unnamed Asset",
            ),
            type: data.type || "Marker",
            zoneId: data.zoneId ? String(data.zoneId) : undefined,
            zone: String(
              data.zoneName || data.zone || data.zoneId || "Unassigned",
            ),
            location: String(data.location || data.address || "-"),
            severity: normalizeSeverity(
              data.severity || data.priority || data.riskLevel,
            ),
            status: normalizeStatus(data.status || data.condition),
            createdAt: created.label,
            createdAtEpoch: created.epoch,
            localPresent: false,
            firebaseRefs: [{ collection: "markerQueue", docId: entry.id }],
          };
        });
        emitFirebase();
      },
      () => {
        queueRows = [];
        emitFirebase();
      },
    );

    const onStorage = (event: StorageEvent) => {
      if (event.key === "pipeiq-map-layers") syncLocal();
    };

    const onMapLayersUpdated = () => syncLocal();

    window.addEventListener("storage", onStorage);
    window.addEventListener("pipeiq_map_layers_updated", onMapLayersUpdated);

    return () => {
      alive = false;
      unsubMarkers();
      unsubQueue();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "pipeiq_map_layers_updated",
        onMapLayersUpdated,
      );
    };
  }, []);

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    const base = assets.filter((a) => {
      const matchesSearch =
        !q ||
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        a.zone.toLowerCase().includes(q) ||
        a.location.toLowerCase().includes(q) ||
        a.status.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (quickFilter === "high-severity") return a.severity === "High";
      if (quickFilter === "inactive") return a.status === "Inactive";
      return true;
    });

    const severityWeight: Record<string, number> = {
      High: 3,
      Medium: 2,
      Low: 1,
    };
    const dir = sortDirection === "asc" ? 1 : -1;

    return [...base].sort((a, b) => {
      if (sortField === "severity") {
        const av = severityWeight[a.severity] || 0;
        const bv = severityWeight[b.severity] || 0;
        return (av - bv) * dir;
      }
      return a.id.localeCompare(b.id) * dir;
    });
  }, [assets, quickFilter, searchTerm, sortDirection, sortField]);

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

  const severityPillClass = (severity?: string) => {
    const normalized = String(severity || "Medium").toLowerCase();
    if (normalized === "high") {
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200";
    }
    if (normalized === "low") {
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200";
    }
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200";
  };

  const statusPillClass = (status?: string) => {
    const normalized = String(status || "Active").toLowerCase();
    if (normalized === "inactive") {
      return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";
    }
    if (normalized === "maintenance") {
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200";
    }
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200";
  };

  const filterPillClass = (key: QuickFilter) => {
    const active = quickFilter === key;
    if (key === "high-severity") {
      return active
        ? "!border-red-600 !bg-red-600 !text-white"
        : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200";
    }
    if (key === "inactive") {
      return active
        ? "!border-slate-700 !bg-slate-700 !text-white dark:!border-slate-200 dark:!bg-slate-200 dark:!text-slate-900"
        : "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";
    }
    return active
      ? "!border-sky-300 !bg-sky-200 !text-sky-950 dark:!border-amber-200/40 dark:!bg-amber-300 dark:!text-slate-900"
      : "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";
  };

  const gridStats = useMemo(() => {
    const total = assets.length;
    const active = assets.filter((a) => a.status === "Active").length;
    return { total, active };
  }, [assets]);

  useEffect(() => {
    setCurrentPage(1);
  }, [quickFilter, rowsPerPage, searchTerm]);

  const toDraft = (item: AssetRow): AssetDetailsDraft => ({
    id: item.id,
    name: item.name,
    type: item.type,
    zone: item.zone,
    severity: item.severity,
    status: item.status,
    createdAt: item.createdAt,
  });

  const openAssetDetails = (item: AssetRow, startInEditMode = false) => {
    setSelectedAsset(item);
    setDetailsDraft(toDraft(item));
    setIsDetailsEditMode(startInEditMode);
    setIsDetailsOpen(true);
  };

  const closeAssetDetails = () => {
    setIsDetailsOpen(false);
    setIsDetailsEditMode(false);
    setIsDetailsSaving(false);
    setSelectedAsset(null);
    setDetailsDraft(null);
  };

  const hasUnsavedChanges = !!(
    isDetailsOpen &&
    isDetailsEditMode &&
    selectedAsset &&
    detailsDraft &&
    JSON.stringify(detailsDraft) !== JSON.stringify(toDraft(selectedAsset))
  );

  const requestCloseAssetDetails = () => {
    if (hasUnsavedChanges) {
      toast.warning("Leave without saving?", {
        description: "You have unsaved changes for this asset.",
        action: {
          label: "Discard",
          onClick: () => closeAssetDetails(),
        },
        cancel: {
          label: "Keep Editing",
          onClick: () => undefined,
        },
      });
      return;
    }
    closeAssetDetails();
  };

  const saveAssetDetails = async () => {
    if (!selectedAsset || !detailsDraft || isDetailsSaving) return;

    const payload: Record<string, any> = {
      id: detailsDraft.id,
      markerId: detailsDraft.id,
      name: detailsDraft.name,
      type: detailsDraft.type,
      zoneId: selectedAsset.zoneId || detailsDraft.zone,
      zoneName: detailsDraft.zone,
      zone: detailsDraft.zone,
      severity: detailsDraft.severity,
      status: detailsDraft.status,
      condition: detailsDraft.status,
      createdAt: detailsDraft.createdAt,
    };

    setIsDetailsSaving(true);
    try {
      if (selectedAsset.localPresent) {
        updateLocalAssetStorage(selectedAsset.id, (props) => ({
          ...props,
          ...payload,
        }));
      }

      await Promise.all(
        selectedAsset.firebaseRefs.map(async (ref) => {
          try {
            await updateDoc(doc(db, ref.collection, ref.docId), payload);
          } catch {
            // Ignore one-off update failures.
          }
        }),
      );

      const updated: AssetRow = {
        ...selectedAsset,
        id: detailsDraft.id,
        name: detailsDraft.name,
        type: detailsDraft.type,
        zone: detailsDraft.zone,
        severity: detailsDraft.severity,
        status: detailsDraft.status,
        createdAt: detailsDraft.createdAt,
      };

      setAssets((prev) =>
        prev.map((a) => (a.id === selectedAsset.id ? updated : a)),
      );
      setSelectedAsset(updated);
      setDetailsDraft(toDraft(updated));
      setIsDetailsEditMode(false);
      toast.success("Asset details saved.");
    } finally {
      setIsDetailsSaving(false);
    }
  };

  const confirmSaveAssetDetails = () => {
    if (!selectedAsset) return;
    toast.warning("Save asset changes?", {
      description: `Save updates for ${selectedAsset.id}?`,
      action: {
        label: "Save",
        onClick: () => {
          void saveAssetDetails();
        },
      },
      cancel: {
        label: "Cancel",
        onClick: () => undefined,
      },
    });
  };

  const handleDeleteAsset = async (item: AssetRow) => {
    setAssets((prev) => prev.filter((asset) => asset.id !== item.id));

    if (item.localPresent) {
      removeLocalAssetStorage(item.id);
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

    toast.success(`Asset ${item.id} was deleted.`);
  };

  const handleBulkDeleteAssets = async () => {
    if (isBulkDeleting || selectedAssetIds.size === 0) return;
    const targets = assets.filter((a) => selectedAssetIds.has(a.id));
    if (targets.length === 0) return;

    setIsBulkDeleting(true);
    setAssets((prev) => prev.filter((a) => !selectedAssetIds.has(a.id)));

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
        if (item.localPresent) removeLocalAssetStorage(item.id);
      });

      toast.success(`${targets.length} asset(s) deleted.`);
      setSelectedAssetIds(new Set());
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const readOnlyInputClass =
    "px-3 py-2.5 border rounded-xl text-sm font-medium shadow-sm transition-all bg-white/40 dark:bg-slate-800/60 border-white/40 dark:border-white/10 text-slate-600 dark:text-slate-200";
  const editableInputClass =
    "px-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/20 dark:focus:ring-white/15 text-sm font-medium shadow-sm transition-all bg-white/70 dark:bg-slate-800/85 border-white/50 dark:border-white/10 text-slate-900 dark:text-white";
  const checkboxClass =
    "h-4 w-4 appearance-none rounded-md border border-slate-300/80 dark:border-white/20 bg-white/90 dark:bg-slate-800/80 checked:bg-amber-500 checked:border-amber-500 focus:ring-2 focus:ring-amber-400/60 focus:ring-offset-0 transition-colors cursor-pointer";

  return (
    <div className="h-full flex flex-col p-6 gap-6 relative overflow-hidden pointer-events-none">
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="absolute inset-4 rounded-3xl glass-panel pointer-events-auto flex flex-col overflow-hidden"
      >
        <div className="p-6 border-b border-white/20 flex justify-between items-center flex-none">
          <div>
            <h1 className="text-3xl font-light tracking-tight text-[hsl(var(--foreground))]">
              Assets
            </h1>
            <p className="text-[hsl(var(--muted-foreground))] text-sm font-light flex items-center gap-2">
              <span>Manage point assets and status.</span>
              {isLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" />
                  Syncing...
                </span>
              ) : (
                <span>{`${assets.length} loaded`}</span>
              )}
            </p>
          </div>
          <button
            onClick={() =>
              toast.info("Add new assets from the map drawing tools.")
            }
            className="glass-button flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm text-[hsl(var(--foreground))] hover:bg-sky-100/80 hover:text-sky-900 dark:hover:bg-amber-800/25 dark:hover:text-amber-200 shadow-sm border border-white/30"
          >
            <Plus size={16} />
            Add Asset
          </button>
        </div>

        <div className="p-4 border-b border-white/20 flex items-center gap-3 flex-none bg-white/10">
          <div className="relative flex-1 max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
              size={16}
            />
            <input
              type="text"
              placeholder="Search ID, asset name, type, zone, location, or status..."
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
              <option value="id">Marker ID</option>
              <option value="severity">Severity</option>
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
              { key: "high-severity", label: "High Severity" },
              { key: "inactive", label: "Inactive" },
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
              disabled={selectedAssetIds.size === 0 || isBulkDeleting}
              onClick={() => {
                toast.error("Delete selected assets?", {
                  description: `This will permanently remove ${selectedAssetIds.size} asset(s).`,
                  action: {
                    label: "Delete",
                    onClick: () => {
                      void handleBulkDeleteAssets();
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
                : `Delete Selected (${selectedAssetIds.size})`}
            </button>
          </div>

          {showColumnMenu && (
            <div className="w-full mt-2 p-2 rounded-xl border border-white/30 dark:border-white/10 bg-white/60 dark:bg-slate-800/70 grid grid-cols-2 md:grid-cols-4 gap-2">
              {(
                [
                  ["assetName", "Asset Name"],
                  ["type", "Type"],
                  ["zone", "Zone"],
                  ["location", "Location"],
                  ["severity", "Severity"],
                  ["status", "Status"],
                  ["action", "Action"],
                ] as Array<[AssetColumnKey, string]>
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

        <div className="px-4 py-3 border-b border-white/20 grid grid-cols-1 md:grid-cols-2 gap-2 bg-white/5">
          <div className="rounded-xl border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total Assets
            </p>
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {gridStats.total}
            </p>
          </div>
          <div className="rounded-xl border border-white/30 dark:border-white/10 bg-white/35 dark:bg-slate-800/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Active
            </p>
            <p className="text-base font-semibold text-emerald-700 dark:text-emerald-200">
              {gridStats.active}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 relative">
          {isLoading && (
            <div className="absolute inset-4 z-10 flex items-center justify-center pointer-events-none">
              <div className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/70 dark:bg-slate-900/70 px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] backdrop-blur-md">
                <Loader2 size={15} className="animate-spin" />
                Loading assets...
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
                        paginatedRows.every((a) => selectedAssetIds.has(a.id))
                      }
                      onChange={(e) => {
                        const next = new Set(selectedAssetIds);
                        if (e.target.checked)
                          paginatedRows.forEach((a) => next.add(a.id));
                        else paginatedRows.forEach((a) => next.delete(a.id));
                        setSelectedAssetIds(next);
                      }}
                      className={checkboxClass}
                    />
                  </th>
                  {columnVisibility.assetName && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Asset Name
                    </th>
                  )}
                  {columnVisibility.type && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Type
                    </th>
                  )}
                  {columnVisibility.zone && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Zone
                    </th>
                  )}
                  {columnVisibility.location && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Location
                    </th>
                  )}
                  {columnVisibility.severity && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Severity
                    </th>
                  )}
                  {columnVisibility.status && (
                    <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wide bg-white/35 dark:bg-slate-900/55">
                      Status
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

                  return (
                    <tr
                      key={item.id}
                      onClick={() => openAssetDetails(item, false)}
                      className="cursor-pointer border-t border-white/15 dark:border-white/5"
                    >
                      <td
                        className={`px-4 py-3 w-10 ${rowBgClass}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedAssetIds.has(item.id)}
                          onChange={(e) => {
                            const next = new Set(selectedAssetIds);
                            if (e.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            setSelectedAssetIds(next);
                          }}
                          className={checkboxClass}
                        />
                      </td>

                      {columnVisibility.assetName && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${rowBgClass}`}
                        >
                          {item.name || "-"}
                        </td>
                      )}
                      {columnVisibility.type && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${rowBgClass}`}
                        >
                          {item.type || "-"}
                        </td>
                      )}
                      {columnVisibility.zone && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${rowBgClass}`}
                        >
                          {item.zone || "-"}
                        </td>
                      )}
                      {columnVisibility.location && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${rowBgClass}`}
                        >
                          {item.location || "-"}
                        </td>
                      )}
                      {columnVisibility.severity && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${rowBgClass}`}
                        >
                          <span
                            className={`inline-flex min-w-[4.75rem] items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold ${severityPillClass(item.severity)}`}
                          >
                            {item.severity || "Medium"}
                          </span>
                        </td>
                      )}
                      {columnVisibility.status && (
                        <td
                          className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${rowBgClass}`}
                        >
                          <span
                            className={`inline-flex min-w-[5rem] items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusPillClass(item.status)}`}
                          >
                            {item.status || "Active"}
                          </span>
                        </td>
                      )}

                      {columnVisibility.action && (
                        <td
                          className={`px-4 py-3 text-right sticky right-0 ${rowBgClass}`}
                        >
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openAssetDetails(item, true);
                              }}
                              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 bg-white/40 dark:bg-slate-800/60 border border-white/30 dark:border-white/10 hover:bg-sky-100/80 dark:hover:bg-amber-800/25 hover:text-sky-900 dark:hover:text-amber-200"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteAsset(item);
                              }}
                              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 bg-white/40 dark:bg-slate-800/60 border border-white/30 dark:border-white/10 hover:bg-sky-100/80 dark:hover:bg-amber-800/25 hover:text-sky-900 dark:hover:text-amber-200"
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
                        (columnVisibility.assetName ? 1 : 0) +
                        (columnVisibility.type ? 1 : 0) +
                        (columnVisibility.zone ? 1 : 0) +
                        (columnVisibility.location ? 1 : 0) +
                        (columnVisibility.severity ? 1 : 0) +
                        (columnVisibility.status ? 1 : 0) +
                        (columnVisibility.action ? 1 : 0)
                      }
                      className="px-4 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]"
                    >
                      No assets found in Firebase.
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
        {isDetailsOpen && selectedAsset && detailsDraft && (
          <div className="fixed inset-0 z-[10001] flex items-center justify-center pointer-events-auto p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={requestCloseAssetDetails}
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
                    Asset Details
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {selectedAsset.id}
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
                        setDetailsDraft(toDraft(selectedAsset));
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/80 dark:border-white/10 text-slate-700 dark:text-slate-200 bg-white/60 dark:bg-slate-700/80 hover:bg-sky-100/80 dark:hover:bg-amber-800/25 hover:text-sky-900 dark:hover:text-amber-200 transition-all"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={requestCloseAssetDetails}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-sky-900 hover:bg-sky-100/80 dark:text-slate-400 dark:hover:text-amber-200 dark:hover:bg-amber-800/25 transition-colors"
                    aria-label="Close asset details"
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
                      Asset ID
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
                      Asset Name
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
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Asset Type
                    </label>
                    {isDetailsEditMode ? (
                      <select
                        value={detailsDraft.type}
                        onChange={(e) =>
                          setDetailsDraft((prev) =>
                            prev ? { ...prev, type: e.target.value } : prev,
                          )
                        }
                        className={editableInputClass}
                      >
                        {NWSDB_ASSET_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={detailsDraft.type}
                        disabled
                        className={readOnlyInputClass}
                      />
                    )}
                  </div>
                </div>

                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-600 dark:text-slate-400 flex items-center gap-2 mt-5 mb-3">
                  <span className="w-4 h-[1px] bg-current opacity-40" />
                  Assignment & Condition
                  <span className="flex-1 h-[1px] bg-current opacity-40" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Zone Name
                    </label>
                    <input
                      type="text"
                      value={detailsDraft.zone}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, zone: e.target.value } : prev,
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
                      Severity
                    </label>
                    <select
                      value={detailsDraft.severity}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, severity: e.target.value } : prev,
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
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-400">
                      Status
                    </label>
                    <select
                      value={detailsDraft.status}
                      disabled={!isDetailsEditMode}
                      onChange={(e) =>
                        setDetailsDraft((prev) =>
                          prev ? { ...prev, status: e.target.value } : prev,
                        )
                      }
                      className={
                        isDetailsEditMode
                          ? editableInputClass
                          : readOnlyInputClass
                      }
                    >
                      <option value="Active">Active</option>
                      <option value="Maintenance">Maintenance</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="p-5 border-t border-white/30 dark:border-white/10 bg-white/40 dark:bg-slate-800/60 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isDetailsEditMode
                    ? "Review your edits, then save."
                    : "Click Edit to update asset details."}
                </p>
                {isDetailsEditMode && (
                  <button
                    type="button"
                    disabled={isDetailsSaving}
                    onClick={confirmSaveAssetDetails}
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
