from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect # type: ignore
from fastapi.middleware.cors import CORSMiddleware # type: ignore
from pydantic import BaseModel # type: ignore
import pandas as pd # type: ignore
import io
import os
import asyncio
from typing import List, Dict, Any
from dotenv import load_dotenv # type: ignore

from model import load_pretrained_model, preprocess_vitals # type: ignore
from explain import generate_shap_values, generate_medical_explanation # type: ignore
from mimic_loader import get_available_patients, load_patient_vitals # type: ignore

load_dotenv()

app = FastAPI(title="Early Sepsis Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SimulationRequest(BaseModel):
    subject_id: int | None = None
    historical_data: List[Dict[str, Any]]
    adjustments: Dict[str, float]

# Load mock pre-trained model
sepsis_model = load_pretrained_model()

@app.get("/")
def read_root():
    return {"status": "Sepsis API running"}

@app.post("/predict")
async def predict_sepsis(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed.")
        
    contents = await file.read()
    try:
        df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading CSV: {str(e)}")
    
    # Needs at least 1 row
    if df.empty:
        raise HTTPException(status_code=400, detail="CSV is empty.")
        
    # Preprocess
    input_tensor, feature_names = preprocess_vitals(df)
    
    # Model inference
    risk_tensor, time_tensor = sepsis_model(input_tensor)
    risk = risk_tensor.item()
    time_to_onset = time_tensor.item()
    
    # Output to Frontend
    shap_values = generate_shap_values(sepsis_model, input_tensor, feature_names)
    explanation = generate_medical_explanation(risk, time_to_onset, shap_values)
    
    # For UI charts
    time_series = df.to_dict(orient="records")
    
    return {
        "risk_probability": risk,
        "time_to_onset_hours": max(0.0, time_to_onset),
        "shap_values": shap_values,
        "explanation": explanation,
        "time_series_data": time_series
    }

@app.get("/demo-data")
def get_demo_data():
    """Generates a synthetic patient trajectory reflecting sepsis onset for demo purposes."""
    import numpy as np # type: ignore
    
    hours = np.arange(1, 25)
    # Deteriorating vitals
    hr = np.linspace(80, 125, 24) + np.random.normal(0, 2, 24)
    sys_bp = np.linspace(120, 85, 24) + np.random.normal(0, 3, 24)
    dias_bp = np.linspace(80, 50, 24) + np.random.normal(0, 2, 24)
    temp = np.linspace(37.0, 39.5, 24) + np.random.normal(0, 0.2, 24)
    rr = np.linspace(16, 28, 24) + np.random.normal(0, 1, 24)
    spo2 = np.linspace(98, 92, 24) + np.random.normal(0, 1, 24)
    
    df = pd.DataFrame({
        "Hour": hours,
        "HeartRate": hr,
        "SysBP": sys_bp,
        "DiasBP": dias_bp,
        "TempC": temp,
        "RespRate": rr,
        "SpO2": spo2
    })
    
    csv_str = df.to_csv(index=False)
    return {"csv_data": csv_str}

@app.get("/patients")
def list_patients():
    """Returns a list of available SUBJECT_IDs from the MIMIC-III database."""
    try:
        patients = get_available_patients()
        # Return first 20 for UI simplicity
        return {"patients": patients[:20]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/patient/{subject_id}")
def get_patient_data(subject_id: int):
    """Loads a real patient's trajectory from MIMIC-III and runs the prediction."""
    try:
        df = load_patient_vitals(subject_id)
        if df.empty:
            raise HTTPException(status_code=404, detail="Patient has no readable vitals data.")
            
        # Run prediction
        input_tensor, feature_names = preprocess_vitals(df)
        
        # Model inference
        risk_tensor, time_tensor = sepsis_model(input_tensor)
        risk = risk_tensor.item()
        time_to_onset = time_tensor.item()
        
        # Explainability
        shap_values = generate_shap_values(sepsis_model, input_tensor, feature_names)
        explanation = generate_medical_explanation(risk, time_to_onset, shap_values)
        
        # Time series payload
        time_series = df.to_dict(orient="records")
        
        return {
            "subject_id": subject_id,
            "risk_probability": risk,
            "time_to_onset_hours": max(0.0, time_to_onset),
            "shap_values": shap_values,
            "explanation": explanation,
            "time_series_data": time_series
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/simulate")
async def simulate_treatment(req: SimulationRequest):
    """Simulates the impact of a medical intervention on Sepsis Risk."""
    if not req.historical_data:
        raise HTTPException(status_code=400, detail="No historical data provided.")
    
    try:
        # Load exactly what is shown on the dashboard scrubber
        df = pd.DataFrame(req.historical_data)
        new_df = df.copy()
        
        # Apply the explicit numeric adjustments (deltas) to the latest vital reading
        for feature, delta in req.adjustments.items():
            if feature in new_df.columns:
                new_df.at[new_df.index[-1], feature] += delta
                
        # Run standard inference pipeline
        input_tensor, feature_names = preprocess_vitals(new_df)
        
        risk_tensor, time_tensor = sepsis_model(input_tensor)
        risk = risk_tensor.item()
        time_to_onset = time_tensor.item()
        
        shap_values = generate_shap_values(sepsis_model, input_tensor, feature_names)
        
        return {
            "projected_risk": risk,
            "projected_time_to_onset_hours": max(0.0, time_to_onset),
            "projected_shap": shap_values,
            "adjustments_applied": req.adjustments
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulation error: {str(e)}")

@app.websocket("/ws/stream/{subject_id}")
async def stream_patient_data(websocket: WebSocket, subject_id: int):
    """Streams a patient's trajectory row-by-row to simulate a live ICU bed monitor."""
    await websocket.accept()
    try:
        df = load_patient_vitals(subject_id)
        if df.empty:
            await websocket.send_json({"error": "Patient has no readable vitals data."})
            await websocket.close()
            return

        # Loop through data to simulate streaming
        for i in range(1, len(df) + 1):
            current_df = df.iloc[:i]
            
            # Preprocess
            input_tensor, feature_names = preprocess_vitals(current_df)
            
            # Model inference
            risk_tensor, time_tensor = sepsis_model(input_tensor)
            risk = risk_tensor.item()
            time_to_onset = time_tensor.item()
            
            # Explainability (SHAP)
            shap_values = generate_shap_values(sepsis_model, input_tensor, feature_names)
            
            # Time series payload
            time_series = current_df.to_dict(orient="records")
            
            payload = {
                "subject_id": subject_id,
                "risk_probability": risk,
                "time_to_onset_hours": max(0.0, time_to_onset),
                "shap_values": shap_values,
                "explanation": "Live monitor active. LLM chart note generation is paused during real-time streaming to minimize latency.",
                "time_series_data": time_series,
                "is_streaming": True,
                "stream_complete": i == len(df)
            }
            
            await websocket.send_json(payload)
            
            # Sleep to simulate real-time ticking (e.g., 2 seconds per hour of data)
            if i < len(df):
                await asyncio.sleep(2)
            
        await websocket.close()
    except WebSocketDisconnect:
        print(f"Client disconnected from stream for patient {subject_id}")
    except Exception as e:
        print(f"WebSocket error: {str(e)}")
        # Check if the connection is still active before trying to close it
        try:
            await websocket.close()
        except:
            pass


