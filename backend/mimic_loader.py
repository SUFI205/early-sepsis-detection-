import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from datetime import timedelta

load_dotenv()

MIMIC_DIR = os.getenv("MIMIC_DATA_DIR")

# Vitals ITEMIDs
VITALS_MAP = {
    'HeartRate': [211, 220045],
    'SysBP': [51, 442, 455, 6701, 220179, 220050],
    'DiasBP': [8368, 8440, 8441, 8555, 220180, 220051],
    'MAP': [456, 52, 6702, 443, 220052, 220181, 225312],
    'RespRate': [618, 615, 220210, 224690],
    'TempC': [676, 223762, 678, 679, 223761],
    'SpO2': [646, 220277],
    'GCS': [198, 454, 223901, 723, 223900, 184, 220739]
}

# Labs ITEMIDs
LABS_MAP = {
    'WBC': [51301, 51300],
    'Lactate': [50813, 52442],
    'Creatinine': [50912],
    'Platelets': [51265],
    'Bilirubin': [50885],
    'Sodium': [50983, 50824],
    'Potassium': [50971, 50822],
    'Bicarbonate': [50882, 50803],
    'Hemoglobin': [51222, 50811],
    'INR': [51237, 50841],
    'PaO2': [50821],
    'pH': [50820, 50831]
}

STATIC_COLS = ['Age', 'Gender', 'ICUType', 'AdmissionType', 'Ethnicity']
VITALS_COLS = list(VITALS_MAP.keys())
LABS_COLS = list(LABS_MAP.keys())
TREND_COLS = ['Delta_HeartRate', 'Delta_SysBP', '6h_Avg_HR', '6h_Max_HR', '6h_Min_HR']

ALL_FEATURES = STATIC_COLS + VITALS_COLS + LABS_COLS + TREND_COLS

def get_available_patients():
    """Returns a list of unique SUBJECT_IDs from ADMISSIONS."""
    if not MIMIC_DIR or not os.path.exists(MIMIC_DIR):
        return []
        
    admissions_path = os.path.join(MIMIC_DIR, "ADMISSIONS.csv")
    if not os.path.exists(admissions_path):
        return []
        
    df = pd.read_csv(admissions_path, usecols=['subject_id'])
    return df['subject_id'].dropna().unique().tolist()

def load_demographics(subject_id: int):
    """Loads demographics: Age, Gender, Ethnicity, Admission Type, ICU Type."""
    demo = {
        'Age': 65.0, # Default mock age
        'Gender': 0.0, # 0 for M, 1 for F
        'ICUType': 0.0, # categorical encoded
        'AdmissionType': 0.0,
        'Ethnicity': 0.0
    }
    
    if not MIMIC_DIR: return demo
    
    try:
        # Load from PATIENTS
        patients_path = os.path.join(MIMIC_DIR, "PATIENTS.csv")
        patient = pd.DataFrame()
        if os.path.exists(patients_path):
            df_p = pd.read_csv(patients_path, usecols=['subject_id', 'gender', 'dob'])
            patient = df_p[df_p['subject_id'] == subject_id]
            if not patient.empty:
                gender = patient.iloc[0].get('gender', 'M')
                demo['Gender'] = 1.0 if gender == 'F' else 0.0
                
        # Load from ADMISSIONS
        admissions_path = os.path.join(MIMIC_DIR, "ADMISSIONS.csv")
        adm = pd.DataFrame()
        if os.path.exists(admissions_path):
            df_a = pd.read_csv(admissions_path, usecols=['subject_id', 'admittime', 'admission_type', 'ethnicity'])
            adm = df_a[df_a['subject_id'] == subject_id]
            if not adm.empty:
                adm = adm.sort_values('admittime').iloc[0]
                adm_type = adm.get('admission_type', 'UNKNOWN')
                demo['AdmissionType'] = 1.0 if pd.notnull(adm_type) and 'EMERGENCY' in str(adm_type).upper() else 0.0
                
                eth = adm.get('ethnicity', 'UNKNOWN')
                demo['Ethnicity'] = 1.0 if pd.notnull(eth) and 'WHITE' in str(eth).upper() else 0.0

                if not patient.empty:
                    dob = pd.to_datetime(patient.iloc[0].get('dob'))
                    admittime = pd.to_datetime(adm.get('admittime'))
                    if pd.notnull(dob) and pd.notnull(admittime):
                        age = (admittime - dob).days / 365.25
                        if age > 150: age = 90.0 # Handle MIMIC-III masked >89 ages
                        if age < 0: age = 0.0
                        demo['Age'] = float(age)

        # Load from ICUSTAYS
        icustays_path = os.path.join(MIMIC_DIR, "ICUSTAYS.csv")
        if os.path.exists(icustays_path):
            df_i = pd.read_csv(icustays_path, usecols=['subject_id', 'intime', 'first_careunit'])
            icu = df_i[df_i['subject_id'] == subject_id]
            if not icu.empty:
                icu_type = icu.sort_values('intime').iloc[0].get('first_careunit', 'MICU')
                demo['ICUType'] = 1.0 if pd.notnull(icu_type) and 'MICU' in str(icu_type).upper() else (2.0 if pd.notnull(icu_type) and 'SICU' in str(icu_type).upper() else 0.0)

    except Exception as e:
        print(f"Error loading demographics for {subject_id}: {e}")
        
    return demo

def load_patient_vitals(subject_id: int):
    """Loads chartevents and labevents, merges them, computes trends and demographics."""
    if not MIMIC_DIR or not os.path.exists(MIMIC_DIR):
        raise ValueError("MIMIC_DATA_DIR is not configured properly.")
        
    chartevents_path = os.path.join(MIMIC_DIR, "CHARTEVENTS.csv")
    if not os.path.exists(chartevents_path):
        raise ValueError("CHARTEVENTS.csv not found.")
        
    # 1. Load Vitals
    iter_csv = pd.read_csv(chartevents_path, iterator=True, chunksize=100000, usecols=['subject_id', 'itemid', 'charttime', 'valuenum'])
    df_vitals_raw = pd.concat([chunk[chunk['subject_id'] == subject_id] for chunk in iter_csv])
    
    vital_id_to_name = {vid: name for name, ids in VITALS_MAP.items() for vid in ids}
    df_vitals = pd.DataFrame()
    if not df_vitals_raw.empty:
        df_vitals = df_vitals_raw[df_vitals_raw['itemid'].isin(vital_id_to_name.keys())].copy()
    
    # 2. Load Labs
    labevents_path = os.path.join(MIMIC_DIR, "LABEVENTS.csv")
    df_labs_raw = pd.DataFrame()
    if os.path.exists(labevents_path):
         iter_lab = pd.read_csv(labevents_path, iterator=True, chunksize=100000, usecols=['subject_id', 'itemid', 'charttime', 'valuenum'])
         df_labs_raw = pd.concat([chunk[chunk['subject_id'] == subject_id] for chunk in iter_lab])
         
    lab_id_to_name = {lid: name for name, ids in LABS_MAP.items() for lid in ids}
    df_labs = pd.DataFrame()
    if not df_labs_raw.empty:
        df_labs = df_labs_raw[df_labs_raw['itemid'].isin(lab_id_to_name.keys())].copy()

    # 3. Combine and Pivot
    if df_vitals.empty and df_labs.empty:
        raise ValueError(f"No relevant data found for patient {subject_id}")
        
    if not df_vitals.empty:
        df_vitals['FeatureName'] = df_vitals['itemid'].map(vital_id_to_name)
    if not df_labs.empty:
        df_labs['FeatureName'] = df_labs['itemid'].map(lab_id_to_name)
        
    df_combined = pd.concat([df_vitals, df_labs], ignore_index=True)
    df_combined['charttime'] = pd.to_datetime(df_combined['charttime'])
    
    # Floor to nearest hour and groupby
    df_combined['Hour'] = df_combined['charttime'].dt.floor('h')
    
    pivot_df = df_combined.groupby(['Hour', 'FeatureName'])['valuenum'].mean().unstack().reset_index()
    pivot_df = pivot_df.sort_values('Hour')
    
    # 4. Ensure all time-series features exist
    for col in VITALS_COLS + LABS_COLS:
        if col not in pivot_df.columns:
            pivot_df[col] = np.nan
            
    # 5. Preprocessing (Imputation & Forward Fill)
    # Forward fill (propagate last observed observation forward) and backward fill
    pivot_df[VITALS_COLS + LABS_COLS] = pivot_df[VITALS_COLS + LABS_COLS].ffill().bfill()
    
    # Fill remaining NaNs with physiological defaults
    defaults = {
        'HeartRate': 80.0, 'SysBP': 120.0, 'DiasBP': 80.0, 'MAP': 90.0, 'RespRate': 16.0, 'TempC': 37.0, 'SpO2': 98.0, 'GCS': 15.0,
        'WBC': 8.0, 'Lactate': 1.5, 'Creatinine': 1.0, 'Platelets': 200.0, 'Bilirubin': 0.5, 'Sodium': 140.0, 'Potassium': 4.0, 'Bicarbonate': 24.0, 'Hemoglobin': 13.0,
        'INR': 1.0, 'PaO2': 90.0, 'pH': 7.4
    }
    
    for col in VITALS_COLS + LABS_COLS:
        pivot_df[col] = pivot_df[col].fillna(defaults.get(col, 0.0))
        
    # 6. Trend-based features
    pivot_df['Delta_HeartRate'] = pivot_df['HeartRate'].diff().fillna(0.0)
    pivot_df['Delta_SysBP'] = pivot_df['SysBP'].diff().fillna(0.0)
    
    # 6-hour rolling windows
    pivot_df['6h_Avg_HR'] = pivot_df['HeartRate'].rolling(window=6, min_periods=1).mean()
    pivot_df['6h_Max_HR'] = pivot_df['HeartRate'].rolling(window=6, min_periods=1).max()
    pivot_df['6h_Min_HR'] = pivot_df['HeartRate'].rolling(window=6, min_periods=1).min()
    
    # 7. Append Demographics
    demo = load_demographics(subject_id)
    for col in STATIC_COLS:
        pivot_df[col] = demo[col]
        
    # 8. Format output
    pivot_df['HourCounter'] = range(1, len(pivot_df) + 1)
    
    final_cols = ['HourCounter'] + ALL_FEATURES
    for c in final_cols:
        if c not in pivot_df.columns:
             pivot_df[c] = 0.0
             
    result_df = pivot_df[final_cols].rename(columns={'HourCounter': 'Hour'})
    return result_df
