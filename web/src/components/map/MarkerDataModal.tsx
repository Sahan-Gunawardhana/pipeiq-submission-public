"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface MarkerFormData {
  name: string;
  type: string;
  location: string;
  condition: string;
  lastService: string;
  description: string;
}

const ASSET_TYPE_OPTIONS = [
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

interface MarkerDataModalProps {
  isOpen: boolean;
  onSave: (data: MarkerFormData) => void;
  onCancel: () => void;
}

export default function MarkerDataModal({
  isOpen,
  onSave,
  onCancel,
}: MarkerDataModalProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [dark, setDark] = useState(false);
  const [formData, setFormData] = useState<MarkerFormData>({
    name: "",
    type: "",
    location: "",
    condition: "Good",
    lastService: "",
    description: "",
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
        name: "",
        type: "",
        location: "",
        condition: "Good",
        lastService: "",
        description: "",
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
            className={`relative w-full max-w-2xl ${panelBg} border rounded-2xl overflow-hidden pointer-events-auto flex flex-col max-h-[90vh]`}
          >
            <div className="px-6 py-4 border-b border-white/20 flex items-center justify-between gap-4 flex-none">
              <div>
                <h2
                  className={`text-lg font-bold tracking-tight ${titleColor}`}
                >
                  Add Asset
                </h2>
                <p className={`text-xs mt-1 ${textMuted}`}>
                  Enter the main details to register this asset.
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

            <div className="p-6 overflow-y-auto custom-scrollbar bg-white/10 dark:bg-white/5">
              <form
                id="marker-form"
                onSubmit={handleSubmit}
                className="flex flex-col gap-6"
              >
                <div
                  className={`text-[10px] uppercase tracking-widest font-bold ${sectionLabel} flex items-center gap-2`}
                >
                  <span className="w-4 h-[1px] bg-current opacity-40" />
                  Asset Details
                  <span className="flex-1 h-[1px] bg-current opacity-40" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label
                      className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                    >
                      Asset Name
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      placeholder="e.g., Main Junction Valve"
                      className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                    >
                      Asset Type
                    </label>
                    <select
                      value={formData.type}
                      required
                      onChange={(e) =>
                        setFormData({ ...formData, type: e.target.value })
                      }
                      className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                    >
                      <option value="">Select Asset Type</option>
                      {ASSET_TYPE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label
                      className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                    >
                      Location Name
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.location}
                      onChange={(e) =>
                        setFormData({ ...formData, location: e.target.value })
                      }
                      placeholder="e.g., Near Zone entrance"
                      className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                    >
                      Condition
                    </label>
                    <select
                      value={formData.condition}
                      onChange={(e) =>
                        setFormData({ ...formData, condition: e.target.value })
                      }
                      className={`px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                    >
                      <option value="Excellent">Excellent</option>
                      <option value="Good">Good</option>
                      <option value="Fair">Fair</option>
                      <option value="Poor">Poor</option>
                      <option value="Critical">Critical</option>
                    </select>
                  </div>
                </div>

                <div
                  className={`text-[10px] uppercase tracking-widest font-bold ${sectionLabel} flex items-center gap-2 mt-1`}
                >
                  <span className="w-4 h-[1px] bg-current opacity-40" />
                  Condition & Service
                  <span className="flex-1 h-[1px] bg-current opacity-40" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                    >
                      Last Service Date
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          lastService: new Date().toISOString().slice(0, 10),
                        })
                      }
                      className={`text-[10px] uppercase tracking-wider font-semibold ${textMuted} hover:text-sky-700 dark:hover:text-sky-300 transition-colors`}
                    >
                      Set Today
                    </button>
                  </div>
                  <input
                    type="date"
                    value={formData.lastService}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        lastService: e.target.value,
                      })
                    }
                    className={`w-full px-3 py-2.5 border rounded-xl focus:outline-none text-sm font-medium shadow-sm transition-all ${inputCls}`}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    className={`text-[11px] uppercase tracking-wider font-semibold ${sectionLabel}`}
                  >
                    Notes (Optional)
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    rows={4}
                    placeholder="Add maintenance notes, known issues, or context"
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
                form="marker-form"
                className={`px-8 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${saveBtn}`}
              >
                Save
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
                Discard Asset?
              </h3>
              <p className={`text-sm mb-6 ${confirmP}`}>
                Are you sure you want to discard this asset entry? All entered
                details will be lost.
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
