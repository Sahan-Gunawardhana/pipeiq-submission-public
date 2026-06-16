interface RiskBadgeProps {
  score?: number;
  riskBand?: string;
  confidenceBand?: string;
}

export default function RiskBadge({
  score,
  riskBand,
  confidenceBand,
}: RiskBadgeProps) {
  const normalizedRiskBand = String(riskBand || "").toLowerCase();
  const normalizedScore = Number(score);

  let label = "Low";
  if (normalizedRiskBand === "high" || normalizedScore >= 75) {
    label = "High";
  } else if (normalizedRiskBand === "medium" || normalizedScore >= 40) {
    label = "Medium";
  }

  const colorClass =
    label === "High"
      ? "bg-red-100 text-red-800 border-red-200 dark:bg-red-500/20 dark:text-red-200 dark:border-red-500/30"
      : label === "Medium"
        ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/30"
        : "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-500/30";

  const normalizedConfidenceBand = String(confidenceBand || "").toLowerCase();
  const confidenceClass =
    normalizedConfidenceBand === "high"
      ? "text-blue-800 dark:text-blue-200"
      : normalizedConfidenceBand === "medium"
        ? "text-violet-800 dark:text-violet-200"
        : "text-slate-700 dark:text-slate-300";

  const confidenceText = confidenceBand ? ` | Conf ${confidenceBand}` : "";
  const scoreDisplay =
    Number.isFinite(normalizedScore) && normalizedScore > 0
      ? ` (${normalizedScore})`
      : "";

  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}
    >
      {label}
      {scoreDisplay}
      {confidenceText ? (
        <span className={confidenceClass}>{confidenceText}</span>
      ) : null}
    </span>
  );
}
