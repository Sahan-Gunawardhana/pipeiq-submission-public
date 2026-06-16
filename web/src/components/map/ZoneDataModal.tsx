"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface ZoneFormData {
  zoneName: string;
  priority: string;
  areaType: string;
  suppliedWater: string;
  wastedWater: string;
  meterCount: string;
  bulkMeterCount: string;
  notes: string;
}

interface ZoneDataModalProps {
  isOpen: boolean;
  onSave: (data: ZoneFormData) => void;
  onCancel: () => void;
}

export default function ZoneDataModal({
  isOpen,
  onSave,
  onCancel,
}: ZoneDataModalProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [dark, setDark] = useState(false);
  const [formData, setFormData] = useState<ZoneFormData>({
    zoneName: "",
    priority: "Medium",
    areaType: "Residential",
    suppliedWater: "",
    wastedWater: "",
    meterCount: "",
    bulkMeterCount: "",
    notes: "",
  });

  // Watch dark mode
  useEffect(() => {
    const check = () =>
      setDark(document.documentElement.classList.contains("dark"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  // Reset when opened
  useEffect(() => {
    if (isOpen) {
      setFormData({
        zoneName: "",
        priority: "Medium",
        areaType: "Residential",
        suppliedWater: "",
        wastedWater: "",
        meterCount: "",
        bulkMeterCount: "",
        notes: "",
      });
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleCancel = () => {
    setShowConfirm(true);
  };

  const confirmDiscard = () => {
    setShowConfirm(false);
    onCancel();
  };

  const d = dark;
  const panelBg = d
    ? "bg-slate-900/70 backdrop-blur-2xl border-white/15 shadow-[0_24px_70px_rgba(0,0,0,0.55)]"
    : "bg-white/45 backdrop-blur-2xl border-white/55 shadow-[0_24px_70px_rgba(15,23,42,0.20)]";
  const titleColor = d ? "text-slate-100" : "text-slate-900";
  const textMuted = d ? "text-slate-400" : "text-slate-600";
  const textPrimary = d ? "text-slate-100" : "text-slate-900";
  const inputCls = d
    ? "w-full bg-slate-800 border-slate-700 text-slate-100 focus:ring-2 focus:ring-sky-300/40 focus:border-sky-300/50"
    : "w-full bg-white border-slate-300 text-slate-900 focus:ring-2 focus:ring-sky-900/20 focus:border-sky-800/40";
  const sectionLabel = d ? "text-slate-400" : "text-slate-600";
  const cancelBtn = d
    ? "bg-sky-200 text-sky-900 hover:bg-sky-300"
    : "bg-sky-200 text-sky-900 hover:bg-sky-300";
  const saveBtn = d
    ? "bg-sky-500 text-white hover:bg-sky-600"
    : "bg-sky-500 text-white hover:bg-sky-600";

  // Confirm dialog tokens
  const confirmBg = d
    ? "bg-slate-900/70 backdrop-blur-2xl border-white/15"
    : "bg-white/45 backdrop-blur-2xl border-white/55";
  const confirmH = d ? "text-slate-100" : "text-slate-900";
  const confirmP = d ? "text-slate-400" : "text-slate-600";
  const goBackBtn = d
    ? "bg-sky-200 text-sky-900 hover:bg-sky-300"
    : "bg-sky-200 text-sky-900 hover:bg-sky-300";

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          key="modal"
          className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-auto px-4 py-8"
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
            initial={{ opacity: 0, scale: 0.98, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={`relative w-full max-w-3xl ${panelBg} border rounded-2xl overflow-hidden pointer-events-auto flex flex-col max-h-[90vh]`}
          >
            <div className="px-6 py-4 border-b border-white/20 flex items-center justify-between gap-4 flex-none">
              <div>
                <h2
                  className={`text-lg font-bold tracking-tight ${titleColor}`}
                >
                  Zone Properties
                </h2>
                <p className={`text-xs mt-1 ${textMuted}`}>
                  Enter the zone details and analysis notes.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCancel}
                className={`text-xs font-semibold uppercase tracking-wider ${textMuted} hover:text-slate-900 dark:hover:text-slate-100`}
              >
                Close
              </button>
            </div>

            <div className="px-6 py-4 border-b border-white/20">
              <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div className="h-full w-full bg-sky-300" />
              </div>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar bg-white/10 dark:bg-white/5">
              <form
                id="zone-form"
                onSubmit={handleSubmit}
                className="flex flex-col gap-5"
              >
                <div className="flex flex-col gap-1.5">
                  <label
                    className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                  >
                    Zone Name
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.zoneName}
                    onChange={(e) =>
                      setFormData({ ...formData, zoneName: e.target.value })
                    }
                    className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label
                      className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                    >
                      Priority
                    </label>
                    <select
                      value={formData.priority}
                      onChange={(e) =>
                        setFormData({ ...formData, priority: e.target.value })
                      }
                      className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                    >
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                    >
                      Area Type
                    </label>
                    <select
                      value={formData.areaType}
                      onChange={(e) =>
                        setFormData({ ...formData, areaType: e.target.value })
                      }
                      className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                    >
                      <option value="Residential">Residential</option>
                      <option value="Commercial">Commercial</option>
                      <option value="Industrial">Industrial</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label
                      className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                    >
                      Water Supplied
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.suppliedWater}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          suppliedWater: e.target.value,
                        })
                      }
                      className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                    >
                      Water Lost
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.wastedWater}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          wastedWater: e.target.value,
                        })
                      }
                      className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label
                      className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                    >
                      Meter Count
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={formData.meterCount}
                      onChange={(e) =>
                        setFormData({ ...formData, meterCount: e.target.value })
                      }
                      className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                    >
                      Bulk Meter Count
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={formData.bulkMeterCount}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          bulkMeterCount: e.target.value,
                        })
                      }
                      className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                  >
                    Analysis Notes (Optional)
                  </label>
                  <textarea
                    rows={3}
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all resize-none ${inputCls}`}
                  />
                </div>
              </form>
            </div>

            <div className="p-5 border-t border-white/20 flex items-center justify-end gap-3 mt-auto">
              <button
                type="button"
                onClick={handleCancel}
                className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${cancelBtn}`}
              >
                Cancel
              </button>
              <button
                type="submit"
                form="zone-form"
                className={`px-8 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${saveBtn}`}
              >
                Save Zone
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {/* Custom Confirmation Dialog */}
      <AnimatePresence>
        {showConfirm && (
          <div
            key="confirm"
            className="absolute inset-0 z-[10000] flex items-center justify-center p-4"
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
              className={`relative w-full max-w-sm ${confirmBg} border shadow-2xl rounded-2xl overflow-hidden p-6`}
            >
              <h3 className={`text-lg font-bold mb-2 ${confirmH}`}>
                Discard Zone?
              </h3>
              <p className={`text-sm mb-6 ${confirmP}`}>
                Are you sure you want to discard this zone? The boundaries you
                drew will be lost.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${goBackBtn}`}
                >
                  Go Back
                </button>
                <button
                  onClick={confirmDiscard}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/20 transition-all"
                >
                  Discard
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}
