import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 4000);
const riskApiBase = process.env.RISK_API_BASE || "http://127.0.0.1:8000";
const riskApiTimeoutMs = Number(process.env.RISK_API_TIMEOUT_MS || 12000);
const autoStartRiskApi = process.env.AUTO_START_RISK_API !== "false";
const riskApiPython = process.env.RISK_API_PYTHON || "python3";
const riskApiRetryCount = Math.max(
  0,
  Number(process.env.RISK_API_RETRY_COUNT || 1),
);
const riskApiRetryDelayMs = Math.max(
  100,
  Number(process.env.RISK_API_RETRY_DELAY_MS || 400),
);
const riskApiFailureThreshold = Math.max(
  1,
  Number(process.env.RISK_API_FAILURE_THRESHOLD || 3),
);
const riskApiCooldownMs = Math.max(
  10000,
  Number(process.env.RISK_API_COOLDOWN_MS || 60000),
);
const riskApiColdIdleMs = Math.max(
  60000,
  Number(process.env.RISK_API_COLD_IDLE_MS || 30 * 60 * 1000),
);
const riskApiStartupWaitMs = Math.max(
  1000,
  Number(process.env.RISK_API_STARTUP_WAIT_MS || 2 * 60 * 1000),
);
const riskApiStartupPollMs = Math.max(
  250,
  Number(process.env.RISK_API_STARTUP_POLL_MS || 1000),
);
const corsOrigins = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(__dirname, "../..");
const bundledRiskApiRoot = path.join(backendRoot, "risk_api");
const riskApiWorkdir =
  process.env.RISK_API_WORKDIR ||
  (existsSync(bundledRiskApiRoot) ? backendRoot : repoRoot);

let riskApiProcess = null;
let lastScoreRequestAt = 0;
const riskApiCircuit = {
  failures: 0,
  openUntil: 0,
  lastError: null,
};

class RiskApiUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "RiskApiUnavailableError";
    this.retryAfterSeconds = options.retryAfterSeconds || 30;
    this.details = options.details || null;
  }
}

const DMA_LOOKUP = new Set(["42_73_01", "42_71_01", "42_72_01", "42_74_01"]);
const DEFAULT_DMA_ID = process.env.DEFAULT_DMA_ID || "42_74_01";

const ROAD_CATEGORY_MAP = {
  low: "Private Road",
  medium: "Minor Road",
  high: "Main Road (A26)",
};

const SOIL_TYPE_MAP = {
  standard: "Red-Yellow Podzolic Soil",
  corrosive: "Alluvial Soils",
  sandy: "Mountain Regosols",
  clay: "Immature Brown Loams (IBL)",
};

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes("*") || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
  }),
);
app.use(express.json({ limit: "1mb" }));

const normalizeString = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const toFiniteNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const classifyRiskFromProbability = (riskScore) => {
  if (riskScore < 0.27) return "Low";
  if (riskScore < 0.5) return "Medium";
  return "High";
};

const haversineDistanceMeters = (a, b) => {
  const toRadians = (deg) => (deg * Math.PI) / 180;
  const lat1 = toRadians(a[0]);
  const lon1 = toRadians(a[1]);
  const lat2 = toRadians(b[0]);
  const lon2 = toRadians(b[1]);

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return 6371000 * c;
};

const computePipeLengthMeters = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return 138.805;
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    if (!Array.isArray(prev) || !Array.isArray(curr)) continue;
    if (!Number.isFinite(Number(prev[0])) || !Number.isFinite(Number(prev[1])))
      continue;
    if (!Number.isFinite(Number(curr[0])) || !Number.isFinite(Number(curr[1])))
      continue;
    total += haversineDistanceMeters(
      [Number(prev[0]), Number(prev[1])],
      [Number(curr[0]), Number(curr[1])],
    );
  }

  if (!Number.isFinite(total) || total <= 0) {
    return 138.805;
  }

  return clamp(total, 2.21, 922.6532);
};

const normalizeRoadCategory = (payload) => {
  const explicitRoadCategory = normalizeString(
    payload.road_category || payload.roadCategory,
  );
  if (explicitRoadCategory) return explicitRoadCategory;

  const trafficLoading = normalizeString(payload.trafficLoading).toLowerCase();
  if (trafficLoading in ROAD_CATEGORY_MAP)
    return ROAD_CATEGORY_MAP[trafficLoading];
  return "Minor Road";
};

const normalizeSoilType = (payload) => {
  const explicitSoil = normalizeString(payload.soil_type || payload.soilType);
  if (explicitSoil) return explicitSoil;

  const soilAlias = normalizeString(payload.soilProfile).toLowerCase();
  if (soilAlias in SOIL_TYPE_MAP) return SOIL_TYPE_MAP[soilAlias];
  return "Red-Yellow Podzolic Soil";
};

const normalizeDmaId = (payload) => {
  const candidate = normalizeString(
    payload.dma_id || payload.dmaId || payload.zoneId || payload.zone,
  );
  if (candidate) return candidate;
  return DEFAULT_DMA_ID;
};

const buildPredictRequest = (payload) => {
  const pipelineId = normalizeString(
    payload.id || payload.pipelineId || payload.pipe_id || payload.pipeId,
  );
  const coordinates = Array.isArray(payload.coordinates)
    ? payload.coordinates
    : [];
  const rawInstallYear = toFiniteNumber(
    payload.install_year ?? payload.installationYear,
    2010,
  );
  const userPipeLength = toFiniteNumber(
    payload.pipe_length_m ?? payload.pipeLengthM,
    NaN,
  );

  return {
    pipe_id: pipelineId || null,
    dma_id: normalizeDmaId(payload),
    install_year: Math.round(rawInstallYear),
    material: normalizeString(payload.material) || "PVC",
    diameter_mm: toFiniteNumber(payload.diameter_mm ?? payload.diameter, 100),
    pipe_length_m: Number.isFinite(userPipeLength)
      ? userPipeLength
      : computePipeLengthMeters(coordinates),
    road_category: normalizeRoadCategory(payload),
    elevation_m: toFiniteNumber(
      payload.elevation_m ?? payload.elevation ?? payload.elevationM,
      487.9,
    ),
    pressure_bar: toFiniteNumber(
      payload.pressure_bar ?? payload.operatingPressure,
      4.9,
    ),
    n_past_repairs: Math.max(
      0,
      Math.round(
        toFiniteNumber(
          payload.n_past_repairs ?? payload.pastRepairs ?? payload.repairs,
          0,
        ),
      ),
    ),
    soil_type: normalizeSoilType(payload),
    depth_m: toFiniteNumber(
      payload.depth_m ?? payload.depth ?? payload.depthM,
      0.88,
    ),
  };
};

const callRiskApi = async (predictRequest) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), riskApiTimeoutMs);

  try {
    const response = await fetch(`${riskApiBase}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(predictRequest),
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `risk_api /predict failed: ${response.status} ${details}`,
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const isTransientRiskApiFailure = (error) => {
  if (!error) return true;

  const message = String(error?.message || error || "");
  const code = String(error?.code || error?.cause?.code || "");
  return (
    error?.name === "AbortError" ||
    /ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EPIPE/i.test(
      `${message} ${code}`,
    ) ||
    /fetch failed|network|timeout|socket/i.test(message)
  );
};

const recordRiskApiSuccess = () => {
  riskApiCircuit.failures = 0;
  riskApiCircuit.openUntil = 0;
  riskApiCircuit.lastError = null;
};

const recordRiskApiFailure = (error) => {
  riskApiCircuit.failures += 1;
  riskApiCircuit.lastError =
    error instanceof Error ? error.message : String(error);

  if (riskApiCircuit.failures >= riskApiFailureThreshold) {
    riskApiCircuit.openUntil = Date.now() + riskApiCooldownMs;
  }
};

const scorePipelineWithRetry = async (predictRequest) => {
  if (Date.now() < riskApiCircuit.openUntil) {
    throw new RiskApiUnavailableError("risk_api circuit breaker is open", {
      details: riskApiCircuit.lastError,
    });
  }

  let lastError = null;

  for (let attempt = 0; attempt <= riskApiRetryCount; attempt += 1) {
    try {
      const result = await callRiskApi(predictRequest);
      recordRiskApiSuccess();
      return result;
    } catch (error) {
      lastError = error;
      recordRiskApiFailure(error);

      const shouldRetry =
        attempt < riskApiRetryCount && isTransientRiskApiFailure(error);

      if (shouldRetry) {
        await sleep(riskApiRetryDelayMs * (attempt + 1));
        continue;
      }

      break;
    }
  }

  throw new RiskApiUnavailableError("risk_api failed to score pipeline", {
    details:
      lastError instanceof Error
        ? lastError.message
        : String(lastError || "unknown_failure"),
  });
};

const isLocalRiskApiBase = (baseUrl) => {
  try {
    const url = new URL(baseUrl);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
};

const isRiskApiHealthy = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${riskApiBase}/health`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const waitForRiskApiHealthy = async (timeoutMs, pollMs) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isRiskApiHealthy()) return true;
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }

  return isRiskApiHealthy();
};

const ensureRiskApiReadyForScoring = async (wasColdScoreRequest) => {
  if (await isRiskApiHealthy()) return;

  if (!wasColdScoreRequest) {
    throw new RiskApiUnavailableError("risk_api is not ready", {
      details: "health check failed before scoring",
    });
  }

  console.log(
    `[nrw-ml-backend] cold scoring request detected; waiting up to ${riskApiStartupWaitMs}ms for risk_api`,
  );

  const becameHealthy = await waitForRiskApiHealthy(
    riskApiStartupWaitMs,
    riskApiStartupPollMs,
  );

  if (!becameHealthy) {
    throw new RiskApiUnavailableError("risk_api is still starting", {
      details: `risk_api was not healthy after ${riskApiStartupWaitMs}ms`,
      retryAfterSeconds: 30,
    });
  }
};

const maybeStartRiskApi = async () => {
  if (!autoStartRiskApi) {
    console.log(
      "[nrw-ml-backend] AUTO_START_RISK_API=false, skipping model API startup",
    );
    return;
  }

  if (!isLocalRiskApiBase(riskApiBase)) {
    console.log(
      `[nrw-ml-backend] RISK_API_BASE=${riskApiBase} is not local, skipping auto-start`,
    );
    return;
  }

  if (await isRiskApiHealthy()) {
    console.log("[nrw-ml-backend] risk_api already running");
    return;
  }

  const args = [
    "-m",
    "uvicorn",
    "risk_api.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ];

  riskApiProcess = spawn(riskApiPython, args, {
    cwd: riskApiWorkdir,
    stdio: "inherit",
    env: process.env,
  });

  riskApiProcess.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[nrw-ml-backend] risk_api exited via signal ${signal}`);
      return;
    }
    if (code !== 0) {
      console.error(`[nrw-ml-backend] risk_api exited with code ${code}`);
    }
  });

  console.log(
    `[nrw-ml-backend] started risk_api using ${riskApiPython} -m uvicorn from ${riskApiWorkdir}`,
  );
};

const stopRiskApiIfOwned = () => {
  if (!riskApiProcess || riskApiProcess.killed) return;
  riskApiProcess.kill("SIGTERM");
};

process.on("SIGINT", () => {
  stopRiskApiIfOwned();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopRiskApiIfOwned();
  process.exit(0);
});

process.on("exit", () => {
  stopRiskApiIfOwned();
});

const buildServiceHealth = async () => {
  const riskHealthy = await isRiskApiHealthy();
  return {
    status: riskHealthy ? "ok" : "degraded",
    service: "nrw-ml-backend",
    riskApi: {
      base: riskApiBase,
      healthy: riskHealthy,
      breakerOpen: Date.now() < riskApiCircuit.openUntil,
      consecutiveFailures: riskApiCircuit.failures,
      lastError: riskApiCircuit.lastError,
    },
  };
};

app.get("/health", async (_req, res) => {
  const health = await buildServiceHealth();
  res.status(200).json({
    ...health,
    kind: "liveness",
  });
});

app.get("/ready", async (_req, res) => {
  const health = await buildServiceHealth();
  res.status(health.riskApi.healthy ? 200 : 503).json({
    ...health,
    kind: "readiness",
  });
});

app.post("/api/score-pipeline", async (req, res) => {
  const payload = req.body || {};
  const pipelineId =
    payload.id || payload.pipelineId || payload.pipe_id || payload.pipeId;

  if (!pipelineId) {
    return res.status(400).json({ error: "pipeline id is required" });
  }

  try {
    const now = Date.now();
    const wasColdScoreRequest =
      !lastScoreRequestAt || now - lastScoreRequestAt > riskApiColdIdleMs;
    lastScoreRequestAt = now;

    const predictRequest = buildPredictRequest(payload);
    await ensureRiskApiReadyForScoring(wasColdScoreRequest);

    console.log("[nrw-ml-backend] risk_api request:", predictRequest);
    const riskApiResult = await scorePipelineWithRetry(predictRequest);
    console.log("[nrw-ml-backend] risk_api response:", riskApiResult);

    const riskScore01 = clamp(
      toFiniteNumber(riskApiResult.risk_score, 0),
      0,
      1,
    );
    const confidenceScore01 = clamp(
      toFiniteNumber(riskApiResult.confidence_score, 0),
      0,
      1,
    );
    const riskBand =
      normalizeString(riskApiResult.risk_band) ||
      classifyRiskFromProbability(riskScore01);
    const confidenceBand =
      normalizeString(riskApiResult.confidence_band) || "Low";

    return res.status(200).json({
      pipelineId,
      risk_score: riskScore01,
      confidence_score: confidenceScore01,
      risk_band: riskBand,
      confidence_band: confidenceBand,
      model: normalizeString(riskApiResult.model) || "risk-api",
      processedAt: new Date().toISOString(),
      degraded: Boolean(riskApiResult?.degraded),
      fallbackReason: riskApiResult?.fallbackReason || null,
      // Keep full model output for downstream persistence/debugging.
      otherData: riskApiResult?.other_data || riskApiResult?.otherData || null,
      modelOutput: riskApiResult,
      scoringRequest: predictRequest,

      // Temporary compatibility fields so existing workflow/UI remains stable.
      riskScore: Math.round(riskScore01 * 100),
      riskLevel: riskBand,
      modelVersion: normalizeString(riskApiResult.model) || "risk-api",
    });
  } catch (error) {
    console.error("[nrw-ml-backend] scoring failed:", error);
    const isRiskApiUnavailable = error instanceof RiskApiUnavailableError;
    if (isRiskApiUnavailable) {
      res.set("Retry-After", String(error.retryAfterSeconds));
    }

    return res.status(isRiskApiUnavailable ? 503 : 502).json({
      error: "Failed to score pipeline with risk_api",
      retryable: isRiskApiUnavailable,
      details: error instanceof Error ? error.message : String(error),
      riskApiDetails:
        error instanceof RiskApiUnavailableError ? error.details : null,
    });
  }
});

app.use((err, _req, res, _next) => {
  console.error("[nrw-ml-backend] unhandled request error:", err);
  if (res.headersSent) return;
  return res.status(500).json({
    error: "Internal backend error",
    details: err instanceof Error ? err.message : String(err),
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("[nrw-ml-backend] unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[nrw-ml-backend] uncaught exception:", error);
});

await maybeStartRiskApi();

app.listen(port, () => {
  console.log(`[nrw-ml-backend] listening on http://localhost:${port}`);
});
