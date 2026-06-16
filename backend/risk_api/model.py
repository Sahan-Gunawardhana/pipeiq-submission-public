import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Tuple

import numpy as np
import pandas as pd

from risk_api.features import FeatureThresholds, build_features


ARTIFACT_DIR = Path("risk_api/artifacts")
MODEL_PATH = ARTIFACT_DIR / "xgb_v7_calibrated.joblib"
THRESHOLDS_PATH = ARTIFACT_DIR / "feature_thresholds.json"
METADATA_PATH = ARTIFACT_DIR / "metadata.json"


@dataclass(frozen=True)
class LoadedModel:
    model: Any
    thresholds: FeatureThresholds
    metadata: Dict[str, Any]


def _load_joblib(path: Path):
    import joblib  # imported lazily so the module can be imported without deps installed

    _patch_sklearn_runtime()

    # Compatibility shim:
    # Some older scikit-learn artifacts reference a private class
    # `sklearn.compose._column_transformer._RemainderColsList` that may not
    # exist in newer versions. Define a compatible fallback so joblib can load.
    try:
        import sklearn.compose._column_transformer as _ct  # type: ignore

        if not hasattr(_ct, "_RemainderColsList"):
            class _RemainderColsList(list):
                pass

            _ct._RemainderColsList = _RemainderColsList  # type: ignore[attr-defined]
    except Exception:
        # If sklearn internals are unavailable, let normal loading errors surface.
        pass

    model = joblib.load(path)
    _patch_loaded_estimators(model)
    return model


def _patch_sklearn_runtime() -> None:
    try:
        from sklearn.impute import SimpleImputer
    except Exception:
        return

    if getattr(SimpleImputer, "_pipeiq_transform_patched", False):
        return

    original_transform = SimpleImputer.transform

    def transform(self, X):
        if not hasattr(self, "_fill_dtype"):
            self._fill_dtype = getattr(self, "_fit_dtype", None)
        return original_transform(self, X)

    SimpleImputer.transform = transform
    SimpleImputer._pipeiq_transform_patched = True


def _patch_loaded_estimators(root: Any) -> None:
    seen: set[int] = set()

    def visit(obj: Any) -> None:
        if obj is None:
            return
        if isinstance(obj, (str, bytes, int, float, bool)):
            return
        obj_id = id(obj)
        if obj_id in seen:
            return
        seen.add(obj_id)

        if obj.__class__.__name__ == "SimpleImputer" and not hasattr(obj, "_fill_dtype"):
            obj._fill_dtype = getattr(obj, "_fit_dtype", None)

        if hasattr(obj, "get_params"):
            try:
                for value in obj.get_params(deep=True).values():
                    visit(value)
            except Exception:
                pass

        for value in list(getattr(obj, "__dict__", {}).values()):
            if isinstance(value, dict):
                for item in list(value.values()):
                    visit(item)
            elif isinstance(value, (list, tuple, set)):
                for item in list(value):
                    visit(item)
            else:
                visit(value)

    visit(root)


def load_model() -> LoadedModel:
    if not MODEL_PATH.exists():
        raise RuntimeError(f"Missing model artifact: {MODEL_PATH}. Train it via scripts/train_xgb_v7_for_api.py")
    if not THRESHOLDS_PATH.exists():
        raise RuntimeError(f"Missing thresholds artifact: {THRESHOLDS_PATH}. Train it via scripts/train_xgb_v7_for_api.py")
    md = json.loads(METADATA_PATH.read_text(encoding="utf-8")) if METADATA_PATH.exists() else {}
    return LoadedModel(
        model=_load_joblib(MODEL_PATH),
        thresholds=FeatureThresholds.load(THRESHOLDS_PATH),
        metadata=md,
    )


def predict(payload: Dict[str, Any], loaded: LoadedModel) -> Tuple[float, float, str, str]:
    """
    Returns: (risk_score, confidence_score, risk_band)
    - risk_score: P(failed=1)
    - confidence_score: distance-from-0.5 proxy in [0,1]
    """
    X = build_features(payload, loaded.thresholds)
    _patch_loaded_estimators(loaded.model)
    proba = float(loaded.model.predict_proba(X)[:, 1][0])
    proba = max(0.0, min(1.0, proba))

    # Confidence (calibrated entropy):
    # - entropy is highest at p=0.5 (most uncertain) and lowest at p=0/1 (most certain).
    # - normalize by log(2) so entropy is in [0,1], then flip so confidence is in [0,1].
    eps = 1e-12
    p = min(1.0 - eps, max(eps, proba))
    entropy = -p * float(np.log(p)) - (1.0 - p) * float(np.log(1.0 - p))
    entropy_norm = float(entropy / float(np.log(2.0)))
    confidence = float(1.0 - max(0.0, min(1.0, entropy_norm)))

    # Risk band thresholds (thesis-aligned):
    # - 0.27 ≈ "optimal operating point" from threshold sweep (max/near-max F1).
    # - 0.50 = "high risk" label (probability tipping point after calibration).
    if proba < 0.27:
        risk_band = "Low"
    elif proba < 0.50:
        risk_band = "Medium"
    else:
        risk_band = "High"

    # Confidence band thresholds (entropy-based):
    # - p≈0.5 => confidence≈0 (maximum uncertainty)
    # - p→0/1 => confidence→1 (maximum certainty)
    # We keep "High confidence" reachable in this domain by using a slightly lower cutoff.
    if confidence < 0.20:
        confidence_band = "Low"
    elif confidence < 0.50:
        confidence_band = "Medium"
    else:
        confidence_band = "High"

    return proba, confidence, risk_band, confidence_band
