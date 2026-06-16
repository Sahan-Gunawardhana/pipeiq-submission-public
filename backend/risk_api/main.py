from fastapi import FastAPI, HTTPException

from risk_api.model import load_model, predict
from risk_api.schemas import PredictRequest, PredictResponse


app = FastAPI(title="Pipeline Failure Risk API", version="1.0")


try:
    LOADED = load_model()
except Exception as e:
    LOADED = None
    LOAD_ERROR = str(e)


@app.get("/health")
def health():
    if LOADED is None:
        return {"status": "error", "detail": LOAD_ERROR}
    return {"status": "ok", "model": LOADED.metadata.get("model_name", "xgb_v7_calibrated")}


@app.post("/predict", response_model=PredictResponse)
def predict_endpoint(req: PredictRequest):
    if LOADED is None:
        raise HTTPException(status_code=500, detail=LOAD_ERROR)
    risk, conf, risk_band, confidence_band = predict(req.model_dump(), LOADED)
    return PredictResponse(
        risk_score=risk,
        confidence_score=conf,
        risk_band=risk_band,
        confidence_band=confidence_band,
        model=LOADED.metadata.get("model_name", "xgb_v7_calibrated"),
    )
