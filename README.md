# 🏥 Early Sepsis Detection AI Dashboard

An advanced, full-stack clinical decision support system designed to predict Sepsis risk using time-series physiological data, deep learning, and explainable AI (XAI).

## 🌟 Key Features
*   **Deep Learning Engine**: Utilizes an LSTM temporal model built in PyTorch to analyze rolling 6-hour windows of patient vitals (Heart Rate, Blood Pressure, SpO2, etc.) to predict Sepsis onset up to 6 hours before clinical manifestation.
*   **Explainable AI (SHAP)**: Fully transparent prediction breakdowns. Clinicians can see exactly *which* vitals are driving the risk score up or down, mitigating "black box" hesitation.
*   **Live ICU Streaming**: Simulates real-time hospital bed monitoring via native WebSockets. The React dashboard dynamically renders arriving rows of data, simulating a live EHR environment.
*   **Treatment Simulator**: A "What-If" engine that allows doctors to input hypothetical adjustments (e.g. +15 SysBP via fluids) and immediately see the projected drop in Sepsis risk alongside the adjusted SHAP reasoning.
*   **Automated EMR Generation**: Integrates HuggingFace LLMs to instantly translate the complex mathematical tensor outputs into human-readable medical chart notes. 
*   **Exportable Records**: 1-click generation of fully formatted PDF medical reports.

## 🛠️ Technology Stack
*   **Backend**: Python, FastAPI, PyTorch, SHAP, LangChain, WebSockets, Pandas.
*   **Frontend**: React, Vite, Tailwind CSS, Recharts, jsPDF.

## 🚀 How to Run Locally

### 1. Quick Start
Use the included root script to run both servers concurrently:
```bash
npm run dev
```
*The dashboard will automatically open at `http://localhost:5173/`*

### 2. Manual Start
**Run Backend:**
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

**Run Frontend:**
```bash
cd frontend
npm install
npx vite
```
