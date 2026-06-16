"use client";

import { useEffect, useState } from "react";
import {
  Layers,
  Activity,
  Map as MapIcon,
  PenTool,
  ChevronUp,
  RotateCcw,
  Eye,
  EyeOff,
  MapPin,
  SlidersHorizontal,
} from "lucide-react";

interface LayerControlProps {
  showPipelines: boolean;
  setShowPipelines: (v: boolean) => void;
  showZones: boolean;
  setShowZones: (v: boolean) => void;
  showAssets: boolean;
  setShowAssets: (v: boolean) => void;
  riskFilter: "all" | "low" | "medium" | "high";
  setRiskFilter: (v: "all" | "low" | "medium" | "high") => void;
  confidenceFilter: "all" | "low" | "medium" | "high";
  setConfidenceFilter: (v: "all" | "low" | "medium" | "high") => void;
  mapStyle: "light" | "street" | "satellite";
  setMapStyle: (v: "light" | "street" | "satellite") => void;
  isEditorMode: boolean;
  setIsEditorMode: (v: boolean) => void;
}

export default function LayerControl({
  showPipelines,
  setShowPipelines,
  showZones,
  setShowZones,
  showAssets,
  setShowAssets,
  riskFilter,
  setRiskFilter,
  confidenceFilter,
  setConfidenceFilter,
  mapStyle,
  setMapStyle,
  isEditorMode,
  setIsEditorMode,
}: LayerControlProps) {
  const [dark, setDark] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const checkDark = () =>
      setDark(document.documentElement.classList.contains("dark"));
    checkDark();
    const obs = new MutationObserver(checkDark);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      obs.disconnect();
    };
  }, []);

  const d = dark;
  const bg = d ? "bg-slate-900 border-white/10" : "bg-white border-slate-200";
  const sLabel = d ? "text-slate-400" : "text-slate-400";
  const segTrk = d ? "bg-slate-800" : "bg-slate-100";
  const segOn = d
    ? "bg-amber-300 text-slate-900 shadow-md"
    : "bg-sky-200 text-sky-950 shadow-md";
  const segOff = d
    ? "text-slate-300 hover:text-white"
    : "text-slate-500 hover:text-slate-700";
  const rowHov = d ? "hover:bg-white/5" : "hover:bg-slate-50";
  const iconOff = d ? "text-slate-400" : "text-slate-400";
  const iconHov = d ? "group-hover:text-white" : "group-hover:text-slate-600";
  const stOff = d
    ? "bg-slate-800 text-white hover:bg-slate-700"
    : "bg-slate-50 text-slate-700 hover:bg-slate-100";
  const divider = d ? "border-white/10" : "border-slate-100";
  const sidebarEase = "cubic-bezier(0.42, 0, 0.58, 1)";
  const sidebarDurationMs = 300;
  const activeLayerCount = [showPipelines, showZones, showAssets].filter(
    Boolean,
  ).length;
  const hasActiveFilters = riskFilter !== "all" || confidenceFilter !== "all";

  const resetFilters = () => {
    setRiskFilter("all");
    setConfidenceFilter("all");
  };

  const layerButtonClass = (isActive: boolean) =>
    `flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-[12px] font-medium transition-all group ${
      isActive
        ? d
          ? "bg-amber-300 text-slate-900 shadow-md font-semibold"
          : "bg-sky-200 text-sky-950 shadow-md font-semibold"
        : `text-slate-400 ${rowHov}`
    }`;

  const filterButtonClass = (
    isActive: boolean,
    tone?: "low" | "medium" | "high",
  ) => {
    if (!isActive) {
      if (tone === "low") {
        return d
          ? "bg-emerald-500/12 text-emerald-200 border border-emerald-500/25 hover:bg-emerald-500/20"
          : "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100";
      }
      if (tone === "medium") {
        return d
          ? "bg-amber-500/12 text-amber-200 border border-amber-500/25 hover:bg-amber-500/20"
          : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100";
      }
      if (tone === "high") {
        return d
          ? "bg-red-500/12 text-red-200 border border-red-500/25 hover:bg-red-500/20"
          : "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100";
      }
      return d
        ? "bg-slate-700 text-slate-200 border border-slate-600 hover:bg-slate-600"
        : "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200";
    }

    if (tone === "low") {
      return "bg-emerald-600 text-white border border-emerald-600 shadow-sm";
    }
    if (tone === "medium") {
      return "bg-amber-500 text-white border border-amber-500 shadow-sm";
    }
    if (tone === "high") {
      return "bg-red-600 text-white border border-red-600 shadow-sm";
    }

    return d
      ? "bg-amber-300 text-slate-900 border border-amber-300"
      : "bg-sky-200 text-sky-950 border border-sky-200";
  };

  return (
    <div className="absolute top-4 right-4 z-[400]" data-guide="layer-controls">
      <div
        className={`${bg} border shadow-xl shadow-black/15 rounded-2xl overflow-hidden flex flex-col w-[250px] md:w-[264px]`}
      >
        {/* Header with Title and Collapse Button */}
        <div
          className={`flex items-center justify-between px-3 py-2 border-b ${divider}`}
        >
          <div className="min-w-0">
            <h2
              className={`text-[12px] font-semibold uppercase tracking-wide flex items-center gap-1.5 ${sLabel}`}
            >
              <Layers size={14} /> View Controls
            </h2>
            {isCollapsed && (
              <p
                className={`mt-0.5 text-[10px] ${d ? "text-slate-500" : "text-slate-400"}`}
              >
                {activeLayerCount} layer{activeLayerCount === 1 ? "" : "s"} on
                {hasActiveFilters ? " · filters active" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() =>
                window.dispatchEvent(new Event("pipeiq_guide_replay"))
              }
              aria-label="Replay guide"
              title="Replay Guide"
              className={`rounded-md p-1 transition-colors duration-200 ${d ? "hover:bg-white/10 text-slate-300 hover:text-white" : "hover:bg-slate-100 text-slate-500 hover:text-slate-700"}`}
            >
              <RotateCcw size={13} />
            </button>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-label={
                isCollapsed ? "Expand map controls" : "Collapse map controls"
              }
              className={`rounded-md p-0.5 transition-colors duration-200 ${d ? "hover:bg-white/10" : "hover:bg-slate-100"}`}
            >
              <div
                className={isCollapsed ? "rotate-180" : "rotate-0"}
                style={{
                  transitionProperty: "transform",
                  transitionDuration: `${sidebarDurationMs}ms`,
                  transitionTimingFunction: sidebarEase,
                }}
              >
                <ChevronUp size={14} />
              </div>
            </button>
          </div>
        </div>

        {/* Collapsible Content */}
        <div
          className={`overflow-hidden ${isCollapsed ? "max-h-0 opacity-0 pointer-events-none" : "max-h-[540px] opacity-100"}`}
          style={{
            transitionProperty: "max-height, opacity",
            transitionDuration: `${sidebarDurationMs}ms`,
            transitionTimingFunction: sidebarEase,
          }}
        >
          <div className="p-2.5 pt-2 flex flex-col gap-1">
            {/* Base Map */}
            <div
              className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5 ${sLabel}`}
            >
              <MapIcon size={11} /> Map View
            </div>
            <div className={`flex ${segTrk} p-1 rounded-xl mb-2`}>
              {(["light", "street", "satellite"] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => setMapStyle(style)}
                  className={`flex-1 py-1 text-[11px] font-medium rounded-lg transition-all ${mapStyle === style ? segOn : segOff}`}
                >
                  {style === "satellite"
                    ? "Sat"
                    : style.charAt(0).toUpperCase() + style.slice(1)}
                </button>
              ))}
            </div>

            {/* Map Tools */}
            <div
              className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5 ${sLabel}`}
            >
              <PenTool size={11} /> Map Tools
            </div>
            <button
              onClick={() => {
                const newVal = !isEditorMode;
                setIsEditorMode(newVal);
                window.dispatchEvent(
                  new CustomEvent("pipeiq_studio_toggled", {
                    detail: { enabled: newVal },
                  }),
                );
              }}
              className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-[12px] font-medium transition-all group ${
                isEditorMode
                  ? d
                    ? "bg-amber-300 text-slate-900 shadow-md font-semibold"
                    : "bg-sky-200 text-sky-950 shadow-md font-semibold"
                  : stOff
              }`}
            >
              <div className="flex items-center gap-3">
                <PenTool
                  size={15}
                  className={
                    isEditorMode
                      ? d
                        ? "text-slate-900"
                        : "text-sky-950"
                      : `${iconOff} ${iconHov}`
                  }
                />
                Studio Mode
              </div>
              <div
                className={`w-8 h-4 rounded-full transition-colors relative ${isEditorMode ? (d ? "bg-amber-400" : "bg-sky-400") : d ? "bg-slate-600" : "bg-slate-300"}`}
              >
                <div
                  className={`absolute top-[2px] bottom-[2px] w-3 rounded-full bg-white transition-all shadow-sm ${isEditorMode ? "left-[18px]" : "left-[2px]"}`}
                />
              </div>
            </button>

            {/* Overlay Layers */}
            <div
              className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest mt-1.5 mb-1 flex items-center gap-1.5 ${sLabel}`}
            >
              <Layers size={11} /> Overlay Layers
            </div>
            <button
              onClick={() => setShowPipelines(!showPipelines)}
              className={layerButtonClass(showPipelines)}
            >
              <span className="flex items-center gap-2">
                <Activity
                  size={14}
                  className={
                    showPipelines
                      ? d
                        ? "text-slate-900"
                        : "text-sky-950"
                      : `text-slate-400`
                  }
                />
                Pipelines
              </span>
              {showPipelines ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button
              onClick={() => setShowZones(!showZones)}
              className={layerButtonClass(showZones)}
            >
              <span className="flex items-center gap-2">
                <MapIcon
                  size={14}
                  className={
                    showZones
                      ? d
                        ? "text-slate-900"
                        : "text-sky-950"
                      : `text-slate-400`
                  }
                />
                Zones
              </span>
              {showZones ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button
              onClick={() => setShowAssets(!showAssets)}
              className={layerButtonClass(showAssets)}
            >
              <span className="flex items-center gap-2">
                <MapPin
                  size={14}
                  className={
                    showAssets
                      ? d
                        ? "text-slate-900"
                        : "text-sky-950"
                      : `text-slate-400`
                  }
                />
                Assets
              </span>
              {showAssets ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>

            <div
              className={`mt-2 rounded-xl border px-2.5 py-2 ${d ? "border-white/10 bg-slate-800" : "border-slate-200 bg-white"}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div
                  className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 ${sLabel}`}
                >
                  <SlidersHorizontal size={11} /> Filters
                </div>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                      d
                        ? "text-slate-300 hover:bg-white/10 hover:text-white"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    }`}
                  >
                    Reset
                  </button>
                )}
              </div>

              <div
                className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${sLabel}`}
              >
                Risk
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {(["all", "low", "medium", "high"] as const).map((option) => (
                  <button
                    key={`risk-${option}`}
                    onClick={() => setRiskFilter(option)}
                    className={`min-w-0 px-2 py-1.5 rounded-md text-[10px] font-semibold leading-none transition-colors ${filterButtonClass(
                      riskFilter === option,
                      option === "all" ? undefined : option,
                    )}`}
                  >
                    {option === "all"
                      ? "All"
                      : option.charAt(0).toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>

              <div
                className={`text-[10px] font-bold uppercase tracking-widest mt-2 mb-1 ${sLabel}`}
              >
                Confidence
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {(["all", "low", "medium", "high"] as const).map((option) => (
                  <button
                    key={`confidence-${option}`}
                    onClick={() => setConfidenceFilter(option)}
                    className={`min-w-0 px-2 py-1.5 rounded-md text-[10px] font-semibold leading-none transition-colors ${filterButtonClass(
                      confidenceFilter === option,
                    )}`}
                  >
                    {option === "all"
                      ? "All"
                      : option.charAt(0).toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
