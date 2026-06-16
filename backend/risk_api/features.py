import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Tuple

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class FeatureThresholds:
    asof_year: int
    pipe_length_cap_value: float
    pressure_clip_low: float
    pressure_clip_high: float
    old_age_years: float
    high_pressure_threshold: float
    diameter_q33: float
    diameter_q66: float

    @staticmethod
    def load(path: Path) -> "FeatureThresholds":
        obj = json.loads(path.read_text(encoding="utf-8"))
        return FeatureThresholds(
            asof_year=int(obj["asof_year"]),
            pipe_length_cap_value=float(obj["pipe_length_cap_value"]),
            pressure_clip_low=float(obj["pressure_clip_low"]),
            pressure_clip_high=float(obj["pressure_clip_high"]),
            old_age_years=float(obj["old_age_years"]),
            high_pressure_threshold=float(obj["high_pressure_threshold"]),
            diameter_q33=float(obj["diameter_q33"]),
            diameter_q66=float(obj["diameter_q66"]),
        )


def _material_group(value: str) -> str:
    v = str(value).strip().lower()
    if not v or v in {"nan", "none", "null"}:
        return "unknown"
    plastic = {"pvc", "pe", "hdpe", "mdpe", "upvc", "plastic", "poly", "polyethylene"}
    metal = {"gi", "galvanized", "steel", "cast", "castiron", "cast_iron", "iron", "ductile", "ductileiron", "copper"}
    if any(tok in v for tok in plastic):
        return "plastic"
    if any(tok in v for tok in metal):
        return "metal"
    return "other"


@lru_cache(maxsize=1)
def _dma_lookup() -> dict:
    path = Path("risk_api/lookups/dma_lookup.json")
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _dma_zone(dma_id: str) -> str:
    lookup = _dma_lookup()
    rec = lookup.get(str(dma_id).strip())
    if isinstance(rec, dict):
        z = str(rec.get("dma_zone_locality", "")).strip()
        if z:
            return z
    return "Unknown"


def build_features(payload: Dict[str, Any], thr: FeatureThresholds) -> pd.DataFrame:
    """
    Build a single-row dataframe matching the v6/v7 feature columns.
    Input is raw user fields; output includes engineered columns.
    """
    df = pd.DataFrame([payload]).copy()

    # Basic numeric coercion
    for c in [
        "install_year",
        "diameter_mm",
        "pipe_length_m",
        "elevation_m",
        "pressure_bar",
        "n_past_repairs",
        "depth_m",
    ]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    # DMA -> zone (human readable)
    if "dma_id" in df.columns:
        df["dma_zone"] = df["dma_id"].astype(str).map(_dma_zone)

    # 1) Preprocessing-style guards (same spirit as v3.2)
    install_year_invalid = (df["install_year"].isna()) | (df["install_year"] < 1900) | (df["install_year"] > thr.asof_year)
    df["install_year_was_invalid"] = install_year_invalid.astype(int)
    # For API: if invalid, clamp to median-ish safe year (use asof_year - 10) rather than sampling.
    df.loc[install_year_invalid, "install_year"] = int(thr.asof_year - 10)
    df["install_year"] = df["install_year"].astype(int)

    # Recompute age
    df["pipe_age_years"] = (thr.asof_year - df["install_year"]).astype(float)

    # Cap/clip outliers using stored training thresholds
    if "pipe_length_m" in df.columns:
        df["pipe_length_m"] = df["pipe_length_m"].clip(upper=float(thr.pipe_length_cap_value))
    if "pressure_bar" in df.columns:
        df["pressure_bar"] = df["pressure_bar"].clip(lower=float(thr.pressure_clip_low), upper=float(thr.pressure_clip_high))

    # 2) v6-style engineered features
    df["material_group"] = df["material"].map(_material_group) if "material" in df.columns else "unknown"

    # Interactions
    df["repair_rate"] = df["n_past_repairs"].fillna(0) / (df["pipe_age_years"].fillna(0) + 1.0)
    df["pressure_age"] = df["pressure_bar"] * df["pipe_age_years"]
    df["length_pressure"] = df["pressure_bar"] * df["pipe_length_m"]
    df["elevation_pressure"] = df["pressure_bar"] * df["elevation_m"]
    df["depth_pressure"] = df["pressure_bar"] * df["depth_m"]

    # Flags/bins
    df["is_old_pipe"] = (df["pipe_age_years"] >= float(thr.old_age_years)).astype(int)
    df["high_pressure"] = (df["pressure_bar"] >= float(thr.high_pressure_threshold)).astype(int)

    # Diameter bin using stored quantiles
    d = df["diameter_mm"]
    q33, q66 = float(thr.diameter_q33), float(thr.diameter_q66)
    df["diameter_bin"] = pd.cut(
        d,
        bins=[-np.inf, q33, q66, np.inf],
        labels=["small", "medium", "large"],
        include_lowest=True,
    ).astype(str)

    return df
