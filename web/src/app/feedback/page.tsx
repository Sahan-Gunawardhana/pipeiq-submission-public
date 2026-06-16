"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import Link from "next/link";
import { db } from "@/lib/firebase";

type FeedbackRecord = {
  id: string;
  pipelineId?: string;
  repairId?: string;
  actualOutcome?: string;
  feedbackCategory?: string;
  predictedRiskBand?: string;
  predictedRiskScore?: number;
  predictedRiskScoreRaw?: number;
  confidenceScore?: number;
  confidenceBand?: string;
  predictedAt?: unknown;
  repairedAt?: unknown;
  createdAt?: unknown;
  pipelineSnapshot?: {
    material?: string | null;
    age?: number | null;
    diameter?: number | null;
    depthM?: number | null;
    pressureBar?: number | null;
    zoneId?: string | null;
    previousRepairs?: number | null;
  };
  repairSnapshot?: {
    issueType?: string;
    repairType?: string;
    severity?: string;
    flowRate?: string;
    createdAtIso?: string;
  };
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object" && value !== null) {
    const maybeTimestamp = value as { toMillis?: () => number; seconds?: number };
    if (typeof maybeTimestamp.toMillis === "function") {
      return maybeTimestamp.toMillis();
    }
    if (Number.isFinite(Number(maybeTimestamp.seconds))) {
      return Number(maybeTimestamp.seconds) * 1000;
    }
  }
  return 0;
}

function formatDate(value: unknown): string {
  const ms = toMillis(value);
  if (!ms) return "";
  return new Date(ms).toISOString();
}

function formatNumber(value: unknown, digits = 0): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toFixed(digits);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") {
    return JSON.stringify(value, jsonReplacer);
  }
  return String(value);
}

function toDisplayObject(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value || {}, jsonReplacer));
}

function toExportRow(record: FeedbackRecord) {
  const snapshot = record.pipelineSnapshot || {};
  const repair = record.repairSnapshot || {};

  return {
    id: record.id,
    pipelineId: record.pipelineId || "",
    repairId: record.repairId || "",
    actualOutcome: record.actualOutcome || "repair_logged",
    predictedRiskBand: record.predictedRiskBand || "",
    predictedRiskScore: record.predictedRiskScore ?? "",
    predictedRiskScoreRaw: record.predictedRiskScoreRaw ?? "",
    confidenceScore: record.confidenceScore ?? "",
    confidenceBand: record.confidenceBand || "",
    material: snapshot.material || "",
    age: snapshot.age ?? "",
    diameter: snapshot.diameter ?? "",
    depthM: snapshot.depthM ?? "",
    pressureBar: snapshot.pressureBar ?? "",
    zoneId: snapshot.zoneId || "",
    previousRepairs: snapshot.previousRepairs ?? "",
    issueType: repair.issueType || repair.repairType || "",
    severity: repair.severity || "",
    flowRate: repair.flowRate || "",
    predictedAt: formatDate(record.predictedAt),
    repairedAt: formatDate(record.repairedAt),
    createdAt: formatDate(record.createdAt),
  };
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === "object" && value !== null) {
    const maybeTimestamp = value as { toDate?: () => Date; toMillis?: () => number };
    if (typeof maybeTimestamp.toDate === "function") {
      return maybeTimestamp.toDate().toISOString();
    }
    if (typeof maybeTimestamp.toMillis === "function") {
      return new Date(maybeTimestamp.toMillis()).toISOString();
    }
  }
  return value;
}

function KeyValueTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return <p className="py-2 text-sm text-slate-500">No data</p>;
  }

  return (
    <table className="w-full border-collapse text-left text-xs">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-b border-slate-100 last:border-b-0">
            <th className="w-56 py-2 pr-4 align-top font-mono font-semibold text-slate-600">
              {key}
            </th>
            <td className="py-2 align-top font-mono text-slate-800">
              {typeof value === "object" && value !== null ? (
                <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(value, null, 2)}
                </pre>
              ) : (
                formatValue(value)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PayloadSection({
  title,
  data,
  defaultOpen = false,
}: {
  title: string;
  data: Record<string, unknown>;
  defaultOpen?: boolean;
}) {
  return (
    <details className="border-t border-slate-200 py-2" open={defaultOpen}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        {title}
      </summary>
      <div className="mt-2">
        <KeyValueTable data={data} />
      </div>
    </details>
  );
}

export default function FeedbackPage() {
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "ground_truth_feedback"),
      (snapshot) => {
        const nextRecords = snapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...(doc.data() as Omit<FeedbackRecord, "id">),
          }))
          .sort((a, b) => {
            const aDate = toMillis(a.createdAt || a.repairedAt);
            const bDate = toMillis(b.createdAt || b.repairedAt);
            return bDate - aDate;
          });

        setRecords(nextRecords);
        setLoading(false);
        setError(null);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  const handleExportJson = () => {
    downloadFile(
      "ground_truth_feedback.json",
      JSON.stringify(records, jsonReplacer, 2),
      "application/json",
    );
  };

  const handleExportCsv = () => {
    const exportRows = records.map(toExportRow);
    if (exportRows.length === 0) {
      downloadFile("ground_truth_feedback.csv", "", "text/csv");
      return;
    }

    const headers = Object.keys(exportRows[0]);
    const csv = [
      headers.map(csvEscape).join(","),
      ...exportRows.map((row) =>
        headers
          .map((header) => csvEscape(row[header as keyof typeof row]))
          .join(","),
      ),
    ].join("\n");

    downloadFile("ground_truth_feedback.csv", csv, "text/csv");
  };

  return (
    <main className="fixed inset-0 overflow-y-auto overflow-x-hidden bg-white p-6 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          >
            Back to app
          </Link>
          <button
            type="button"
            onClick={handleExportCsv}
            className="border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          >
            Export JSON
          </button>
        </div>

        <h1 className="mb-2 text-xl font-semibold">Ground Truth Feedback</h1>
        <p className="mb-6 text-sm text-slate-600">
          Repair records linked with the prediction values that existed on the
          pipeline at repair time.
        </p>

        {loading ? (
          <p className="text-sm text-slate-600">Loading feedback records...</p>
        ) : error ? (
          <p className="text-sm text-red-600">
            Could not load feedback records: {error}
          </p>
        ) : (
          <>
            <h2 className="mb-2 text-sm font-semibold">Aggregate</h2>
            <div className="mb-6 overflow-x-auto">
              <table className="min-w-[420px] border-collapse text-left text-sm">
                <tbody>
                  <tr className="border-b border-slate-200">
                    <th className="py-2 pr-8 font-medium text-slate-600">
                      Total Ground Truth Records
                    </th>
                    <td className="py-2 font-mono">{records.length}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h2 className="mb-2 text-sm font-semibold">Records</h2>
            {records.length === 0 ? (
              <p className="text-sm text-slate-600">
                No feedback records found.
              </p>
            ) : (
              <div className="overflow-x-auto border-t border-slate-200">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr className="border-b border-slate-300">
                      <th className="py-2 pr-5 font-semibold">Document</th>
                      <th className="py-2 pr-5 font-semibold">Pipeline</th>
                      <th className="py-2 pr-5 font-semibold">Prediction</th>
                      <th className="py-2 pr-5 font-semibold">Repair</th>
                      <th className="py-2 pr-5 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => {
                      const payload = toDisplayObject(record);
                      const {
                        id: _id,
                        pipelineSnapshot,
                        predictionSnapshot,
                        repairSnapshot,
                        ...topLevel
                      } = payload;

                      return (
                        <tr key={record.id} className="border-b border-slate-200">
                          <td className="py-2 pr-5 align-top font-mono text-xs">
                            {record.id}
                          </td>
                          <td className="py-2 pr-5 align-top font-mono text-xs">
                            {record.pipelineId || "-"}
                          </td>
                          <td className="py-2 pr-5 align-top text-xs">
                            <div>Band: {record.predictedRiskBand || "-"}</div>
                            <div>
                              Score: {formatNumber(record.predictedRiskScore)}
                            </div>
                            <div>
                              Confidence:{" "}
                              {formatNumber(record.confidenceScore, 2)}
                            </div>
                          </td>
                          <td className="py-2 pr-5 align-top text-xs">
                            <div>ID: {record.repairId || "-"}</div>
                            <div>Outcome: {record.actualOutcome || "-"}</div>
                            <div>At: {formatDate(record.repairedAt) || "-"}</div>
                          </td>
                          <td className="min-w-[520px] py-2 pr-5 align-top">
                            <PayloadSection
                              title="Top-level fields"
                              data={topLevel}
                              defaultOpen
                            />
                            <PayloadSection
                              title="pipelineSnapshot"
                              data={(pipelineSnapshot || {}) as Record<string, unknown>}
                            />
                            <PayloadSection
                              title="predictionSnapshot"
                              data={(predictionSnapshot || {}) as Record<string, unknown>}
                            />
                            <PayloadSection
                              title="repairSnapshot"
                              data={(repairSnapshot || {}) as Record<string, unknown>}
                            />
                            <PayloadSection title="Raw payload" data={payload} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
