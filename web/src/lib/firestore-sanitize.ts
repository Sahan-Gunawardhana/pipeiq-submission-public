/**
 * Sanitize & normalize Firestore payloads before write.
 * Removes old field names, enforces canonical structure, and logs what's being discarded.
 */

interface SanitizedPipeline {
  id: string;
  startLocation: string;
  endLocation: string;
  material: string;
  diameter: number;
  age: number;
  installationYear: number;
  riskScore: number;
  riskBand: string;
  confidenceBand: string;
  confidence?: number;
  predictionStatus: string;
  status: string;
  repair_history: any[];
  repairs?: number;
  zoneId: string;
  geometry: { type: string; coordinates: any };
  elevation_m?: number;
  pressure_bar?: number;
  depth_m?: number;
  road_category?: string;
  soil_type?: string;
  createdAt: string;
  updatedAt: string;
  source?: string;
}

interface SanitizedZone {
  id: string;
  zoneName: string;
  type: string;
  priority: string;
  pipeCount?: number;
  assetCount?: number;
  avgAge?: number;
  avgRisk?: number;
  nrwPercent?: number;
  highRiskPipes?: number;
  geometry: { type: string; coordinates: any };
  color?: string;
  createdAt: string;
  updatedAt: string;
}

interface SanitizedMarker {
  id: string;
  markerId: string;
  type: string;
  location: string;
  zone: string;
  severity: string;
  status: string;
  lastService?: string;
  geometry: { type: string; coordinates: [number, number] };
  createdAt: string;
  updatedAt: string;
}

/**
 * Normalize a single number value, accepting multiple field name variants.
 */
const normalizeNumber = (
  source: Record<string, any>,
  fieldNames: string[],
  fallback?: number
): number | undefined => {
  for (const name of fieldNames) {
    const value = source[name];
    if (Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return fallback;
};

/**
 * Normalize a single string value, accepting multiple field name variants.
 */
const normalizeString = (
  source: Record<string, any>,
  fieldNames: string[],
  fallback = ""
): string => {
  for (const name of fieldNames) {
    const value = source[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
};

/**
 * Sanitize a pipeline document for storage.
 * Canonical fields only, old field names discarded.
 */
export const sanitizePipeline = (raw: any): SanitizedPipeline => {
  const discarded: string[] = [];

  const canonical: SanitizedPipeline = {
    id: normalizeString(
      raw,
      ["id", "pipelineId", "pipe_id", "pipeId"],
      `PL-${Date.now()}`
    ),
    startLocation: normalizeString(raw, [
      "startLocation",
      "startPoint",
      "start",
    ]),
    endLocation: normalizeString(raw, ["endLocation", "endPoint", "end"]),
    material: normalizeString(raw, ["material"], "Unknown"),
    diameter: normalizeNumber(raw, ["diameter", "diameter_mm"]) ?? 100,
    age: normalizeNumber(raw, ["age"]) ?? 0,
    installationYear: normalizeNumber(
      raw,
      ["installationYear", "install_year"],
      2010
    )!,
    riskScore: normalizeNumber(raw, ["riskScore", "risk_score"], 0) ?? 0,
    riskBand: normalizeString(
      raw,
      ["riskBand", "risk_band", "riskLevel"],
      "Low"
    ),
    confidenceBand: normalizeString(
      raw,
      ["confidenceBand", "confidence_band"],
      "Low"
    ),
    confidence: normalizeNumber(raw, ["confidence", "confidence_score"]),
    predictionStatus:
      raw.predictionStatus === "pending" ? "pending" : "complete",
    status: normalizeString(
      raw,
      ["status"],
      raw.predictionStatus === "pending" ? "Under Maintenance" : "Active"
    ),
    repair_history: Array.isArray(raw.repair_history) ? raw.repair_history : [],
    repairs: normalizeNumber(raw, ["repairs", "pastRepairs", "n_past_repairs"]),
    zoneId: normalizeString(raw, ["zoneId", "zone", "dma_id", "dmaId"]),
    geometry: raw.geometry ?? null,
    elevation_m: normalizeNumber(raw, ["elevation_m", "elevation", "elevationM"]),
    pressure_bar: normalizeNumber(raw, ["pressure_bar", "operatingPressure"]),
    depth_m: normalizeNumber(raw, ["depth_m", "depth", "depthM"]),
    road_category: normalizeString(raw, ["road_category", "roadCategory"]),
    soil_type: normalizeString(raw, ["soil_type", "soilType"]),
    createdAt: normalizeString(raw, ["createdAt"], new Date().toISOString()),
    updatedAt: new Date().toISOString(),
    source: raw.source ?? "unknown",
  };

  // Track discarded fields
  const allowedKeys = new Set(Object.keys(canonical));
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      discarded.push(key);
    }
  }

  if (discarded.length > 0) {
    console.log(
      `[Firestore] Pipeline ${canonical.id} sanitized; discarded: ${discarded.join(", ")}`
    );
  }

  return canonical;
};

/**
 * Sanitize a zone document for storage.
 */
export const sanitizeZone = (raw: any): SanitizedZone => {
  const discarded: string[] = [];

  const canonical: SanitizedZone = {
    id: normalizeString(raw, ["id"], `ZN-${Date.now()}`),
    zoneName: normalizeString(raw, ["zoneName", "name", "areaName"]),
    type: normalizeString(raw, ["type", "areaType"], "Zone"),
    priority: normalizeString(raw, ["priority"], "Medium"),
    pipeCount: normalizeNumber(raw, ["pipeCount", "ownedPipelineCount"]),
    assetCount: normalizeNumber(raw, ["assetCount", "ownedAssetCount"]),
    avgAge: normalizeNumber(raw, ["avgAge"]),
    avgRisk: normalizeNumber(raw, ["avgRisk", "zoneRiskScore"]),
    nrwPercent: normalizeNumber(raw, ["nrwPercent"]),
    highRiskPipes: normalizeNumber(raw, ["highRiskPipes"]),
    geometry: raw.geometry ?? null,
    color: normalizeString(raw, ["color", "strokeColor"]),
    createdAt: normalizeString(raw, ["createdAt"], new Date().toISOString()),
    updatedAt: new Date().toISOString(),
  };

  const allowedKeys = new Set(Object.keys(canonical));
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      discarded.push(key);
    }
  }

  if (discarded.length > 0) {
    console.log(
      `[Firestore] Zone ${canonical.id} sanitized; discarded: ${discarded.join(", ")}`
    );
  }

  return canonical;
};

/**
 * Sanitize a marker (asset) document for storage.
 */
export const sanitizeMarker = (raw: any): SanitizedMarker => {
  const discarded: string[] = [];

  const canonical: SanitizedMarker = {
    id: normalizeString(raw, ["id"], `MK-${Date.now()}`),
    markerId: normalizeString(raw, ["markerId", "id"]),
    type: normalizeString(raw, ["type"], "Marker"),
    location: normalizeString(raw, ["location", "address"]),
    zone: normalizeString(raw, ["zone", "zoneId"], "Unassigned"),
    severity: normalizeString(
      raw,
      ["severity", "priority", "riskLevel"],
      "Medium"
    ),
    status: normalizeString(raw, ["status", "condition"], "Active"),
    lastService: normalizeString(raw, ["lastService"]),
    geometry: raw.geometry ?? null,
    createdAt: normalizeString(raw, ["createdAt", "created_at", "timestamp"], new Date().toISOString()),
    updatedAt: new Date().toISOString(),
  };

  const allowedKeys = new Set(Object.keys(canonical));
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      discarded.push(key);
    }
  }

  if (discarded.length > 0) {
    console.log(
      `[Firestore] Marker ${canonical.id} sanitized; discarded: ${discarded.join(", ")}`
    );
  }

  return canonical;
};

/**
 * Pretty-print a Firestore document for debugging.
 * Shows only canonical fields in a readable format.
 */
export const prettyPrintDocument = (
  doc: SanitizedPipeline | SanitizedZone | SanitizedMarker
): string => {
  const lines: string[] = [];
  lines.push(`\n${"=".repeat(60)}`);
  lines.push(`Document: ${doc.id}`);
  lines.push(`${"=".repeat(60)}`);

  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      lines.push(`  ${key}: ${JSON.stringify(value, null, 2)}`);
    } else if (Array.isArray(value)) {
      lines.push(`  ${key}: [Array of ${value.length} items]`);
      if (value.length <= 3) {
        for (let i = 0; i < value.length; i++) {
          lines.push(
            `    [${i}]: ${JSON.stringify(value[i], null, 2).substring(0, 100)}`
          );
        }
      }
    } else {
      lines.push(`  ${key}: ${value}`);
    }
  }

  lines.push(`${"=".repeat(60)}\n`);
  return lines.join("\n");
};
