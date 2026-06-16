from typing import Optional

from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    # Raw (user-provided) fields
    pipe_id: Optional[str] = Field(None, description="Optional pipe identifier (not used directly for prediction).")
    dma_id: str = Field(..., description="DMA identifier (mapped to a human-readable zone via lookup).")
    install_year: int = Field(..., description="Year installed.")
    material: str = Field(..., description="Pipe material.")
    diameter_mm: float = Field(..., description="Pipe diameter in mm.")
    pipe_length_m: float = Field(..., description="Pipe length in meters.")
    road_category: str = Field(..., description="Road category.")
    elevation_m: float = Field(..., description="Elevation in meters.")
    pressure_bar: float = Field(..., description="Pressure in bar.")
    n_past_repairs: int = Field(..., description="Number of past repairs.")
    soil_type: str = Field(..., description="Soil type.")
    depth_m: float = Field(..., description="Pipe depth in meters.")


class PredictResponse(BaseModel):
    risk_score: float = Field(..., ge=0.0, le=1.0, description="Probability of failure (0–1).")
    confidence_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence derived from calibrated entropy of the predicted probability (0–1).",
    )
    risk_band: str = Field(..., description="Low / Medium / High band derived from risk_score.")
    confidence_band: str = Field(..., description="Low / Medium / High band derived from confidence_score.")
    model: str = Field(..., description="Model identifier used for this prediction.")
