"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";

export interface PipelineFormData {
  startLocation: string;
  endLocation: string;
  material: string;
  dmaId: string;
  installationYear: number;
  diameter: number;
  pipeLengthM: number;
  roadCategory: string;
  elevationM: number;
  operatingPressure: number;
  pastRepairs: number;
  soilType: string;
  depthM: number;
}

interface PipelineDataModalProps {
  isOpen: boolean;
  onSave: (data: PipelineFormData) => void;
  onCancel: () => void;
}

interface PipelineFormDraft {
  startLocation: string;
  endLocation: string;
  dmaId: string;
  material: string;
  installationYear: string;
  diameter: string;
  pipeLengthM: string;
  roadCategory: string;
  elevationM: string;
  operatingPressure: string;
  pastRepairs: string;
  soilType: string;
  depthM: string;
}

const INITIAL_FORM: PipelineFormDraft = {
  startLocation: "",
  endLocation: "",
  dmaId: "",
  material: "",
  installationYear: "",
  diameter: "",
  pipeLengthM: "",
  roadCategory: "",
  elevationM: "",
  operatingPressure: "",
  pastRepairs: "",
  soilType: "",
  depthM: "",
};

const STEPS = [
  { key: "route", label: "Route Basics" },
  { key: "specs", label: "Pipe Specs" },
  { key: "environment", label: "Environment" },
  { key: "operations", label: "Operations" },
] as const;

type StepIndex = 0 | 1 | 2 | 3;

export default function PipelineDataModal({
  isOpen,
  onSave,
  onCancel,
}: PipelineDataModalProps) {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [step, setStep] = useState<StepIndex>(0);
  const [formError, setFormError] = useState("");
  const [formData, setFormData] = useState<PipelineFormDraft>(INITIAL_FORM);

  useEffect(() => {
    setMounted(true);
    const check = () =>
      setDark(document.documentElement.classList.contains("dark"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      obs.disconnect();
      setMounted(false);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setFormData(INITIAL_FORM);
    setStep(0);
    setFormError("");
  }, [isOpen]);

  const parsedData = useMemo<PipelineFormData>(
    () => ({
      startLocation: formData.startLocation.trim(),
      endLocation: formData.endLocation.trim(),
      dmaId: formData.dmaId,
      material: formData.material,
      installationYear: Number(formData.installationYear),
      diameter: Number(formData.diameter),
      pipeLengthM: Number(formData.pipeLengthM),
      roadCategory: formData.roadCategory,
      elevationM: Number(formData.elevationM),
      operatingPressure: Number(formData.operatingPressure),
      pastRepairs: Number(formData.pastRepairs),
      soilType: formData.soilType,
      depthM: Number(formData.depthM),
    }),
    [formData],
  );

  const isStepValid = (index: StepIndex) => {
    if (index === 0)
      return !!parsedData.startLocation && !!parsedData.endLocation;
    if (index === 1) {
      return (
        !!parsedData.dmaId &&
        !!parsedData.material &&
        Number.isFinite(parsedData.installationYear) &&
        Number.isFinite(parsedData.diameter) &&
        Number.isFinite(parsedData.pipeLengthM)
      );
    }
    if (index === 2) {
      return (
        !!parsedData.roadCategory &&
        !!parsedData.soilType &&
        Number.isFinite(parsedData.elevationM) &&
        Number.isFinite(parsedData.depthM)
      );
    }
    return (
      formData.operatingPressure.trim() !== "" &&
      formData.pastRepairs.trim() !== "" &&
      Number.isFinite(parsedData.operatingPressure) &&
      Number.isFinite(parsedData.pastRepairs)
    );
  };

  const isWholeFormValid = () => {
    return isStepValid(0) && isStepValid(1) && isStepValid(2) && isStepValid(3);
  };

  const goNext = () => {
    if (!isStepValid(step)) {
      setFormError("Complete this section before continuing.");
      return;
    }
    setFormError("");
    setStep((prev) => Math.min(prev + 1, 3) as StepIndex);
  };

  const goBack = () => {
    setFormError("");
    setStep((prev) => Math.max(prev - 1, 0) as StepIndex);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isWholeFormValid()) {
      setFormError("Please finish all sections before saving.");
      return;
    }
    setFormError("");
    onSave(parsedData);
  };

  const handleCancel = () => setShowConfirm(true);
  const confirmDiscard = () => {
    setShowConfirm(false);
    onCancel();
  };

  const progressPct = ((step + 1) / STEPS.length) * 100;

  const d = dark;
  const panelCls = d
    ? "bg-slate-900/70 backdrop-blur-2xl border-white/15 shadow-[0_24px_70px_rgba(0,0,0,0.55)]"
    : "bg-white/45 backdrop-blur-2xl border-white/55 shadow-[0_24px_70px_rgba(15,23,42,0.20)]";
  const textPrimary = d ? "text-slate-100" : "text-slate-900";
  const textMuted = d ? "text-slate-400" : "text-slate-600";
  const inputCls = d
    ? "w-full bg-slate-800 border-slate-700 text-slate-100 focus:ring-2 focus:ring-amber-300/40 focus:border-amber-300/50"
    : "w-full bg-white border-slate-300 text-slate-900 focus:ring-2 focus:ring-sky-900/20 focus:border-sky-800/40";

  if (!mounted) return null;

  return createPortal(
    <>
      <AnimatePresence>
        {isOpen && (
          <div
            key="modal"
            className="fixed inset-0 z-[12000] flex items-center justify-center px-4 py-8"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCancel}
              className={
                d
                  ? "absolute inset-0 bg-black/60 backdrop-blur-md"
                  : "absolute inset-0 bg-slate-900/35 backdrop-blur-md"
              }
            />

            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onPointerDown={(e) => e.stopPropagation()}
              className={`relative w-full max-w-4xl rounded-2xl border overflow-hidden ${panelCls} flex flex-col`}
            >
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className={`text-lg font-bold ${textPrimary}`}>
                      Pipeline Properties Wizard
                    </h2>
                    <p className={`text-xs mt-1 ${textMuted}`}>
                      Step {step + 1} of {STEPS.length}: {STEPS[step].label}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCancel}
                      className={`text-xs font-semibold uppercase tracking-wider ${textMuted} hover:text-slate-900 dark:hover:text-slate-100`}
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPct}%` }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="h-full bg-sky-300"
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {STEPS.map((s, idx) => {
                      const active = idx === step;
                      const done = idx < step;
                      return (
                        <div
                          key={s.key}
                          className={`text-[11px] font-semibold rounded-md px-2 py-1 text-center ${
                            active
                              ? "bg-sky-100 text-sky-900 dark:bg-amber-400/20 dark:text-amber-200"
                              : done
                                ? "bg-sky-50 text-sky-700 dark:bg-amber-500/15 dark:text-amber-300"
                                : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {s.label}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <form
                id="pipeline-form"
                onSubmit={handleSubmit}
                className="p-6 space-y-4 max-h-[70vh] overflow-y-auto"
              >
                {step === 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        Start Point
                      </label>
                      <input
                        type="text"
                        value={formData.startLocation}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            startLocation: e.target.value,
                          })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        End Point
                      </label>
                      <input
                        type="text"
                        value={formData.endLocation}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            endLocation: e.target.value,
                          })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      />
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        DMA ID
                      </label>
                      <select
                        value={formData.dmaId}
                        onChange={(e) =>
                          setFormData({ ...formData, dmaId: e.target.value })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      >
                        <option value="">Select DMA</option>
                        <option value="42_73_01">
                          42_73_01 (Kundasale Core)
                        </option>
                        <option value="42_71_01">
                          42_71_01 (Tennekumbura)
                        </option>
                        <option value="42_72_01">42_72_01 (Ampitiya)</option>
                        <option value="42_74_01">
                          42_74_01 (Pallekele / BOI)
                        </option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        Material
                      </label>
                      <select
                        value={formData.material}
                        onChange={(e) =>
                          setFormData({ ...formData, material: e.target.value })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      >
                        <option value="">Select Material</option>
                        <option value="PVC">PVC</option>
                        <option value="HDPE">HDPE</option>
                        <option value="DI">DI</option>
                        <option value="GI">GI</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        Install Year
                      </label>
                      <input
                        type="number"
                        min="1900"
                        max={new Date().getFullYear()}
                        value={formData.installationYear}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            installationYear: e.target.value,
                          })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        Diameter (mm)
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={formData.diameter}
                        onChange={(e) =>
                          setFormData({ ...formData, diameter: e.target.value })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        Pipe Length (m)
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={formData.pipeLengthM}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            pipeLengthM: e.target.value,
                          })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      />
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        Road Category
                      </label>
                      <select
                        value={formData.roadCategory}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            roadCategory: e.target.value,
                          })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      >
                        <option value="">Select Road Category</option>
                        <option value="Main Road (A26)">Main Road (A26)</option>
                        <option value="Minor Road">Minor Road</option>
                        <option value="B-Class Road">B-Class Road</option>
                        <option value="Pradeshiya Sabha Road">
                          Pradeshiya Sabha Road
                        </option>
                        <option value="Private Road">Private Road</option>
                        <option value="Estate Path">Estate Path</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        Soil Type
                      </label>
                      <select
                        value={formData.soilType}
                        onChange={(e) =>
                          setFormData({ ...formData, soilType: e.target.value })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      >
                        <option value="">Select Soil Type</option>
                        <option value="Red-Yellow Podzolic Soil">
                          Red-Yellow Podzolic Soil
                        </option>
                        <option value="Immature Brown Loams (IBL)">
                          Immature Brown Loams (IBL)
                        </option>
                        <option value="Reddish Brown Latosolic Soil">
                          Reddish Brown Latosolic Soil
                        </option>
                        <option value="Alluvial Soils">Alluvial Soils</option>
                        <option value="Mountain Regosols">
                          Mountain Regosols
                        </option>
                        <option value="Red-Brown Earths">
                          Red-Brown Earths
                        </option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        Elevation (m)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={formData.elevationM}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            elevationM: e.target.value,
                          })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        Depth (m)
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={formData.depthM}
                        onChange={(e) =>
                          setFormData({ ...formData, depthM: e.target.value })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      />
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        Operating Pressure (bar)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.operatingPressure}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            operatingPressure: e.target.value,
                          })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                      >
                        Past Repairs
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={formData.pastRepairs}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            pastRepairs: e.target.value,
                          })
                        }
                        className={`px-3 py-2.5 border rounded-xl text-sm ${inputCls}`}
                      />
                    </div>
                  </div>
                )}

                {formError && (
                  <p className="text-xs font-semibold text-red-500">
                    {formError}
                  </p>
                )}
              </form>

              <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={step === 0 ? handleCancel : goBack}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-sky-200 text-sky-900 hover:bg-sky-300 dark:bg-sky-400/30 dark:text-sky-200 dark:hover:bg-sky-400/50"
                >
                  {step === 0 ? "Cancel" : "Back"}
                </button>

                {step < 3 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-sky-500 text-white hover:bg-sky-600 dark:bg-sky-400 dark:text-slate-900 dark:hover:bg-sky-300"
                  >
                    Next Section
                  </button>
                ) : (
                  <button
                    type="submit"
                    form="pipeline-form"
                    disabled={!isStepValid(3)}
                    className={`px-8 py-2.5 rounded-xl text-sm font-semibold ${
                      isStepValid(3)
                        ? "bg-sky-500 text-white hover:bg-sky-600 dark:bg-sky-400 dark:text-slate-900 dark:hover:bg-sky-300"
                        : "bg-sky-200 text-sky-400 cursor-not-allowed dark:bg-sky-400/20 dark:text-sky-300"
                    }`}
                  >
                    Save Pipeline
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showConfirm && (
          <div
            key="confirm"
            className="fixed inset-0 z-[13000] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirm(false)}
              className={
                d
                  ? "absolute inset-0 bg-black/60 backdrop-blur-md"
                  : "absolute inset-0 bg-slate-900/40 backdrop-blur-md"
              }
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className={`relative w-full max-w-sm rounded-2xl border p-6 ${panelCls}`}
            >
              <h3 className={`text-lg font-bold mb-2 ${textPrimary}`}>
                Discard Drawing?
              </h3>
              <p className={`text-sm mb-6 ${textMuted}`}>
                Are you sure you want to discard this pipeline? All entered
                properties will be lost.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Go Back
                </button>
                <button
                  type="button"
                  onClick={confirmDiscard}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600"
                >
                  Discard
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
