import torch
import torch.nn as nn
import pandas as pd
import numpy as np

from mimic_loader import ALL_FEATURES

class SepsisLSTM(nn.Module):
    def __init__(self, input_size, hidden_size, num_layers, output_size):
        super(SepsisLSTM, self).__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True)
        self.fc_risk = nn.Linear(hidden_size, output_size)
        self.fc_time = nn.Linear(hidden_size, 1)
        
    def forward(self, x):
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        out, _ = self.lstm(x, (h0, c0))
        out = out[:, -1, :]
        risk = torch.sigmoid(self.fc_risk(out))
        time_to_onset = torch.relu(self.fc_time(out)) # hours
        return risk, time_to_onset

def load_pretrained_model():
    # Model now expects 25 features instead of 6
    model = SepsisLSTM(input_size=len(ALL_FEATURES), hidden_size=64, num_layers=2, output_size=1)
    model.eval()
    return model

def preprocess_vitals(df: pd.DataFrame):
    expected_cols = ALL_FEATURES
    
    for col in expected_cols:
        if col not in df.columns:
            df[col] = 0.0
            
    # For safety, limit to last 48 time steps if longer (changed from 24 to 48 for research grade)
    df = df.tail(48)
    
    data = df[expected_cols].astype(float).values
    
    # Generic normalization for the prototype to prevent exploding gradients
    # In production, this should use a fitted StandardScaler
    means = np.mean(data, axis=0)
    stds = np.std(data, axis=0) + 1e-6 # prevent division by zero
    
    data = (data - means) / stds
    
    # Return shape (1, seq_len, input_size)
    tensor_data = torch.FloatTensor(data).unsqueeze(0)
    return tensor_data, expected_cols
