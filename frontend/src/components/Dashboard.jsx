import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { UploadCloud, AlertTriangle, Clock, Activity, BrainCircuit, Users, HeartPulse, Thermometer, Droplets, Stethoscope, TrendingUp, TrendingDown, Info, X, Download } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';

const API_BASE_URL = 'http://localhost:8000';

export default function Dashboard() {
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [patients, setPatients] = useState([]);
    const [selectedPatient, setSelectedPatient] = useState('');
    const [activeTab, setActiveTab] = useState('overview');
    const [showRiskModal, setShowRiskModal] = useState(false);
    const [showSimulationModal, setShowSimulationModal] = useState(false);
    const [simAdjustments, setSimAdjustments] = useState({ SysBP: 0, HeartRate: 0, TempC: 0, RespRate: 0, SpO2: 0 });
    const [simResult, setSimResult] = useState(null);
    const [isSimulating, setIsSimulating] = useState(false);

    const [timelineIndex, setTimelineIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLive, setIsLive] = useState(false);
    const wsRef = useRef(null);

    // Derived strictly from the timeline scrubber
    const slicedData = result?.time_series_data ? result.time_series_data.slice(0, timelineIndex + 1) : [];
    // Recalculate generic risk based on current HR/BP if we drop back in time (Simulation)
    const currentRiskProxy = slicedData.length > 0 ?
        Math.max(0.1, result?.risk_probability - ((result?.time_series_data.length - slicedData.length) * 0.05)) : 0;


    const [isExporting, setIsExporting] = useState(false);

    const generatePDF = async () => {
        if (!result) return;
        setIsExporting(true);
        try {
            const input = document.getElementById('dashboard-content');
            if (input) {
                const width = input.offsetWidth;
                const height = input.offsetHeight;

                const imgData = await toPng(input, {
                    pixelRatio: 2, // Higher resolution
                    backgroundColor: '#020617', // Match Slate 950
                });

                const pdf = new jsPDF({
                    orientation: width > height ? 'landscape' : 'portrait',
                    unit: 'px',
                    format: [width, height]
                });
                pdf.addImage(imgData, 'PNG', 0, 0, width, height);
                pdf.save(`Sepsis_Report_Patient_${selectedPatient || 'External'}.pdf`);
            }
        } catch (err) {
            console.error("Failed to generate PDF", err);
            setError(`Failed to generate PDF report: ${err.message || err.toString()}`);
        } finally {
            setIsExporting(false);
        }
    };

    useEffect(() => {
        let interval;
        if (isPlaying && result && timelineIndex < result.time_series_data.length - 1) {
            interval = setInterval(() => {
                setTimelineIndex(prev => {
                    if (prev >= result.time_series_data.length - 2) setIsPlaying(false);
                    return prev + 1;
                });
            }, 800);
        } else if (timelineIndex >= (result?.time_series_data?.length || 0) - 1) {
            setIsPlaying(false);
        }
        return () => clearInterval(interval);
    }, [isPlaying, timelineIndex, result]);

    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    const startLiveStream = () => {
        if (!selectedPatient) {
            setError("Please select a patient first to start the live ICU stream.");
            return;
        }
        setLoading(true);
        setError(null);
        setResult(null); 
        setTimelineIndex(0);
        setIsLive(true);
        
        const wsUrl = `ws://localhost:8000/ws/stream/${selectedPatient}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        
        ws.onopen = () => {
            setLoading(false);
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.error) {
                setError(data.error);
                ws.close();
                return;
            }
            
            setResult(data);
            setTimelineIndex(data.time_series_data.length - 1);
            
            if (data.stream_complete) {
                setIsLive(false);
                ws.close();
            }
        };
        
        ws.onerror = (err) => {
            console.error("WebSocket error:", err);
            setError("Lost connection to live ICU stream.");
            setIsLive(false);
        };
        
        ws.onclose = () => {
            setIsLive(false);
        };
    };

    const stopLiveStream = () => {
        if (wsRef.current) {
            wsRef.current.close();
        }
        setIsLive(false);
    };

    const runSimulation = async () => {
        setIsSimulating(true);
        try {
            const adjustments = {};
            for (const [k, v] of Object.entries(simAdjustments)) {
                if (parseFloat(v) !== 0) {
                    adjustments[k] = parseFloat(v);
                }
            }
            
            const reqData = {
                subject_id: selectedPatient ? parseInt(selectedPatient) : null,
                historical_data: slicedData,
                adjustments: adjustments
            };
            
            const res = await axios.post(`${API_BASE_URL}/simulate`, reqData);
            setSimResult(res.data);
        } catch (err) {
            console.error("Simulation failed", err);
            alert("Failed to run simulation. Please make sure the vital is valid.");
        } finally {
            setIsSimulating(false);
        }
    };

    const resetSimulation = () => {
        setSimAdjustments({ SysBP: 0, HeartRate: 0, TempC: 0, RespRate: 0, SpO2: 0 });
        setSimResult(null);
    };

    const getTrend = (key) => {
        if (!slicedData || slicedData.length < 2) return null;
        const current = slicedData[slicedData.length - 1][key];
        const previous = slicedData[slicedData.length - 2][key];
        const diff = current - previous;
        return { val: diff, isUp: diff > 0 };
    };

    useEffect(() => {
        // Fetch available MIMIC-III patients on load
        axios.get(`${API_BASE_URL}/patients`)
            .then(res => setPatients(res.data.patients || []))
            .catch(err => console.error("Could not load patients list:", err));
    }, []);

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        setLoading(true);
        setError(null);
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await axios.post(`${API_BASE_URL}/predict`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setResult(res.data);
            setTimelineIndex(res.data.time_series_data.length - 1);
        } catch (err) {
            setError(err.response?.data?.detail || err.message);
        } finally {
            setLoading(false);
        }
    };

    const loadDemoData = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await axios.get(`${API_BASE_URL}/demo-data`);
            const csvStr = res.data.csv_data;
            const blob = new Blob([csvStr], { type: 'text/csv' });
            const demoFile = new File([blob], 'demo_patient.csv', { type: 'text/csv' });
            setFile(demoFile);

            const formData = new FormData();
            formData.append('file', demoFile);
            const predictRes = await axios.post(`${API_BASE_URL}/predict`, formData);
            setResult(predictRes.data);
        } catch (err) {
            setError('Failed to load demo data: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const loadPatientData = async (subjectId) => {
        if (!subjectId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await axios.get(`${API_BASE_URL}/patient/${subjectId}`);
            setResult(res.data);
            setTimelineIndex(res.data.time_series_data.length - 1);
        } catch (err) {
            setError('Failed to load patient data: ' + (err.response?.data?.detail || err.message));
        } finally {
            setLoading(false);
        }
    };

    const handlePatientSelect = (e) => {
        const val = e.target.value;
        setSelectedPatient(val);
        if (val) {
            loadPatientData(val);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 p-8 font-sans">
            <div className="max-w-7xl mx-auto space-y-8">
                <header className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3 drop-shadow-sm">
                            <Activity className="text-indigo-400" size={32} />
                            Early Sepsis Detection AI
                        </h1>
                        <p className="text-slate-400 mt-1">Upload patient vitals to predict sepsis risk and time-to-onset</p>
                    </div>
                </header>

                {/* Upload & Select Section */}
                <div className="bg-slate-900/60 p-5 rounded-xl shadow-lg border border-slate-800/80 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center backdrop-blur-md">

                    {/* MIMIC-III Patient Select */}
                    <div className="lg:col-span-4">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <Users size={14} className="text-indigo-400" />
                            Load Clinical Record (MIMIC-III)
                        </label>
                        <div className="relative">
                            <select
                                value={selectedPatient}
                                onChange={handlePatientSelect}
                                disabled={loading || patients.length === 0}
                                className="block w-full rounded-lg border-slate-700 shadow-sm bg-slate-800/80 text-slate-200 py-2.5 px-4 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 hover:bg-slate-700 transition-colors font-medium border cursor-pointer"
                            >
                                <option value="">-- Search Patient Registry --</option>
                                {patients.map(p => (
                                    <option key={p} value={p}>Subject #{p}</option>
                                ))}
                            </select>
                            {patients.length === 0 && (
                                <p className="text-xs text-amber-500 mt-1.5 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping"></span>
                                    Connecting to local MIMIC-III DB...
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="hidden lg:block lg:col-span-1 flex justify-center">
                        <div className="w-px h-12 bg-slate-700 mx-auto"></div>
                    </div>

                    {/* File Upload Area */}
                    <div className="lg:col-span-7 flex flex-wrap items-end gap-3">
                        <div className="flex-1 min-w-[200px]">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Upload External Vitals (CSV)</label>
                            <input
                                type="file"
                                accept=".csv"
                                onChange={handleFileChange}
                                className="block w-full text-sm text-slate-400
                        file:mr-3 file:py-2 file:px-4
                        file:rounded-md file:border-0
                        file:text-sm file:font-semibold
                        file:bg-indigo-500/20 file:text-indigo-400
                        hover:file:bg-indigo-500/30 transition-all cursor-pointer border border-slate-700 bg-slate-800/50 rounded-lg p-1"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={handleUpload}
                                disabled={!file || loading}
                                className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-indigo-500 disabled:opacity-50 transition-all shadow-md h-[42px]"
                            >
                                {loading ? <span className="animate-spin text-xl">↻</span> : <UploadCloud size={18} />}
                                Analyze
                            </button>

                            {result && (
                                <button
                                    onClick={generatePDF}
                                    disabled={isExporting}
                                    className="flex items-center gap-2 bg-slate-800 border border-slate-600 hover:bg-slate-700 text-slate-200 font-bold px-4 py-2.5 rounded-lg shadow transition-all h-[42px]"
                                    title="Export Record to PDF"
                                >
                                    {isExporting ? <span className="animate-spin text-xl">↻</span> : <Download size={18} />}
                                    Export EMR
                                </button>
                            )}
                            
                            {isLive ? (
                                <button
                                    onClick={stopLiveStream}
                                    className="flex items-center gap-2 bg-rose-600 border border-rose-500 hover:bg-rose-500 text-white font-bold px-4 py-2.5 rounded-lg shadow transition-all h-[42px] animate-pulse whitespace-nowrap"
                                >
                                    <Activity size={18} /> Stop Stream
                                </button>
                            ) : (
                                <button
                                    onClick={startLiveStream}
                                    disabled={loading || !selectedPatient}
                                    className="flex items-center gap-2 bg-emerald-600/20 border border-emerald-500 hover:bg-emerald-600 text-emerald-400 hover:text-white font-bold px-4 py-2.5 rounded-lg shadow transition-all h-[42px] whitespace-nowrap"
                                    title="Connect to Real-Time Vitals Feed"
                                >
                                    <HeartPulse size={18} /> Live Stream
                                </button>
                            )}

                            <button
                                onClick={loadDemoData}
                                disabled={loading}
                                className="bg-slate-800 border border-slate-700 text-slate-300 hover:text-indigo-400 font-semibold px-4 py-2.5 hover:bg-slate-700 rounded-lg transition-all h-[42px] shadow-md whitespace-nowrap"
                            >
                                Run Sandbox Test
                            </button>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl flex items-center gap-3 shadow-sm">
                        <AlertTriangle /> {error}
                    </div>
                )}

                {/* Results Section */}
                {result && (
                    <div id="dashboard-content" className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out space-y-6 bg-slate-950 p-2 -m-2 rounded-xl">

                        {/* KPI Metrics Row */}
                        {/* KPI Metrics Row */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {/* Heart Rate */}
                            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-md flex flex-col gap-2 relative">
                                {slicedData[slicedData.length - 1]?.HeartRate > 100 && (
                                    <span className="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md animate-pulse">Tachycardia</span>
                                )}
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/20">
                                        <HeartPulse size={24} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-400 uppercase">Heart Rate</p>
                                        <div className="flex items-baseline gap-2">
                                            <p className="text-2xl font-black text-white">{slicedData[slicedData.length - 1]?.HeartRate.toFixed(1) || "--"}</p>
                                            {getTrend('HeartRate') && (
                                                <span className={`flex items-center text-[10px] font-bold ${getTrend('HeartRate').isUp ? 'text-rose-400' : 'text-emerald-400'}`}>
                                                    {getTrend('HeartRate').isUp ? <TrendingUp size={12} className="mr-0.5" /> : <TrendingDown size={12} className="mr-0.5" />}
                                                    {Math.abs(getTrend('HeartRate').val).toFixed(1)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Systolic BP */}
                            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-md flex flex-col gap-2 relative">
                                {slicedData[slicedData.length - 1]?.SysBP < 90 && (
                                    <span className="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md animate-pulse">Hypotension</span>
                                )}
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
                                        <Activity size={24} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-400 uppercase">Sys. BP</p>
                                        <div className="flex items-baseline gap-2">
                                            <p className="text-2xl font-black text-white">{slicedData[slicedData.length - 1]?.SysBP.toFixed(1) || "--"}</p>
                                            {getTrend('SysBP') && (
                                                <span className={`flex items-center text-[10px] font-bold ${getTrend('SysBP').isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                    {getTrend('SysBP').isUp ? <TrendingUp size={12} className="mr-0.5" /> : <TrendingDown size={12} className="mr-0.5" />}
                                                    {Math.abs(getTrend('SysBP').val).toFixed(1)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* SpO2 */}
                            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-md flex flex-col gap-2 relative">
                                {slicedData[slicedData.length - 1]?.SpO2 < 92 && (
                                    <span className="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md animate-pulse">Hypoxemia</span>
                                )}
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/20">
                                        <Droplets size={24} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-400 uppercase">SpO2</p>
                                        <div className="flex items-baseline gap-2">
                                            <p className="text-2xl font-black text-white">{slicedData[slicedData.length - 1]?.SpO2.toFixed(1) || "--"}<span className="text-sm text-slate-500 font-medium">%</span></p>
                                            {getTrend('SpO2') && (
                                                <span className={`flex items-center text-[10px] font-bold ${getTrend('SpO2').isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                    {getTrend('SpO2').isUp ? <TrendingUp size={12} className="mr-0.5" /> : <TrendingDown size={12} className="mr-0.5" />}
                                                    {Math.abs(getTrend('SpO2').val).toFixed(1)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Temperature */}
                            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-md flex flex-col gap-2 relative">
                                {slicedData[slicedData.length - 1]?.TempC > 38.0 && (
                                    <span className="absolute -top-2 -right-2 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md animate-pulse">Fever</span>
                                )}
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0 border border-amber-500/20">
                                        <Thermometer size={24} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-400 uppercase">Temperature</p>
                                        <div className="flex items-baseline gap-2">
                                            <p className="text-2xl font-black text-white">{slicedData[slicedData.length - 1]?.TempC.toFixed(1) || "--"}<span className="text-sm text-slate-500 font-medium">°C</span></p>
                                            {getTrend('TempC') && (
                                                <span className={`flex items-center text-[10px] font-bold ${getTrend('TempC').isUp ? 'text-amber-500' : 'text-emerald-400'}`}>
                                                    {getTrend('TempC').isUp ? <TrendingUp size={12} className="mr-0.5" /> : <TrendingDown size={12} className="mr-0.5" />}
                                                    {Math.abs(getTrend('TempC').val).toFixed(1)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Interactive Main Panels */}
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

                            {/* Left Column: Sepsis Risk Profile */}
                            <div className="xl:col-span-1 flex flex-col gap-6">
                                {/* Triage Card */}
                                <div className={`relative overflow-hidden rounded-2xl border p-6 shadow-md transition-all ${currentRiskProxy > 0.7 ? "bg-rose-950/40 border-rose-900" :
                                    currentRiskProxy > 0.4 ? "bg-amber-950/40 border-amber-900" : "bg-slate-900 border-slate-800"
                                    }`}>
                                    <div className="absolute top-0 right-0 p-4 opacity-[0.03]">
                                        <AlertTriangle size={150} />
                                    </div>
                                    <div className="relative z-10">
                                        <h2 className={`text-sm font-bold uppercase tracking-wider mb-6 flex items-center gap-2 ${currentRiskProxy > 0.7 ? "text-rose-500" :
                                            currentRiskProxy > 0.4 ? "text-amber-500" : "text-slate-400"
                                            }`}>
                                            <Stethoscope size={18} />
                                            Sepsis Triage Score
                                        </h2>

                                        <div className="flex flex-col items-center group cursor-pointer" onClick={() => setShowRiskModal(true)}>
                                            {/* Circular Gauge */}
                                            <div className="relative flex items-center justify-center w-48 h-48 rounded-full mb-6 transition-transform group-hover:scale-105">
                                                <svg className="absolute w-full h-full transform -rotate-90">
                                                    <circle cx="96" cy="96" r="88" stroke="currentColor" strokeWidth="12" fill="none"
                                                        className={currentRiskProxy > 0.7 ? "text-rose-950" : currentRiskProxy > 0.4 ? "text-amber-950" : "text-slate-800"} />
                                                    <circle cx="96" cy="96" r="88" stroke="currentColor" strokeWidth="12" strokeLinecap="round" fill="none"
                                                        strokeDasharray="553" strokeDashoffset={553 - (553 * currentRiskProxy)}
                                                        className={`transition-all duration-1000 ease-out drop-shadow-md ${currentRiskProxy > 0.7 ? "text-rose-500" : currentRiskProxy > 0.4 ? "text-amber-400" : "text-emerald-400"}`} />
                                                </svg>
                                                <div className="text-center relative z-10">
                                                    <span className={`text-5xl font-black ${currentRiskProxy > 0.7 ? "text-rose-400" : currentRiskProxy > 0.4 ? "text-amber-400" : "text-white"
                                                        }`}>{(currentRiskProxy * 100).toFixed(0)}</span><span className={`text-2xl font-bold ${currentRiskProxy > 0.7 ? "text-rose-500" : currentRiskProxy > 0.4 ? "text-amber-500" : "text-slate-500"
                                                            }`}>%</span>
                                                </div>
                                                <div className="absolute -bottom-2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded shadow flex items-center gap-1 z-20">
                                                    <Info size={10} /> View Drilldown
                                                </div>
                                            </div>

                                            <div className={`w-full p-4 rounded-xl border flex items-center gap-4 ${currentRiskProxy > 0.7 ? "bg-rose-950/30 border-rose-900/50" :
                                                currentRiskProxy > 0.4 ? "bg-amber-950/30 border-amber-900/50" : "bg-slate-800/50 border-slate-700/50"
                                                }`}>
                                                <div className={`p-2.5 rounded-lg ${currentRiskProxy > 0.7 ? "bg-rose-900/30 text-rose-400" :
                                                    currentRiskProxy > 0.4 ? "bg-amber-900/30 text-amber-400" : "bg-indigo-900/30 text-indigo-400"
                                                    }`}>
                                                    <Clock size={20} />
                                                </div>
                                                <div>
                                                    <span className={`block text-xs font-bold uppercase ${currentRiskProxy > 0.7 ? "text-rose-400" :
                                                        currentRiskProxy > 0.4 ? "text-amber-400" : "text-indigo-400"
                                                        }`}>Est. Onset Timeline</span>
                                                    <span className="text-xl font-black text-white">{result.time_to_onset_hours.toFixed(1)} <span className="text-sm font-semibold text-slate-400 uppercase">Hours</span></span>
                                                </div>
                                            </div>
                                        </div>

                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setShowSimulationModal(true); }}
                                            className="mt-4 w-full flex items-center justify-center gap-2 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500 text-indigo-300 py-3 rounded-xl font-bold transition-all shadow-md group disabled:opacity-50"
                                            disabled={isLive || slicedData.length === 0}
                                            title={isLive ? "Pause live stream to run simulations" : "Simulate interventions"}
                                        >
                                            <Activity size={18} className="group-hover:animate-pulse" />
                                            Simulate Treatment
                                        </button>

                                        {/* Timeline Scrubber */}
                                        <div className="mt-8 pt-6 border-t border-slate-800/80">
                                            <div className="flex justify-between items-center mb-2">
                                                <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2">
                                                    <Activity size={12} /> Time Simulation
                                                </label>
                                                <button
                                                    onClick={() => setIsPlaying(!isPlaying)}
                                                    className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-colors ${isPlaying ? 'bg-amber-900/50 text-amber-500 border border-amber-900/50' : 'bg-indigo-900/50 text-indigo-400 border border-indigo-900/50'}`}
                                                >
                                                    {isPlaying ? '⏸ Pause' : '▶ Play'}
                                                </button>
                                            </div>
                                            <input
                                                type="range"
                                                min="0"
                                                max={result.time_series_data.length - 1}
                                                value={timelineIndex}
                                                onChange={(e) => {
                                                    setTimelineIndex(parseInt(e.target.value));
                                                    setIsPlaying(false);
                                                }}
                                                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                            />
                                            <div className="flex justify-between mt-1 text-[10px] font-semibold text-slate-500">
                                                <span>{result.time_series_data[0].Hour}h</span>
                                                <span className="text-indigo-400">Hour {result.time_series_data[timelineIndex].Hour}</span>
                                                <span>{result.time_series_data[result.time_series_data.length - 1].Hour}h</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Clinical AI Summary Component */}
                                <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-md flex-1">
                                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                                        <BrainCircuit size={18} className="text-purple-500" />
                                        Auto-Generated Chart Note
                                    </h2>
                                    <div className="prose prose-sm prose-slate max-w-none text-slate-300 leading-relaxed custom-scrollbar max-h-[300px] overflow-y-auto pr-2">
                                        {result.explanation.split('\n').map((paragraph, idx) => (
                                            <p key={idx} className="mb-2">{paragraph}</p>
                                        ))}
                                    </div>
                                </div>

                                {/* Decision Support Layer */}
                                {currentRiskProxy > 0.6 && (
                                    <div className="bg-rose-950/20 border border-rose-900/50 p-5 rounded-2xl shadow-md text-sm">
                                        <h3 className="font-bold text-rose-500 flex items-center gap-2 mb-3">
                                            <AlertTriangle size={16} /> Recommended Clinical Actions
                                        </h3>
                                        <div className="space-y-2 mb-4">
                                            <label className="flex items-center gap-3 bg-slate-900 p-2 rounded-lg border border-rose-900/30 cursor-pointer hover:bg-rose-900/20 transition-colors">
                                                <input type="checkbox" className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-rose-500/50 focus:ring-offset-slate-900" />
                                                <span className="font-medium text-slate-300">Order immediate blood cultures x2</span>
                                            </label>
                                            <label className="flex items-center gap-3 bg-slate-900 p-2 rounded-lg border border-rose-900/30 cursor-pointer hover:bg-rose-900/20 transition-colors">
                                                <input type="checkbox" className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-rose-500/50 focus:ring-offset-slate-900" />
                                                <span className="font-medium text-slate-300">Initiate broad-spectrum IV antibiotics</span>
                                            </label>
                                            <label className="flex items-center gap-3 bg-slate-900 p-2 rounded-lg border border-rose-900/30 cursor-pointer hover:bg-rose-900/20 transition-colors">
                                                <input type="checkbox" className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-rose-500/50 focus:ring-offset-slate-900" />
                                                <span className="font-medium text-slate-300">Monitor serum lactate levels Q2H</span>
                                            </label>
                                        </div>
                                        <p className="text-[10px] uppercase font-bold text-rose-500/80 text-center border-t border-rose-900/50 pt-3 mt-1">
                                            AI Decision Support Only - Consult Attending
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Right Column: Time Series Tabs */}
                            <div className="xl:col-span-2 bg-slate-900 rounded-2xl border border-slate-800 shadow-md flex flex-col overflow-hidden">

                                {/* Tabs */}
                                <div className="flex border-b border-slate-800 bg-slate-950/50 px-2 pt-2 gap-1">
                                    <button
                                        onClick={() => setActiveTab('overview')}
                                        className={`px-5 py-3 text-sm font-bold rounded-t-lg transition-colors border-b-2 ${activeTab === 'overview' ? "bg-slate-900 text-indigo-400 border-indigo-500" : "text-slate-500 border-transparent hover:bg-slate-800 hover:text-slate-300"
                                            }`}
                                    >
                                        Cardiopulmonary Timeline
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('shap')}
                                        className={`px-5 py-3 text-sm font-bold rounded-t-lg transition-colors border-b-2 ${activeTab === 'shap' ? "bg-slate-900 text-purple-400 border-purple-500" : "text-slate-500 border-transparent hover:bg-slate-800 hover:text-slate-300"
                                            }`}
                                    >
                                        Algorithm Feature Impact
                                    </button>
                                </div>

                                <div className="p-6 flex-1 flex flex-col">
                                    {activeTab === 'overview' ? (
                                        <div className="space-y-8 flex-1">
                                            {/* Heart Rate / SpO2 Chart */}
                                            <div className="h-[240px]">
                                                <div className="flex items-center justify-between mb-2">
                                                    <h3 className="text-xs font-bold uppercase text-slate-400">Heart Rate vs SpO2</h3>
                                                    <div className="flex gap-4 text-xs font-semibold">
                                                        <span className="flex items-center gap-1.5 text-slate-300"><div className="w-2.5 h-2.5 rounded bg-rose-500"></div>HR (bpm)</span>
                                                        <span className="flex items-center gap-1.5 text-slate-300"><div className="w-2.5 h-2.5 rounded bg-blue-500"></div>SpO2 (%)</span>
                                                    </div>
                                                </div>
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <AreaChart data={slicedData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                                        <defs>
                                                            <linearGradient id="colorHr" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2} />
                                                                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                                                            </linearGradient>
                                                            <linearGradient id="colorSpo" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                                        <XAxis dataKey="Hour" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                                                        <YAxis yAxisId="left" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} domain={['dataMin - 10', 'dataMax + 10']} />
                                                        <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} domain={[80, 100]} />
                                                        <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)', fontSize: '13px', fontWeight: '500' }} />
                                                        <Area yAxisId="left" type="monotone" dataKey="HeartRate" stroke="#f43f5e" strokeWidth={3} fillOpacity={1} fill="url(#colorHr)" activeDot={{ r: 6, strokeWidth: 0 }} />
                                                        <Area yAxisId="right" type="monotone" dataKey="SpO2" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorSpo)" activeDot={{ r: 6, strokeWidth: 0 }} />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </div>

                                            <div className="h-px bg-slate-800"></div>

                                            {/* BP Chart */}
                                            <div className="h-[240px]">
                                                <div className="flex items-center justify-between mb-2">
                                                    <h3 className="text-xs font-bold uppercase text-slate-500">Blood Pressure (Systolic / Diastolic)</h3>
                                                    <div className="flex gap-4 text-xs font-semibold">
                                                        <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-emerald-500"></div>Sys BP</span>
                                                        <span className="flex items-center gap-1.5"><div className="w-4 h-1 border-b-2 border-dashed border-emerald-400"></div>Dias BP</span>
                                                    </div>
                                                </div>
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={slicedData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                                        <XAxis dataKey="Hour" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                                                        <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} domain={['dataMin - 10', 'dataMax + 10']} />
                                                        <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)', fontSize: '13px', fontWeight: '500' }} />
                                                        <Line type="monotone" dataKey="SysBP" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} />
                                                        <Line type="monotone" dataKey="DiasBP" stroke="#34d399" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 6, strokeWidth: 0 }} />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex-1">
                                            <h3 className="text-xs font-bold uppercase text-slate-400 mb-6">SHAP Values Breakdown</h3>
                                            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                                {Object.entries(result.shap_values)
                                                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                                                    .map(([feature, val]) => (
                                                        <div key={feature} className="flex items-center gap-4">
                                                            <div className="w-32 text-sm font-semibold text-slate-300 text-right tracking-wide">{feature}</div>
                                                            <div className="flex-1 bg-slate-800 rounded-full h-5 relative flex items-center shadow-inner border border-slate-700/50">
                                                                {/* Zero axis marker */}
                                                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-500 z-10"></div>
                                                                {/* Bar graphic */}
                                                                <div
                                                                    className={`absolute top-0 bottom-0 rounded-full opacity-80 ${val > 0 ? "bg-rose-500" : "bg-emerald-500"}`}
                                                                    style={{
                                                                        width: `${Math.min(Math.abs(val) * 100, 50)}%`,
                                                                        left: val > 0 ? "50%" : `calc(50% - ${Math.min(Math.abs(val) * 100, 50)}%)`
                                                                    }}
                                                                ></div>
                                                            </div>
                                                            <div className={`w-16 text-xs font-bold ${val > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                                                {val > 0 ? "+" : ""}{val.toFixed(3)}
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                            <div className="mt-8 p-4 bg-slate-900 rounded-lg text-xs font-medium text-slate-400 leading-relaxed border border-slate-800">
                                                <strong>Note on Explainability:</strong> Values leaning to the right (<span className="text-rose-400">positive</span>) actively push the LSTM model towards diagnosing Sepsis higher risk. Values leaning left (<span className="text-emerald-400">negative</span>) pull the baseline risk down. Scale is relative to the internal model architecture.
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                    </div>
                )}
            </div>

            {/* Risk Drilldown Modal */}
            {showRiskModal && result && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-slate-900 rounded-2xl shadow-xl shadow-black/50 w-full max-w-lg overflow-hidden border border-slate-800">
                        <div className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-950/50">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <Stethoscope size={18} className="text-indigo-400" />
                                Interactive Risk Drilldown
                            </h3>
                            <button onClick={() => setShowRiskModal(false)} className="text-slate-400 hover:text-white transition-colors p-1 rounded-full hover:bg-slate-800">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6">
                            <div className="flex gap-4 mb-8">
                                <div className={`flex-1 p-4 rounded-xl border ${result.risk_probability > 0.7 ? "bg-rose-950/30 border-rose-900 text-rose-400" : result.risk_probability > 0.4 ? "bg-amber-950/30 border-amber-900 text-amber-400" : "bg-emerald-950/30 border-emerald-900 text-emerald-400"}`}>
                                    <p className="text-[10px] font-black uppercase mb-1 opacity-70">Probability of Sepsis</p>
                                    <p className="text-3xl font-black text-white">{(result.risk_probability * 100).toFixed(1)}<span className="text-lg opacity-80">%</span></p>
                                </div>
                                <div className="flex-1 p-4 rounded-xl border bg-slate-800/50 border-slate-700 text-slate-300">
                                    <p className="text-[10px] font-black uppercase mb-1 opacity-70">Risk Category</p>
                                    <p className="text-xl font-bold mt-2 text-white">
                                        {result.risk_probability > 0.7 ? "🔴 High (>60%)" : result.risk_probability > 0.4 ? "🟡 Moderate (30–60%)" : "🟢 Low (<30%)"}
                                    </p>
                                </div>
                            </div>

                            <h4 className="text-xs font-bold uppercase text-slate-400 mb-4 border-b border-slate-800 pb-2">Top 4 Contributing Features (SHAP)</h4>
                            <div className="space-y-3">
                                {Object.entries(result.shap_values)
                                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                                    .slice(0, 4)
                                    .map(([feature, val], i) => (
                                        <div key={i} className="flex justify-between items-center p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                                            <span className="text-sm font-semibold text-slate-300">{feature}</span>
                                            <span className={`text-sm font-bold flex items-center gap-1 ${val > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                                {val > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                                {val > 0 ? "+" : ""}{(val * 10).toFixed(1)}% Risk
                                            </span>
                                        </div>
                                    ))
                                }
                            </div>
                            <div className="mt-6 p-4 rounded-lg bg-indigo-50 border border-indigo-100">
                                <p className="text-xs font-semibold text-indigo-800 flex items-start gap-2">
                                    <Info size={16} className="shrink-0 mt-0.5" />
                                    This drilldown bridges the AI black-box by translating internal SHAP tensor weightings into approximated percentage risk contributions.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Treatment Impact Simulation Modal */}
            {showSimulationModal && result && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-slate-900 rounded-2xl shadow-xl shadow-black/50 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-800">
                        {/* Header */}
                        <div className="flex justify-between items-center p-5 border-b border-slate-800 bg-slate-950/50">
                            <div>
                                <h3 className="font-bold text-white flex items-center gap-2 text-lg">
                                    <Activity size={20} className="text-indigo-400" />
                                    Treatment Impact Simulator
                                </h3>
                                <p className="text-xs text-slate-400 mt-1">Adjust current vitals to simulate the AI's response to medical interventions (e.g. Fluids, Vasopressors).</p>
                            </div>
                            <button onClick={() => { setShowSimulationModal(false); resetSimulation(); }} className="text-slate-400 hover:text-white transition-colors p-2 rounded-full hover:bg-slate-800">
                                <X size={24} />
                            </button>
                        </div>
                        
                        {/* Body */}
                        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                            
                            {/* Left: Input Controls */}
                            <div className="space-y-6">
                                <h4 className="text-sm font-bold uppercase text-slate-400 flex items-center gap-2">
                                    <TrendingUp size={16} /> Adjust Vitals
                                </h4>
                                
                                <div className="space-y-4">
                                    {Object.keys(simAdjustments).map((vitalKey) => {
                                        const currentValue = slicedData[slicedData.length - 1]?.[vitalKey] || 0;
                                        const projectedValue = currentValue + parseFloat(simAdjustments[vitalKey] || 0);
                                        
                                        return (
                                            <div key={vitalKey} className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                                                <div className="flex justify-between items-center mb-3">
                                                    <span className="font-semibold text-slate-200">{vitalKey === 'TempC' ? 'Temperature' : vitalKey}</span>
                                                    <div className="font-mono text-xs flex items-center gap-2">
                                                        <span className="text-slate-400">Current: {currentValue.toFixed(1)}</span>
                                                        <span className="text-slate-600">→</span>
                                                        <span className={`font-bold ${parseFloat(simAdjustments[vitalKey]) > 0 ? 'text-amber-400' : parseFloat(simAdjustments[vitalKey]) < 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                                                            {projectedValue.toFixed(1)}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex gap-4 items-center">
                                                    <input 
                                                        type="range" 
                                                        min="-40" 
                                                        max="40" 
                                                        step="0.5"
                                                        value={simAdjustments[vitalKey]}
                                                        onChange={(e) => setSimAdjustments({...simAdjustments, [vitalKey]: parseFloat(e.target.value)})}
                                                        className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                    />
                                                    <div className="w-20 relative">
                                                        <input 
                                                            type="number"
                                                            value={simAdjustments[vitalKey]}
                                                            onChange={(e) => setSimAdjustments({...simAdjustments, [vitalKey]: parseFloat(e.target.value) || 0})}
                                                            className="w-full bg-slate-900 border border-slate-600 rounded p-1.5 text-right font-mono text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                                        />
                                                        <span className="absolute left-2 top-2 text-xs text-slate-500">Δ</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                
                                <div className="flex gap-3 pt-2">
                                    <button 
                                        onClick={runSimulation}
                                        disabled={isSimulating}
                                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl shadow-md transition-colors flex justify-center items-center gap-2"
                                    >
                                        {isSimulating ? <span className="animate-spin">↻</span> : <BrainCircuit size={18} />}
                                        Run Simulation
                                    </button>
                                    <button 
                                        onClick={resetSimulation}
                                        className="px-4 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 font-bold rounded-xl transition-colors"
                                    >
                                        Reset
                                    </button>
                                </div>
                            </div>
                            
                            {/* Right: Results Comparison */}
                            <div className="bg-slate-950/50 rounded-2xl p-6 border border-slate-800/80">
                                <h4 className="text-sm font-bold uppercase text-slate-400 flex items-center gap-2 mb-6">
                                    <BrainCircuit size={16} className="text-purple-400" /> Comparison Results
                                </h4>
                                
                                {!simResult ? (
                                    <div className="h-48 flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-800 rounded-xl">
                                        <Activity size={32} className="mb-2 opacity-50" />
                                        <p>Adjust vitals and run simulation to see projected outcomes.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">
                                        
                                        {/* Score Comparison */}
                                        <div>
                                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Projected Sepsis Probability</p>
                                            <div className="flex items-center gap-6">
                                                {/* Current */}
                                                <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-4 text-center opacity-70">
                                                    <p className="text-xs font-semibold text-slate-400 mb-1">Current Baseline</p>
                                                    <p className="text-3xl font-black text-slate-300">{(currentRiskProxy * 100).toFixed(1)}%</p>
                                                </div>
                                                
                                                <TrendingDown size={24} className={simResult.projected_risk < currentRiskProxy ? 'text-emerald-500' : 'rotate-180 text-rose-500'} />
                                                
                                                {/* Projected */}
                                                <div className={`flex-1 rounded-xl p-4 text-center border shadow-lg relative overflow-hidden ${
                                                    simResult.projected_risk < currentRiskProxy 
                                                        ? 'bg-emerald-900/20 border-emerald-500/50' 
                                                        : 'bg-rose-900/20 border-rose-500/50'
                                                }`}>
                                                    <div className={`absolute top-0 w-full h-1 left-0 ${simResult.projected_risk < currentRiskProxy ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                                                    <p className="text-xs font-bold text-white mb-1">Post-Intervention</p>
                                                    <p className={`text-4xl font-black ${
                                                        simResult.projected_risk < currentRiskProxy ? 'text-emerald-400' : 'text-rose-400'
                                                    }`}>{(simResult.projected_risk * 100).toFixed(1)}%</p>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        {/* SHAP Impact Changes */}
                                        <div>
                                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Changes in AI Reasoning (SHAP)</p>
                                            <div className="space-y-2">
                                                {Object.entries(simResult.projected_shap)
                                                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                                                    .slice(0, 3)
                                                    .map(([feature, val]) => {
                                                        const oldVal = result.shap_values[feature] || 0;
                                                        const diff = val - oldVal;
                                                        if (Math.abs(diff) < 0.001) return null;
                                                        
                                                        return (
                                                            <div key={feature} className="flex items-center justify-between text-sm py-2 px-3 bg-slate-900 rounded-lg">
                                                                <span className="font-medium text-slate-300">{feature}</span>
                                                                <div className="flex items-center gap-3">
                                                                    <span className="text-slate-500 text-xs text-right">
                                                                        was {oldVal > 0 ? '+' : ''}{(oldVal*10).toFixed(1)}
                                                                    </span>
                                                                    <span className="text-slate-600">→</span>
                                                                    <span className={`font-bold w-16 text-right ${val > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                                                        {val > 0 ? '+' : ''}{(val*10).toFixed(1)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
