"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Map as MapIcon,
  Database,
  Grip,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  CircleCheck,
  CircleX,
  TriangleAlert,
  Info,
} from "lucide-react";
import clsx from "clsx";
import Link from "next/link";
import { toast, Toaster } from "sonner";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { startQueueProcessor } from "@/lib/queueProcessor";
import AppGuideTour from "@/components/onboarding/AppGuideTour";

const PIPELINE_QUEUE_KEY = "pipeiq-pipeline-queue";
const SIDEBAR_COLLAPSED_WIDTH = 88;
const SIDEBAR_EXPANDED_WIDTH = 288;

const MapComponent = dynamic<{ sidebarCollapsed?: boolean }>(
  () => import("@/components/map/Map"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full bg-slate-50/50 dark:bg-slate-950/50" />
    ),
  },
);

const Sidebar = ({
  collapsed,
  setCollapsed,
  queueCount,
  queueScoredCount,
  queueNextRetryAt,
  onRetryQueueNow,
  dark,
  setDark,
}: {
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
  queueCount: number;
  queueScoredCount: number;
  queueNextRetryAt: number | null;
  onRetryQueueNow: () => void;
  dark: boolean;
  setDark: (d: boolean) => void;
}) => {
  const [clockMs, setClockMs] = useState(() => Date.now());

  useEffect(() => {
    if (!queueNextRetryAt) return;
    const timer = setInterval(() => {
      setClockMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [queueNextRetryAt]);

  const progressPct =
    queueCount + queueScoredCount > 0
      ? Math.min(
          100,
          Math.round(
            (queueScoredCount / (queueCount + queueScoredCount)) * 100,
          ),
        )
      : 0;

  const retryCountdownLabel = (() => {
    if (!queueNextRetryAt) return null;
    const remainingMs = queueNextRetryAt - clockMs;
    if (remainingMs <= 0) return "Next retry in a few seconds";

    const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    if (totalSeconds < 60) return `Next retry in ${totalSeconds}s`;

    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins < 60) return `Next retry in ${mins}m ${secs}s`;

    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins
      ? `Next retry in ${hours}h ${remMins}m`
      : `Next retry in ${hours}h`;
  })();

  const pathname = usePathname();

  const navItems = [
    { icon: MapIcon, label: "Map", path: "/" },
    { icon: Database, label: "Pipelines", path: "/pipelines" },
    { icon: Grip, label: "Zones", path: "/zones" },
    { icon: MapPin, label: "Assets", path: "/assets" },
  ];

  return (
    <motion.div
      initial={{ width: SIDEBAR_EXPANDED_WIDTH }}
      animate={{
        width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH,
      }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      data-guide="sidebar"
      className={clsx(
        "h-full relative flex flex-col z-20 overflow-hidden shadow-sm border-r transition-colors duration-300",
        dark ? "bg-slate-900 border-slate-700/60" : "bg-white border-slate-200",
      )}
    >
      {/* Header */}
      <div
        className={clsx(
          "h-16 flex items-center px-4 border-b z-10 relative transition-colors duration-300",
          dark
            ? "border-slate-700/60 bg-slate-900"
            : "border-slate-200 bg-white",
        )}
      >
        <div className="flex items-center gap-3 overflow-hidden pl-2 flex-1">
          <AnimatePresence mode="wait">
            {collapsed ? (
              <motion.button
                key="collapsed-logo"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setCollapsed(false)}
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className={clsx(
                  "group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                  dark
                    ? "text-white hover:bg-slate-800"
                    : "text-slate-900 hover:bg-slate-100",
                )}
              >
                <span className="font-bold text-2xl transition-opacity duration-150 group-hover:opacity-0">
                  P
                </span>
                <ChevronRight
                  size={20}
                  className="absolute opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                />
              </motion.button>
            ) : (
              <motion.span
                key="expanded-logo"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className={clsx(
                  "text-xl whitespace-nowrap",
                  dark ? "text-white" : "text-slate-900",
                )}
              >
                <span className="font-light">Pipe</span>
                <span className="font-bold">IQ</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {!collapsed && (
          <div className="flex items-center gap-1">
            {/* Collapse toggle */}
            <button
              onClick={() => setCollapsed(true)}
              className={clsx(
                "p-1 rounded-md transition-colors",
                dark
                  ? "text-slate-400 hover:bg-slate-800"
                  : "text-slate-500 hover:bg-slate-100",
              )}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-1 z-10 relative">
        {navItems.map((item) => {
          const isActive =
            pathname === item.path ||
            (item.path !== "/" && pathname?.startsWith(item.path));
          return (
            <Link
              key={item.label}
              href={item.path}
              className="block mx-2 relative group"
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-indicator"
                  className={clsx(
                    "absolute -left-2 top-1.5 bottom-1.5 w-1 rounded-r-full z-10",
                    dark ? "bg-amber-400" : "bg-sky-500",
                  )}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                />
              )}

              <motion.div
                whileHover={{
                  backgroundColor: dark
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(0,0,0,0.03)",
                }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors",
                  isActive
                    ? dark
                      ? "text-white font-medium"
                      : "text-slate-900 font-medium"
                    : dark
                      ? "text-slate-400 hover:text-slate-200"
                      : "text-slate-500 hover:text-slate-800",
                )}
              >
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <item.icon
                    size={20}
                    className={
                      isActive
                        ? dark
                          ? "text-white"
                          : "text-slate-900"
                        : dark
                          ? "text-slate-500 group-hover:text-slate-300 transition-colors"
                          : "text-slate-400 group-hover:text-slate-600 transition-colors"
                    }
                  />
                </div>

                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: "auto" }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="whitespace-nowrap overflow-hidden"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Hover tooltip for collapsed state */}
              {collapsed && (
                <div
                  className={clsx(
                    "absolute left-full top-0 ml-2 px-3 py-1.5 text-xs font-medium rounded-md shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 border transition-all",
                    dark
                      ? "bg-slate-800 text-white border-slate-700"
                      : "bg-white/90 backdrop-blur-md text-slate-800 border-white/20",
                  )}
                >
                  {item.label}
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Prediction Queue Card */}
      <AnimatePresence>
        {queueCount > 0 || queueScoredCount > 0 ? (
          <motion.div
            key="pending-card"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="mx-3 mb-3 mt-1 p-2.5 rounded-xl bg-slate-900 border border-slate-700/60 shadow-lg shadow-black/20"
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      "inline-flex rounded-full h-2 w-2",
                      dark ? "bg-amber-400" : "bg-sky-400",
                    )}
                  />
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest leading-none">
                    {collapsed ? "" : "Prediction Queue"}
                  </span>
                </div>
                <span
                  className={clsx(
                    "text-[11px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 leading-none",
                    dark
                      ? "text-slate-900 bg-amber-400"
                      : "text-white bg-sky-500",
                  )}
                >
                  {queueCount}
                </span>
              </div>

              <AnimatePresence>
                {!collapsed && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col gap-2"
                  >
                    <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
                      <motion.div
                        className={clsx(
                          "h-full rounded-full",
                          dark ? "bg-amber-400" : "bg-sky-400",
                        )}
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPct}%` }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      {queueCount} pipeline{queueCount !== 1 ? "s" : ""} in
                      queue • {progressPct}% scored
                    </p>
                    {retryCountdownLabel && (
                      <p className="text-[10px] text-slate-400/90 leading-snug">
                        {retryCountdownLabel}
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Dark Mode Toggle */}
      <div
        className={clsx(
          "mt-auto p-3 border-t transition-colors duration-300",
          dark ? "border-slate-700/60" : "border-slate-200",
        )}
      >
        <button
          onClick={() => setDark(!dark)}
          className={clsx(
            "w-full flex items-center justify-center p-2.5 rounded-lg transition-colors",
            dark
              ? "bg-slate-800/60 hover:bg-slate-700 text-amber-400"
              : "bg-slate-100 hover:bg-slate-200 text-sky-600",
          )}
          title="Toggle dark mode"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </motion.div>
  );
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [queueScoredCount, setQueueScoredCount] = useState(0);
  const [queueNextRetryAt, setQueueNextRetryAt] = useState<number | null>(null);
  const [dark, setDark] = useState(false);

  // Persist dark mode preference
  useEffect(() => {
    const saved = localStorage.getItem("pipeiq_dark");
    if (saved === "true") setDark(true);
  }, []);

  // Start queue processor on mount
  useEffect(() => {
    startQueueProcessor();
  }, []);

  // Warn user before navigating away with pending pipelines
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const queue = JSON.parse(
        localStorage.getItem(PIPELINE_QUEUE_KEY) || "[]",
      ) as Array<{ status?: string }>;
      if (queue.length > 0) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    localStorage.setItem("pipeiq_dark", String(dark));
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Read queue stats from localStorage and keep sidebar indicator in sync.
  useEffect(() => {
    const sync = () => {
      const queue = JSON.parse(
        localStorage.getItem(PIPELINE_QUEUE_KEY) || "[]",
      ) as Array<{
        status?: string;
        predictionStatus?: string;
        risk_score?: number;
        riskScore?: number;
        risk_band?: string;
        confidence_band?: string;
        nextAttemptAt?: number;
      }>;
      const scoredCount = queue.filter(
        (item) =>
          item?.status === "scored" || item?.predictionStatus === "complete",
      ).length;
      setQueueScoredCount(scoredCount);
      setQueueCount(queue.length - scoredCount);

      const nextRetryAt = queue
        .map((item) => Number(item?.nextAttemptAt || 0))
        .filter((ts) => Number.isFinite(ts) && ts > Date.now())
        .sort((a, b) => a - b)[0];

      setQueueNextRetryAt(Number.isFinite(nextRetryAt) ? nextRetryAt : null);
    };
    sync();
    const timer = setInterval(sync, 1000);
    window.addEventListener("pipeiq_pending_updated", sync);
    window.addEventListener("pipeiq_queue_updated", sync);
    window.addEventListener("pipeiq_pipeline_saved", sync);
    window.addEventListener("pipeiq_map_layers_updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pipeiq_pending_updated", sync);
      window.removeEventListener("pipeiq_queue_updated", sync);
      window.removeEventListener("pipeiq_pipeline_saved", sync);
      window.removeEventListener("pipeiq_map_layers_updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Listen for explicit predictions complete event
  useEffect(() => {
    const handler = () => {
      toast.success("All queued checks are done", {
        id: "predictions-complete",
        description: "You're good to continue drawing.",
        duration: 4000,
      });
    };
    window.addEventListener("pipeiq_predictions_complete", handler);
    return () =>
      window.removeEventListener("pipeiq_predictions_complete", handler);
  }, []);

  useEffect(() => {
    const onRetrying = (_e: Event) => {
      toast.warning("We're reconnecting in the background", {
        id: "queue-backend-down",
        description:
          "You can keep drawing up to 20 pipelines while we reconnect.",
        duration: 6000,
      });
    };

    const onRecovered = (_e: Event) => {
      toast.dismiss("queue-backend-down");
      toast.success("Connection restored", {
        id: "queue-recovered",
        description: "Queued pipelines are syncing now.",
        duration: 3500,
      });
    };

    window.addEventListener("pipeiq_queue_retrying", onRetrying);
    window.addEventListener("pipeiq_queue_recovered", onRecovered);
    return () => {
      window.removeEventListener("pipeiq_queue_retrying", onRetrying);
      window.removeEventListener("pipeiq_queue_recovered", onRecovered);
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const enabled = (e as CustomEvent).detail?.enabled;
      if (enabled) {
        toast.success("Drawing tools turned on", {
          description: "You can now draw and edit items on the map.",
          duration: 2500,
        });
      } else {
        toast.info("Drawing tools turned off", {
          description: "Map drawing tools are now hidden.",
          duration: 2500,
        });
      }
    };
    window.addEventListener("pipeiq_studio_toggled", handler);
    return () => window.removeEventListener("pipeiq_studio_toggled", handler);
  }, []);

  // Sync sidebar width CSS variable
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      `${collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH}px`,
    );
  }, [collapsed]);

  const handleRetryQueueNow = () => {
    window.dispatchEvent(new Event("pipeiq_run_predict_force"));
  };

  return (
    <div
      className={clsx(
        "flex h-screen w-full overflow-hidden relative transition-colors duration-300",
        dark ? "text-slate-100" : "text-slate-900",
      )}
    >
      {/* Global Map Background */}
      <div className="absolute inset-0 z-0">
        <MapComponent sidebarCollapsed={collapsed} />
      </div>

      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        queueCount={queueCount}
        queueScoredCount={queueScoredCount}
        queueNextRetryAt={queueNextRetryAt}
        onRetryQueueNow={handleRetryQueueNow}
        dark={dark}
        setDark={setDark}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 pointer-events-none">
        <div className="flex-1 h-full w-full">{children}</div>
      </main>

      <Toaster
        position="top-center"
        expand={false}
        richColors={false}
        closeButton={false}
        visibleToasts={4}
        theme={dark ? "dark" : "light"}
        icons={{
          success: (
            <CircleCheck
              size={16}
              className="text-emerald-500 dark:text-emerald-400"
            />
          ),
          error: (
            <CircleX size={16} className="text-red-500 dark:text-red-400" />
          ),
          warning: (
            <TriangleAlert
              size={16}
              className="text-amber-500 dark:text-amber-400"
            />
          ),
          info: <Info size={16} className="text-sky-500 dark:text-sky-400" />,
        }}
        toastOptions={{
          className:
            "rounded-xl border border-slate-300/60 dark:border-slate-700/70 shadow-md backdrop-blur-md",
          style: {
            fontFamily: "inherit",
            background: dark
              ? "rgba(15, 23, 42, 0.88)"
              : "rgba(255, 255, 255, 0.9)",
            color: dark ? "#e2e8f0" : "#0f172a",
          },
        }}
      />

      <AppGuideTour />
    </div>
  );
}
