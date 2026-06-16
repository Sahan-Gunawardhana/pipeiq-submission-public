"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  CornerUpLeft,
  Grid3x3,
  MapPin,
  PenLine,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

interface TourStep {
  id: string;
  title: string;
  description: string;
  selector?: string;
  placement?: "top" | "bottom" | "right" | "left" | "center";
  preview?: "action-strip" | "pipeline" | "zone" | "marker" | "edit" | "delete";
  orderedFlow?: string[];
  nudgeY?: number;
}

const steps: TourStep[] = [
  {
    id: "sidebar",
    title: "Sidebar",
    description:
      "Switch between the map view and your data (pipelines, zones, assets).",
    selector: '[data-guide="sidebar"]',
    placement: "right",
  },
  {
    id: "controls",
    title: "Map Controls",
    description:
      "Turn on Studio Mode to draw. Toggle layers to focus on specific data.",
    selector: '[data-guide="layer-controls"]',
    placement: "left",
  },
  {
    id: "dock-zoom",
    title: "Zoom",
    description:
      "Zoom in or out on the map. The other button centers the map on your current location.",
    selector: '[data-guide="dock-zoom"]',
    placement: "top",
  },
  {
    id: "dock-draw",
    title: "Drawing Tools",
    description: "Choose a tool to draw pipelines, zones, or assets.",
    selector: '[data-guide="dock-draw"]',
    placement: "top",
    nudgeY: -116,
  },
  {
    id: "draw-pipelines",
    title: "Draw Pipelines",
    description:
      "Click to place points along the pipeline route, then save when done.",
    selector: '[data-guide="draw-pipelines"]',
    placement: "top",
    preview: "pipeline",
    nudgeY: -122,
  },
  {
    id: "draw-zones",
    title: "Draw Zones",
    description: "Click to outline an area, then save.",
    selector: '[data-guide="draw-zones"]',
    placement: "top",
    preview: "zone",
    nudgeY: -122,
  },
  {
    id: "draw-markers",
    title: "Place Asset",
    description: "Click once to mark a location.",
    selector: '[data-guide="draw-markers"]',
    placement: "top",
    preview: "marker",
    nudgeY: -122,
  },
  {
    id: "edit-tool",
    title: "Edit Shapes",
    description: "Click shapes to adjust them.",
    selector: '[data-guide="edit-tool"]',
    placement: "top",
    nudgeY: -122,
  },
  {
    id: "delete-tool",
    title: "Remove Items",
    description: "Click items to delete them.",
    selector: '[data-guide="delete-tool"]',
    placement: "top",
    nudgeY: -122,
  },
  {
    id: "dock-actions",
    title: "Save or Cancel",
    description: "Save your work or go back without saving.",
    selector: '[data-guide="dock-actions"]',
    placement: "top",
    preview: "action-strip",
    nudgeY: -108,
  },
  {
    id: "final-flow",
    title: "Your Workflow",
    description: "Here's how to get started:",
    placement: "center",
    orderedFlow: [
      "Enable Studio Mode to draw",
      "Pick a tool from the toolbar",
      "Draw on the map",
      "Save your work",
      "View and manage your data in tabs",
    ],
  },
];

const GUIDE_SEEN_KEY = "pipeiq_guide_seen_v1";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const ToolModePreview = ({
  kind,
}: {
  kind: NonNullable<TourStep["preview"]>;
}) => {
  if (kind === "action-strip") return null;

  const config: Record<
    Exclude<NonNullable<TourStep["preview"]>, "action-strip">,
    { title: string; icon: React.ReactNode }
  > = {
    pipeline: { title: "Pipeline drawing mode", icon: <PenLine size={12} /> },
    zone: { title: "Zone drawing mode", icon: <Grid3x3 size={12} /> },
    marker: { title: "Marker mode", icon: <MapPin size={12} /> },
    edit: { title: "Geometry edit mode", icon: <Pencil size={12} /> },
    delete: { title: "Delete selection mode", icon: <Trash2 size={12} /> },
  };

  const renderPreview = () => {
    if (kind === "pipeline") {
      return (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 120 32"
          preserveAspectRatio="none"
        >
          <motion.path
            d="M10 24 L34 12 L66 19 L108 10"
            fill="none"
            stroke="currentColor"
            className="text-slate-700 dark:text-slate-200"
            strokeWidth="2.2"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.3, repeat: Infinity, repeatDelay: 0.35 }}
          />
          {[
            { cx: 10, cy: 24 },
            { cx: 34, cy: 12 },
            { cx: 66, cy: 19 },
            { cx: 108, cy: 10 },
          ].map((p, i) => (
            <motion.circle
              key={`${p.cx}-${p.cy}`}
              cx={p.cx}
              cy={p.cy}
              r="1.7"
              fill="currentColor"
              className="text-slate-800 dark:text-slate-100"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: [0, 1, 1], scale: [0.7, 1, 1] }}
              transition={{
                duration: 1.3,
                times: [0, Math.min(0.2 + i * 0.18, 0.9), 1],
                repeat: Infinity,
                repeatDelay: 0.35,
              }}
            />
          ))}
        </svg>
      );
    }

    if (kind === "zone") {
      return (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 120 32"
          preserveAspectRatio="none"
        >
          <motion.path
            d="M14 23 L34 9 L76 11 L102 21 Z"
            fill="currentColor"
            className="text-slate-700 dark:text-slate-200"
            initial={{ opacity: 0.06 }}
            animate={{ opacity: [0.06, 0.26, 0.2] }}
            transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 0.25 }}
          />
          <motion.path
            d="M14 23 L34 9 L76 11 L102 21 Z"
            fill="none"
            stroke="currentColor"
            className="text-slate-800 dark:text-slate-100"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 0.25 }}
          />
        </svg>
      );
    }

    if (kind === "marker") {
      return (
        <>
          <motion.div
            className="absolute h-2.5 w-2.5 rounded-full bg-slate-800 dark:bg-slate-100"
            initial={{ x: 54, y: -4, scale: 0.75 }}
            animate={{ x: 54, y: [2, 11, 9], scale: [0.75, 1.1, 1] }}
            transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 0.4 }}
          />
          <motion.div
            className="absolute h-2 w-5 rounded-full bg-slate-700/30 dark:bg-slate-200/25"
            initial={{ x: 52, y: 18, scale: 0.5, opacity: 0 }}
            animate={{
              x: 52,
              y: 18,
              scale: [0.5, 1, 0.8],
              opacity: [0, 0.55, 0],
            }}
            transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 0.4 }}
          />
        </>
      );
    }

    if (kind === "edit") {
      return (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 120 32"
          preserveAspectRatio="none"
        >
          <polyline
            points="16,23 40,10 74,12 102,23"
            fill="none"
            stroke="currentColor"
            className="text-slate-500 dark:text-slate-400"
            strokeWidth="2"
          />
          <motion.circle
            cx="40"
            cy="10"
            r="2.3"
            fill="currentColor"
            className="text-amber-500"
            animate={{ cx: [40, 47, 40], cy: [10, 15, 10] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.polyline
            points="16,23 47,15 74,12 102,23"
            fill="none"
            stroke="currentColor"
            className="text-slate-800 dark:text-slate-100"
            strokeWidth="2"
            initial={{ opacity: 0.15 }}
            animate={{ opacity: [0.15, 1, 0.15] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          />
        </svg>
      );
    }

    return (
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 120 32"
        preserveAspectRatio="none"
      >
        <motion.polyline
          points="16,23 40,10 74,12 102,23"
          fill="none"
          stroke="currentColor"
          className="text-slate-500 dark:text-slate-400"
          strokeWidth="2"
          animate={{ opacity: [1, 1, 0.15, 1] }}
          transition={{
            duration: 1.25,
            repeat: Infinity,
            repeatDelay: 0.25,
            times: [0, 0.55, 0.78, 1],
          }}
        />
        <motion.line
          x1="12"
          y1="8"
          x2="108"
          y2="26"
          stroke="currentColor"
          className="text-red-500"
          strokeWidth="2.6"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0.95 }}
          animate={{ pathLength: [0, 1, 1], opacity: [0.95, 0.95, 0] }}
          transition={{
            duration: 1.25,
            repeat: Infinity,
            repeatDelay: 0.25,
            times: [0, 0.6, 1],
          }}
        />
      </svg>
    );
  };

  return (
    <div className="rounded-lg border border-slate-200/90 dark:border-slate-700/80 bg-slate-50/90 dark:bg-slate-800/65 p-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-700 dark:text-slate-200">
        {config[kind].icon}
        <span>{config[kind].title}</span>
      </div>
      <div className="mt-2 h-12 sm:h-14 lg:h-16 rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 relative overflow-hidden">
        {renderPreview()}
      </div>
    </div>
  );
};

const ActionStripPreview = () => {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/60 p-2 sm:p-2.5">
      <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-white/90 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700">
        <motion.div
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-sky-200 text-sky-950 dark:bg-amber-400 dark:text-slate-900 text-[10px] sm:text-[11px]"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        >
          <Check size={11} /> Save
        </motion.div>
        <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] sm:text-[11px] text-slate-700 dark:text-slate-200">
          <CornerUpLeft size={11} /> Undo
        </div>
        <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] sm:text-[11px] text-slate-700 dark:text-slate-200">
          <X size={11} /> Cancel
        </div>
      </div>
      <p className="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-300 mt-2">
        Save finalizes, Undo removes the latest vertex (line/zone), Cancel exits
        active mode.
      </p>
    </div>
  );
};

export default function AppGuideTour() {
  const pathname = usePathname();
  const spotlightMaskId = useId().replace(/:/g, "");
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [targetRadius, setTargetRadius] = useState<number>(14);

  const step = steps[stepIndex];

  useEffect(() => {
    if (pathname !== "/") {
      setOpen(false);
      return;
    }

    try {
      const hasSeenGuide =
        window.localStorage.getItem(GUIDE_SEEN_KEY) === "true";
      if (hasSeenGuide) {
        setOpen(false);
        return;
      }
    } catch {
      // Ignore storage errors and continue showing guide.
    }

    const t = setTimeout(() => setOpen(true), 550);
    return () => clearTimeout(t);
  }, [pathname]);

  useEffect(() => {
    const onReplay = () => {
      if (pathname !== "/") return;
      try {
        window.localStorage.removeItem(GUIDE_SEEN_KEY);
      } catch {
        // Ignore storage errors.
      }
      setStepIndex(0);
      setOpen(true);
    };

    window.addEventListener("pipeiq_guide_replay", onReplay as EventListener);
    return () =>
      window.removeEventListener(
        "pipeiq_guide_replay",
        onReplay as EventListener,
      );
  }, [pathname]);

  useEffect(() => {
    if (!open || !step?.selector) {
      setTargetRect(null);
      return;
    }

    const syncTarget = () => {
      const element = document.querySelector(step.selector as string);
      if (!element) {
        setTargetRect(null);
        return;
      }
      const el = element as HTMLElement;
      const computedRadius = Number.parseFloat(
        window.getComputedStyle(el).borderRadius || "0",
      );
      setTargetRect(el.getBoundingClientRect());
      setTargetRadius(Number.isFinite(computedRadius) ? computedRadius : 14);
    };

    syncTarget();
    window.addEventListener("resize", syncTarget);
    window.addEventListener("scroll", syncTarget, true);
    const interval = window.setInterval(syncTarget, 250);

    return () => {
      window.removeEventListener("resize", syncTarget);
      window.removeEventListener("scroll", syncTarget, true);
      window.clearInterval(interval);
    };
  }, [open, step]);

  const closeTour = () => {
    try {
      window.localStorage.setItem(GUIDE_SEEN_KEY, "true");
    } catch {
      // Ignore storage errors.
    }
    setOpen(false);
    setStepIndex(0);
  };

  const nextStep = () => {
    if (stepIndex >= steps.length - 1) {
      closeTour();
      return;
    }
    setStepIndex((prev) => prev + 1);
  };

  const prevStep = () => setStepIndex((prev) => Math.max(0, prev - 1));

  const tooltipLayout = useMemo(() => {
    if (!open) {
      return { left: 0, top: 0, width: 340, center: true, compact: false };
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isXs = vw < 480;
    const isSm = vw >= 480 && vw < 768;
    const isMd = vw >= 768 && vw < 1280;
    const compact = isXs || isSm;

    const margin = isXs ? 10 : isSm ? 12 : isMd ? 14 : 16;
    const gap = isXs ? 12 : isSm ? 14 : 18;
    const nudgeScale = isXs ? 0.46 : isSm ? 0.64 : isMd ? 0.84 : 1;

    const previewMaxWidth = isXs ? 340 : isSm ? 360 : isMd ? 390 : 430;
    const normalMaxWidth = isXs ? 320 : isSm ? 340 : isMd ? 360 : 380;
    const width = Math.min(
      step.preview ? previewMaxWidth : normalMaxWidth,
      vw - margin * 2,
    );
    const estimatedHeight =
      step.preview === "action-strip"
        ? isXs
          ? 220
          : isSm
            ? 228
            : isMd
              ? 236
              : 244
        : step.preview
          ? isXs
            ? 226
            : isSm
              ? 236
              : isMd
                ? 246
                : 256
          : step.orderedFlow
            ? isXs
              ? 264
              : isSm
                ? 278
                : isMd
                  ? 290
                  : 304
            : isXs
              ? 180
              : isSm
                ? 190
                : isMd
                  ? 198
                  : 206;

    if (step.placement === "center" || !targetRect) {
      return {
        left: (vw - width) / 2,
        top: (vh - estimatedHeight) / 2,
        width,
        center: true,
        compact,
      };
    }

    const cx = targetRect.left + targetRect.width / 2;
    const cy = targetRect.top + targetRect.height / 2;

    const placeTop = () => ({
      left: clamp(cx - width / 2, margin, vw - width - margin),
      top: targetRect.top - estimatedHeight - gap,
    });
    const placeBottom = () => ({
      left: clamp(cx - width / 2, margin, vw - width - margin),
      top: targetRect.bottom + gap,
    });
    const placeLeft = () => ({
      left: targetRect.left - width - gap,
      top: clamp(
        cy - estimatedHeight / 2,
        margin,
        vh - estimatedHeight - margin,
      ),
    });
    const placeRight = () => ({
      left: targetRect.right + gap,
      top: clamp(
        cy - estimatedHeight / 2,
        margin,
        vh - estimatedHeight - margin,
      ),
    });

    const fits = (p: { left: number; top: number }) => {
      return (
        p.left >= margin &&
        p.top >= margin &&
        p.left + width <= vw - margin &&
        p.top + estimatedHeight <= vh - margin
      );
    };

    const preferred = step.placement || "right";
    const isDockStep =
      step.id === "dock-zoom" ||
      step.id === "dock-draw" ||
      step.id === "draw-pipelines" ||
      step.id === "draw-zones" ||
      step.id === "draw-circle-markers" ||
      step.id === "draw-markers" ||
      step.id === "edit-tool" ||
      step.id === "delete-tool" ||
      step.id === "dock-actions";
    const baseDockClearance =
      step.id === "dock-actions"
        ? 56
        : step.id === "dock-draw"
          ? 76
          : step.id.startsWith("draw-") ||
              step.id === "edit-tool" ||
              step.id === "delete-tool"
            ? 82
            : 44;
    const dockClearance = Math.round(baseDockClearance * nudgeScale);
    const fallbackOrder: Array<"top" | "bottom" | "left" | "right"> =
      preferred === "top"
        ? isDockStep
          ? ["top", "right", "left", "bottom"]
          : ["top", "bottom", "right", "left"]
        : preferred === "bottom"
          ? ["bottom", "top", "right", "left"]
          : preferred === "left"
            ? ["left", "right", "top", "bottom"]
            : ["right", "left", "top", "bottom"];

    const resolver = {
      top: placeTop,
      bottom: placeBottom,
      left: placeLeft,
      right: placeRight,
    };

    for (const pos of fallbackOrder) {
      const attempt = resolver[pos]();
      if (fits(attempt)) {
        const nudgedTop = clamp(
          attempt.top + (step.nudgeY || 0) * nudgeScale,
          margin,
          vh - estimatedHeight - margin,
        );
        const correctedDockTop =
          isDockStep && targetRect
            ? Math.min(
                nudgedTop,
                targetRect.top - estimatedHeight - gap - dockClearance,
              )
            : nudgedTop;
        return {
          left: attempt.left,
          top: clamp(correctedDockTop, margin, vh - estimatedHeight - margin),
          width,
          center: false,
          compact,
        };
      }
    }

    // Last-resort clamp if every side is constrained.
    const forced = resolver[fallbackOrder[0]]();
    const forcedNudgedTop = clamp(
      forced.top + (step.nudgeY || 0) * nudgeScale,
      margin,
      vh - estimatedHeight - margin,
    );
    const forcedCorrectedDockTop =
      isDockStep && targetRect
        ? Math.min(
            forcedNudgedTop,
            targetRect.top - estimatedHeight - gap - dockClearance,
          )
        : forcedNudgedTop;
    return {
      left: clamp(forced.left, margin, vw - width - margin),
      top: clamp(forcedCorrectedDockTop, margin, vh - estimatedHeight - margin),
      width,
      center: false,
      compact,
    };
  }, [open, step, targetRect]);

  const spotlight = useMemo(() => {
    if (!targetRect || step.placement === "center") return null;
    const pad = 4;
    const radius = Math.max(8, Math.round(targetRadius + pad));
    const left = Math.max(0, targetRect.left - pad);
    const top = Math.max(0, targetRect.top - pad);
    const width = targetRect.width + pad * 2;
    const height = targetRect.height + pad * 2;
    const right = left + width;
    const bottom = top + height;

    return { left, top, width, height, right, bottom, radius };
  }, [targetRect, step.placement, targetRadius]);

  if (!open || pathname !== "/") return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[12000] pointer-events-none">
        {spotlight ? (
          <>
            <motion.svg
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 w-full h-full"
              aria-hidden="true"
            >
              <defs>
                <mask id={spotlightMaskId}>
                  <rect x="0" y="0" width="100%" height="100%" fill="white" />
                  <rect
                    x={spotlight.left}
                    y={spotlight.top}
                    width={spotlight.width}
                    height={spotlight.height}
                    rx={spotlight.radius}
                    ry={spotlight.radius}
                    fill="black"
                  />
                </mask>
              </defs>

              <rect
                x="0"
                y="0"
                width="100%"
                height="100%"
                fill="rgba(15,23,42,0.34)"
                mask={`url(#${spotlightMaskId})`}
              />
            </motion.svg>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute backdrop-blur-[7px] bg-slate-900/10 dark:bg-black/15"
              style={{
                left: 0,
                top: 0,
                width: "100%",
                height: `${spotlight.top}px`,
              }}
            />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute backdrop-blur-[7px] bg-slate-900/10 dark:bg-black/15"
              style={{
                left: 0,
                top: `${spotlight.top}px`,
                width: `${spotlight.left}px`,
                height: `${spotlight.height}px`,
              }}
            />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute backdrop-blur-[7px] bg-slate-900/10 dark:bg-black/15"
              style={{
                left: `${spotlight.right}px`,
                top: `${spotlight.top}px`,
                width: `calc(100% - ${spotlight.right}px)`,
                height: `${spotlight.height}px`,
              }}
            />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute backdrop-blur-[7px] bg-slate-900/10 dark:bg-black/15"
              style={{
                left: 0,
                top: `${spotlight.bottom}px`,
                width: "100%",
                height: `calc(100% - ${spotlight.bottom}px)`,
              }}
            />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute pointer-events-none"
              style={{
                left: spotlight.left,
                top: spotlight.top,
                width: spotlight.width,
                height: spotlight.height,
                borderRadius: `${spotlight.radius}px`,
                boxShadow:
                  "0 0 0 1px rgba(255,255,255,0.16), 0 0 18px rgba(15,23,42,0.20)",
              }}
            />
          </>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/35 dark:bg-black/50 backdrop-blur-[2px]"
          />
        )}

        {targetRect && step.placement !== "center" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            className="absolute border-2 border-amber-300/95 dark:border-amber-300/90"
            style={{
              left: spotlight?.left ?? targetRect.left - 8,
              top: spotlight?.top ?? targetRect.top - 8,
              width: spotlight?.width ?? targetRect.width + 16,
              height: spotlight?.height ?? targetRect.height + 16,
              borderRadius: `${spotlight?.radius ?? 14}px`,
              boxShadow: "0 0 0 1px rgba(251,191,36,0.36)",
            }}
          />
        )}

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{
            opacity: 1,
            scale: 1,
            left: tooltipLayout.left,
            top: tooltipLayout.top,
          }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{
            opacity: { duration: 0.25 },
            scale: { duration: 0.25 },
            left: { type: "spring", stiffness: 260, damping: 30 },
            top: { type: "spring", stiffness: 260, damping: 30 },
          }}
          className="absolute pointer-events-auto max-w-[94vw] sm:max-w-[90vw] xl:max-w-[36rem] max-h-[74vh] sm:max-h-[70vh] xl:max-h-[66vh] rounded-xl border border-white/70 dark:border-slate-500/60 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-[0_12px_28px_rgba(15,23,42,0.22)] dark:shadow-[0_14px_28px_rgba(0,0,0,0.45)] flex flex-col overflow-hidden"
          style={{ width: `${tooltipLayout.width}px` }}
        >
          <div className="px-2.5 sm:px-3.5 py-2 sm:py-2.5 border-b border-slate-200/70 dark:border-slate-700/70 flex items-center justify-between">
            <h3 className="text-[12px] sm:text-[13px] lg:text-[14px] font-semibold text-slate-900 dark:text-white">
              {step.title}
            </h3>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {stepIndex + 1}/{steps.length}
            </span>
          </div>

          <div className="px-2.5 sm:px-3.5 py-2 border-b border-slate-200/70 dark:border-slate-700/70">
            <div className="relative h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <motion.div
                className="absolute h-full bg-gradient-to-r from-sky-300 to-sky-200 dark:from-amber-300 dark:to-amber-200 rounded-full"
                initial={{ width: 0 }}
                animate={{
                  width: `${((stepIndex + 1) / steps.length) * 100}%`,
                }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                Step {stepIndex + 1} of {steps.length}
              </span>
              <div className="flex items-center gap-1 flex-wrap">
                {steps.map((tourStep, idx) => {
                  const active = idx === stepIndex;
                  return (
                    <motion.button
                      key={tourStep.id}
                      onClick={() => setStepIndex(idx)}
                      whileTap={{ scale: 0.95 }}
                      className={`h-2 transition-all shrink-0 ${
                        active
                          ? "w-6 bg-sky-300 dark:bg-amber-200 rounded-full"
                          : "w-2 bg-slate-400 dark:bg-slate-500 rounded-full hover:bg-sky-300 dark:hover:bg-amber-800/30"
                      }`}
                      aria-label={`Go to step ${idx + 1}: ${tourStep.title}`}
                      title={tourStep.title}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <div className="px-2.5 sm:px-3.5 py-2 sm:py-3 space-y-2 sm:space-y-2.5 overflow-y-auto">
            <p className="text-[11px] sm:text-[12px] lg:text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
              {step.description}
            </p>

            {step.preview && step.preview !== "action-strip" && (
              <ToolModePreview kind={step.preview} />
            )}

            {step.preview === "action-strip" && <ActionStripPreview />}

            {step.orderedFlow && (
              <ol className="text-[11px] sm:text-[12px] text-slate-700 dark:text-slate-200 list-decimal pl-4 space-y-1.5">
                {step.orderedFlow.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            )}
          </div>

          <div className="px-2.5 sm:px-3.5 py-2 sm:py-2.5 border-t border-slate-200/70 dark:border-slate-700/70 flex items-center justify-between gap-2">
            <button
              onClick={closeTour}
              className="px-2.5 py-1.5 text-[10px] sm:text-[11px] rounded-md text-slate-600 dark:text-slate-300 hover:bg-sky-100/80 hover:text-sky-900 dark:hover:bg-amber-800/25 dark:hover:text-amber-200"
            >
              Skip
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={prevStep}
                disabled={stepIndex === 0}
                className="px-2.5 py-1.5 text-[10px] sm:text-[11px] rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-sky-100/80 hover:text-sky-900 dark:hover:bg-amber-800/25 dark:hover:text-amber-200 disabled:opacity-40"
              >
                Back
              </button>
              <button
                onClick={nextStep}
                className="px-2.5 py-1.5 text-[10px] sm:text-[11px] rounded-md bg-sky-200 text-sky-950 dark:bg-amber-400/90 dark:text-slate-900"
              >
                {stepIndex === steps.length - 1 ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
