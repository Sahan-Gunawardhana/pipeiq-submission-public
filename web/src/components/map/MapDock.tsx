"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ZoomIn,
  ZoomOut,
  PencilLine,
  Grid3x3,
  MapPin,
  Pencil,
  Trash2,
  Check,
  CornerUpLeft,
  X,
  Navigation,
} from "lucide-react";

interface DockItemProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  guideId?: string;
}

interface MapDockProps {
  sidebarCollapsed: boolean;
  isEditorMode: boolean;
}

type DockAction =
  | "zoomIn"
  | "zoomOut"
  | "locateMe"
  | "drawPipelines"
  | "drawZones"
  | "drawMarkers"
  | "edit"
  | "delete"
  | "leafletSave"
  | "leafletUndo"
  | "leafletCancel";

type LeafletMode = "draw" | "edit" | "delete" | null;
type LeafletDrawType =
  | "polyline"
  | "polygon"
  | "marker"
  | "circlemarker"
  | null;

const menuTitleByMode: Record<Exclude<LeafletMode, null>, string> = {
  draw: "Drawing",
  edit: "Editing",
  delete: "Deleting",
};

const DockItem = ({
  icon,
  label,
  onClick,
  disabled,
  guideId,
  active,
}: DockItemProps & { active?: boolean }) => {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      disabled={disabled}
      className={`relative p-2.5 rounded-lg backdrop-blur-md border shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "bg-sky-200/90 text-sky-950 border-sky-300/90 ring-2 ring-sky-300/40 shadow-lg dark:bg-amber-300 dark:border-amber-200 dark:text-slate-900 dark:ring-2 dark:ring-amber-200/60"
          : "bg-white/14 hover:bg-sky-100/80 dark:bg-slate-900/78 dark:hover:bg-amber-900/35 border-white/24 dark:border-slate-500/55 hover:border-sky-300/70 dark:hover:border-amber-700/45 text-slate-700 dark:text-slate-100 hover:text-sky-900 dark:hover:text-amber-200"
      }`}
      title={label}
      data-guide={guideId}
    >
      <div className="w-5 h-5 flex items-center justify-center">{icon}</div>
      {/* Tooltip on hover */}
      <motion.div
        initial={{ opacity: 0, y: 4, scale: 0.95 }}
        whileHover={{ opacity: 1, y: -10, scale: 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={`absolute bottom-full mb-2.5 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap pointer-events-none backdrop-blur-sm ${
          active
            ? "bg-sky-200 text-sky-950 dark:bg-amber-300 dark:text-slate-900"
            : "bg-slate-900/90 text-white dark:bg-white/95 dark:text-slate-900"
        }`}
      >
        {label}
      </motion.div>
    </motion.button>
  );
};

interface DockIslandProps {
  children: React.ReactNode;
}

const DockIsland = ({ children }: DockIslandProps) => {
  return (
    <div className="flex items-center gap-2 px-2.5 py-2.5 rounded-xl bg-white/16 dark:bg-slate-900/72 backdrop-blur-xl border border-black/25 dark:border-slate-500/55 shadow-lg dark:shadow-black/40 transition-all">
      {children}
    </div>
  );
};

export default function MapDock({
  sidebarCollapsed,
  isEditorMode,
}: MapDockProps) {
  const sidebarWidth = sidebarCollapsed ? 88 : 288;
  const [screenWidth, setScreenWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 0,
  );
  const [mounted, setMounted] = useState(false);
  const [activeTool, setActiveTool] = useState<DockAction | null>(null);
  const [leafletMode, setLeafletMode] = useState<LeafletMode>(null);
  const [leafletDrawType, setLeafletDrawType] = useState<LeafletDrawType>(null);

  useEffect(() => {
    setMounted(true);
    setScreenWidth(window.innerWidth);
    const handleResize = () => setScreenWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const onModeChanged = (event: Event) => {
      const detail = (
        event as CustomEvent<{ mode?: LeafletMode; drawType?: LeafletDrawType }>
      ).detail;
      setLeafletMode(detail?.mode ?? null);
      setLeafletDrawType(detail?.drawType ?? null);
    };
    window.addEventListener(
      "pipeiq_leaflet_mode_changed",
      onModeChanged as EventListener,
    );
    return () =>
      window.removeEventListener(
        "pipeiq_leaflet_mode_changed",
        onModeChanged as EventListener,
      );
  }, []);

  useEffect(() => {
    if (leafletMode !== null) return;
    if (
      activeTool &&
      ["drawPipelines", "drawZones", "drawMarkers", "edit", "delete"].includes(
        activeTool,
      )
    ) {
      setActiveTool(null);
    }
  }, [leafletMode, activeTool]);

  // Calculate left position: center of the map area (between sidebar and right edge)
  const mapWidth = screenWidth - sidebarWidth;
  const leftPosition = sidebarWidth + mapWidth / 2;
  const leftPercent = (leftPosition / screenWidth) * 100;

  const isToolLockActive = leafletMode !== null;
  const lockableActions: DockAction[] = [
    "zoomIn",
    "zoomOut",
    "locateMe",
    "drawPipelines",
    "drawZones",
    "drawMarkers",
    "edit",
    "delete",
  ];

  const isActionLocked = (action: DockAction) => {
    if (!isToolLockActive) return false;
    if (!lockableActions.includes(action)) return false;
    return activeTool !== action;
  };

  const triggerDockAction = (action: DockAction) => {
    if (isActionLocked(action)) return;
    setActiveTool(action);
    window.dispatchEvent(
      new CustomEvent("pipeiq_dock_action", { detail: { action } }),
    );
  };

  if (!mounted) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      style={{ left: `${leftPercent}%` }}
      layoutId="map-dock"
      layout
      data-guide="map-dock"
      className="absolute bottom-6 -translate-x-1/2 z-[1000] flex items-center gap-3"
    >
      {/* Center Leaflet-style action menu for active tool mode */}
      {leafletMode && (
        <div
          className="absolute left-1/2 -translate-x-1/2 -top-[4.35rem]"
          data-guide="dock-actions"
        >
          <div className="inline-flex w-auto max-w-[90vw] items-center gap-1 p-1 rounded-xl bg-white/94 dark:bg-slate-900/94 backdrop-blur-xl border border-white/75 dark:border-amber-500/45 shadow-[0_10px_24px_rgba(15,23,42,0.16)] dark:shadow-[0_12px_24px_rgba(0,0,0,0.42)]">
            <span className="px-1.5 py-1 text-[10px] uppercase tracking-wider rounded-md bg-amber-100/80 dark:bg-amber-400/20 text-amber-800 dark:text-amber-200 font-semibold whitespace-nowrap">
              {menuTitleByMode[leafletMode]}
            </span>
            <button
              onClick={() => triggerDockAction("leafletSave")}
              className="inline-flex items-center whitespace-nowrap gap-1 px-2 py-1.5 text-[11px] rounded-md transition-colors bg-slate-900 text-white dark:bg-amber-400/85 dark:text-slate-900 hover:bg-sky-200 hover:text-sky-950 dark:hover:bg-amber-300 dark:hover:text-slate-900"
            >
              <Check size={13} />
              Save
            </button>
            {leafletMode === "draw" &&
              (leafletDrawType === "polyline" ||
                leafletDrawType === "polygon") && (
                <button
                  onClick={() => triggerDockAction("leafletUndo")}
                  className="inline-flex items-center whitespace-nowrap gap-1 px-2 py-1.5 text-[11px] rounded-md transition-colors text-slate-700 dark:text-amber-200 hover:bg-sky-100/80 dark:hover:bg-amber-900/35 hover:text-sky-900 dark:hover:text-amber-100"
                >
                  <CornerUpLeft size={13} />
                  Undo Point
                </button>
              )}
            <button
              onClick={() => triggerDockAction("leafletCancel")}
              className="inline-flex items-center whitespace-nowrap gap-1 px-2 py-1.5 text-[11px] rounded-md transition-colors text-slate-700 dark:text-amber-200 hover:bg-sky-100/80 dark:hover:bg-amber-900/35 hover:text-sky-900 dark:hover:text-amber-100"
            >
              <X size={13} />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Zoom Island - Always visible */}
      <div data-guide="dock-zoom">
        <DockIsland>
          <DockItem
            icon={<ZoomIn size={18} strokeWidth={2} />}
            label="Zoom In"
            onClick={() => triggerDockAction("zoomIn")}
            active={activeTool === "zoomIn"}
            disabled={isActionLocked("zoomIn")}
          />
          <DockItem
            icon={<ZoomOut size={18} strokeWidth={2} />}
            label="Zoom Out"
            onClick={() => triggerDockAction("zoomOut")}
            active={activeTool === "zoomOut"}
            disabled={isActionLocked("zoomOut")}
          />
          <DockItem
            icon={<Navigation size={18} strokeWidth={2} />}
            label="Locate Me"
            onClick={() => triggerDockAction("locateMe")}
            active={activeTool === "locateMe"}
            disabled={isActionLocked("locateMe")}
            guideId="locate-me-button"
          />
        </DockIsland>
      </div>

      {/* Draw Island - Only visible when editor mode enabled */}
      {isEditorMode && (
        <div data-guide="dock-draw">
          <DockIsland>
            <div data-guide="draw-pipelines">
              <DockItem
                icon={<PencilLine size={18} strokeWidth={2} />}
                label="Draw Pipelines"
                onClick={() => triggerDockAction("drawPipelines")}
                active={activeTool === "drawPipelines"}
                disabled={isActionLocked("drawPipelines")}
              />
            </div>
            <div data-guide="draw-zones">
              <DockItem
                icon={<Grid3x3 size={18} strokeWidth={2} />}
                label="Draw Zones"
                onClick={() => triggerDockAction("drawZones")}
                active={activeTool === "drawZones"}
                disabled={isActionLocked("drawZones")}
              />
            </div>
            <div data-guide="draw-markers">
              <DockItem
                icon={<MapPin size={18} strokeWidth={2} />}
                label="Draw Assets"
                onClick={() => triggerDockAction("drawMarkers")}
                active={activeTool === "drawMarkers"}
                disabled={isActionLocked("drawMarkers")}
              />
            </div>
          </DockIsland>
        </div>
      )}

      {/* Edit / Delete Island - Only visible when editor mode enabled */}
      {isEditorMode && (
        <DockIsland>
          <div data-guide="edit-tool">
            <DockItem
              icon={<Pencil size={18} strokeWidth={2} />}
              label="Edit"
              onClick={() => triggerDockAction("edit")}
              active={activeTool === "edit"}
              disabled={isActionLocked("edit")}
            />
          </div>
          <div data-guide="delete-tool">
            <DockItem
              icon={<Trash2 size={18} strokeWidth={2} />}
              label="Delete"
              onClick={() => triggerDockAction("delete")}
              active={activeTool === "delete"}
              disabled={isActionLocked("delete")}
            />
          </div>
        </DockIsland>
      )}
    </motion.div>
  );
}
