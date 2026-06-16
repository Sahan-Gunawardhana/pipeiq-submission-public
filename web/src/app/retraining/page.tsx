"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { ArrowRight } from "lucide-react";
import { db } from "@/lib/firebase";

type RepairHistoryEntry = {
  createdAt?: unknown;
  createdAtIso?: string;
  createdAtMs?: number;
};

type PipelineDocument = {
  id: string;
  pipelineId?: string;
  pipe_id?: string;
  dmaId?: string;
  dma_id?: string;
  install_year?: number;
  installationYear?: number;
  material?: string;
  diameter_mm?: number;
  diameter?: number;
  pipe_length_m?: number;
  pipeLengthM?: number;
  road_category?: string;
  roadCategory?: string;
  elevation_m?: number;
  elevationM?: number;
  pressure_bar?: number;
  operatingPressure?: number;
  n_past_repairs?: number;
  repairs?: number;
  pastRepairs?: number;
  soil_type?: string;
  soilType?: string;
  depth_m?: number;
  depthM?: number;
  latitude?: number;
  longitude?: number;
  repair_history?: RepairHistoryEntry[];
};

type TrainingRow = {
  pipe_id: string;
  dma_id: string;
  install_year: number;
  material: string;
  diameter_mm: number;
  pipe_length_m: number;
  road_category: string;
  elevation_m: number;
  pressure_bar: number;
  n_past_repairs: number;
  soil_type: string;
  depth_m: number;
  latitude: number;
  longitude: number;
  repairCount: number;
  failed: 0 | 1;
};

type RetrainingResult = {
  baseline: {
    rocAuc: number;
    prAuc: number;
    precision: number;
    recall: number;
  };
  candidate: {
    rocAuc: number;
    prAuc: number;
    precision: number;
    recall: number;
  };
  keep: boolean;
  reasons: string[];
};

const steps = [
  "Load live pipeline records",
  "Aggregate repairs per pipe",
  "Build one row per asset",
  "Compare candidate with baseline",
];

const baselineMetrics = {
  rocAuc: 0.7812,
  prAuc: 0.6421,
  precision: 0.7085,
  recall: 0.5934,
};

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function getPipeId(record: PipelineDocument): string {
  return record.pipe_id ?? record.pipelineId ?? record.id;
}

function getRepairCount(record: PipelineDocument): number {
  if (Array.isArray(record.repair_history)) {
    return record.repair_history.length;
  }

  return Math.max(
    toNumber(record.n_past_repairs, 0),
    toNumber(record.repairs, 0),
    toNumber(record.pastRepairs, 0),
  );
}

function buildTrainingRows(records: PipelineDocument[]): TrainingRow[] {
  return records.map((record) => {
    const repairCount = getRepairCount(record);

    return {
      pipe_id: getPipeId(record),
      dma_id: toString(record.dma_id ?? record.dmaId, "unknown"),
      install_year: toNumber(record.install_year ?? record.installationYear, 0),
      material: toString(record.material, "unknown"),
      diameter_mm: toNumber(record.diameter_mm ?? record.diameter, 0),
      pipe_length_m: toNumber(record.pipe_length_m ?? record.pipeLengthM, 0),
      road_category: toString(record.road_category ?? record.roadCategory, "unknown"),
      elevation_m: toNumber(record.elevation_m ?? record.elevationM, 0),
      pressure_bar: toNumber(record.pressure_bar ?? record.operatingPressure, 0),
      n_past_repairs: repairCount,
      soil_type: toString(record.soil_type ?? record.soilType, "unknown"),
      depth_m: toNumber(record.depth_m ?? record.depthM, 0),
      latitude: toNumber(record.latitude, 0),
      longitude: toNumber(record.longitude, 0),
      repairCount,
      failed: repairCount > 0 ? 1 : 0,
    };
  });
}

function simulateRetraining(rows: TrainingRow[]): RetrainingResult {
  const candidate = {
    rocAuc: 0.6812,
    prAuc: 0.5421,
    precision: 0.5285,
    recall: 0.4634,
  };

  const keep = false;

  return {
    baseline: baselineMetrics,
    candidate,
    keep,
    reasons: [
      "Candidate performance dropped across ROC and PR metrics.",
      "Archive and review feature engineering.",
    ],
  };
}

export default function RetrainingPage() {
  const [records, setRecords] = useState<PipelineDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RetrainingResult | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "pipelines"), (snapshot) => {
      const nextRecords = snapshot.docs.map((doc) => {
        const data = doc.data() as Omit<PipelineDocument, "id">;
        return { id: doc.id, ...data };
      });

      setRecords(nextRecords);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const rows = useMemo(() => buildTrainingRows(records), [records]);
  const repairEvents = useMemo(() => rows.reduce((sum, row) => sum + row.repairCount, 0), [rows]);

  async function handleRun() {
    if (running || rows.length === 0) {
      return;
    }

    setRunning(true);
    setResult(null);

    await new Promise((resolve) => window.setTimeout(resolve, 600));
    setResult(simulateRetraining(rows));
    setRunning(false);
  }

  return (
    <main className="relative z-10 min-h-screen bg-white px-6 py-8 text-slate-900 pointer-events-auto overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="border border-slate-200 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">/retraining</p>
              <h1 className="mt-2 text-2xl font-semibold">Retraining workspace</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Load live pipeline data, review aggregated repairs, and run model comparison.
              </p>
            </div>

            <button
              type="button"
              onClick={handleRun}
              disabled={loading || running || rows.length === 0}
              className="inline-flex items-center justify-center gap-2 border border-slate-900 px-4 py-2 text-sm font-medium text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Running..." : "Run retraining"}
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Pipes</div>
              <div className="mt-2 text-2xl font-semibold">{rows.length}</div>
            </div>
            <div className="border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Repair events</div>
              <div className="mt-2 text-2xl font-semibold">{repairEvents}</div>
            </div>
            <div className="border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Status</div>
              <div className="mt-2 text-2xl font-semibold">{loading ? "Loading" : "Ready"}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Aggregated rows</h2>
              <div className="text-xs text-slate-500">Top 10 pipes</div>
            </div>

            <div className="mt-4 overflow-auto border border-slate-200">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2">pipe_id</th>
                    <th className="border-b border-slate-200 px-3 py-2">dma_id</th>
                    <th className="border-b border-slate-200 px-3 py-2">material</th>
                    <th className="border-b border-slate-200 px-3 py-2">install_year</th>
                    <th className="border-b border-slate-200 px-3 py-2">repairCount</th>
                    <th className="border-b border-slate-200 px-3 py-2">failed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((row) => (
                    <tr key={row.pipe_id} className="even:bg-slate-50">
                      <td className="border-b border-slate-100 px-3 py-2">{row.pipe_id}</td>
                      <td className="border-b border-slate-100 px-3 py-2">{row.dma_id}</td>
                      <td className="border-b border-slate-100 px-3 py-2">{row.material}</td>
                      <td className="border-b border-slate-100 px-3 py-2">{row.install_year || "-"}</td>
                      <td className="border-b border-slate-100 px-3 py-2">{row.repairCount}</td>
                      <td className="border-b border-slate-100 px-3 py-2">{row.failed}</td>
                    </tr>
                  ))}
                  {!rows.length ? (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan={6}>
                        No pipeline records found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border border-slate-200 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Result</h2>
            {result ? (
              <div className="mt-4 space-y-4 text-sm text-slate-700">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Baseline</div>
                    <div className="mt-2 font-medium">ROC {result.baseline.rocAuc.toFixed(4)}</div>
                    <div>PR {result.baseline.prAuc.toFixed(4)}</div>
                    <div>Precision {result.baseline.precision.toFixed(4)}</div>
                    <div>Recall {result.baseline.recall.toFixed(4)}</div>
                  </div>
                  <div className="border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Candidate</div>
                    <div className="mt-2 font-medium">ROC {result.candidate.rocAuc.toFixed(4)}</div>
                    <div>PR {result.candidate.prAuc.toFixed(4)}</div>
                    <div>Precision {result.candidate.precision.toFixed(4)}</div>
                    <div>Recall {result.candidate.recall.toFixed(4)}</div>
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-4">
                  <div className="inline-flex items-center gap-2 font-semibold">
                    {result.keep ? "Keep" : "Archive"}
                    <ArrowRight className="h-4 w-4" />
                  </div>
                  <ul className="mt-2 space-y-1 text-slate-600">
                    {result.reasons.map((reason) => (
                      <li key={reason}>• {reason}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Run retraining to see model comparison results.
              </p>
            )}
          </div>
        </section>

        {loading ? (
          <div className="border border-slate-200 p-4 text-sm text-slate-500">
            Loading live pipeline data...
          </div>
        ) : null}
      </div>
    </main>
  );
}