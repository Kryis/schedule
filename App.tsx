
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, TimetableData, ProcessingStatus, DriveFile } from './types';
import { initGoogleAuth, initGapiClient, handleLogin, listSpreadsheets, readSpreadsheet, saveJsonToDrive } from './services/driveService';
import { parseSpreadsheetWithGemini } from './services/geminiService';
import TimetableGrid from './components/TimetableGrid';

const APP_VERSION = "v2.1 (Excel Support)";

// Declare global variable for SheetJS library loaded via CDN
declare var XLSX: any;

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [token, setToken] = useState<string | null>(null);
  const [timetableData, setTimetableData] = useState<TimetableData | null>(null);
  const [status, setStatus] = useState<ProcessingStatus>({ step: '' });
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isInitializing, setIsInitializing] = useState(false);
  
  // Custom File Picker State
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  
  // Local Mode State
  const [localInputText, setLocalInputText] = useState('');
  
  // Configuration State
  const [clientId, setClientId] = useState<string>(() => {
    return process.env.GOOGLE_CLIENT_ID || localStorage.getItem('GOOGLE_CLIENT_ID') || '';
  });
  const [googleApiKey, setGoogleApiKey] = useState<string>(() => {
    return process.env.GOOGLE_PICKER_API_KEY || localStorage.getItem('GOOGLE_PICKER_API_KEY') || '';
  });

  const [tempClientId, setTempClientId] = useState(clientId);
  const [tempApiKey, setTempApiKey] = useState(googleApiKey);
  
  const geminiApiKey = process.env.API_KEY;
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  // Initialize Google Libraries (Only if keys are present)
  useEffect(() => {
    if (!clientId || !googleApiKey) {
      return; 
    }

    setIsInitializing(true);

    const loadScripts = async () => {
      const errors: string[] = [];

      // 1. Initialize GAPI (Client)
      try {
        await initGapiClient(googleApiKey);
      } catch (err: any) {
        console.error("GAPI Init Failed", err);
        // Don't block app for this, just log
      }

      // 2. Initialize GIS (Auth)
      try {
        initGoogleAuth(clientId, (accessToken) => {
          setToken(accessToken);
          setAppState(AppState.PICKING_FILE);
        });
      } catch (err: any) {
        console.error("Auth Init Failed", err);
      }

      setIsInitializing(false);
    };

    // Wait for BOTH scripts to be fully loaded
    const checkGoogle = setInterval(() => {
      const gisReady = typeof (window as any).google !== 'undefined' && (window as any).google.accounts;
      const gapiReady = typeof (window as any).gapi !== 'undefined';

      if (gisReady && gapiReady) {
        clearInterval(checkGoogle);
        loadScripts();
      }
    }, 500);
    
    const timeout = setTimeout(() => {
        clearInterval(checkGoogle);
        if (isInitializing) setIsInitializing(false);
    }, 5000);

    return () => {
        clearInterval(checkGoogle);
        clearTimeout(timeout);
    };
  }, [clientId, googleApiKey]);

  // Auto-fetch files when entering PICKING_FILE state
  useEffect(() => {
      if (appState === AppState.PICKING_FILE && token) {
          fetchFiles();
      }
  }, [appState, token]);

  const fetchFiles = async () => {
      setIsLoadingFiles(true);
      try {
          const fileList = await listSpreadsheets();
          setFiles(fileList);
      } catch (error) {
          console.error("Failed to fetch files", error);
          setErrorMsg("Failed to load files from Drive. Please ensure you granted 'Drive' permissions.");
      } finally {
          setIsLoadingFiles(false);
      }
  };

  const handleSaveConfig = () => {
    if (!tempClientId.includes('.apps.googleusercontent.com')) {
        alert("Invalid Client ID format.");
        return;
    }

    if (tempClientId.trim() && tempApiKey.trim()) {
      const newClientId = tempClientId.trim();
      const newApiKey = tempApiKey.trim();
      
      localStorage.setItem('GOOGLE_CLIENT_ID', newClientId);
      localStorage.setItem('GOOGLE_PICKER_API_KEY', newApiKey);
      
      setClientId(newClientId);
      setGoogleApiKey(newApiKey);
      setErrorMsg(''); 
      alert("Configuration saved.");
    }
  };

  const handleConnectClick = () => {
    if (isInitializing) return;
    setAppState(AppState.AUTHENTICATING);
    handleLogin();
  };

  const handleReset = () => {
      if (confirm("Clear all settings and reload?")) {
          localStorage.removeItem('GOOGLE_CLIENT_ID');
          localStorage.removeItem('GOOGLE_PICKER_API_KEY');
          window.location.reload();
      }
  };

  const handleFileSelect = useCallback(async (fileId: string, name: string) => {
    setAppState(AppState.READING_FILE);
    setStatus({ step: `Reading ${name}...` });

    try {
      // 1. Read Sheet
      const rawCsv = await readSpreadsheet(fileId);
      
      // 2. Parse with Gemini
      setAppState(AppState.PARSING_AI);
      setStatus({ step: 'Analyzing schedule with Gemini AI...' });
      const parsed = await parseSpreadsheetWithGemini(rawCsv);
      
      // 3. Save JSON to Drive
      setAppState(AppState.SAVING_DRIVE);
      setStatus({ step: 'Saving processed schedule to Drive...' });
      try {
        const jsonFileId = await saveJsonToDrive(`parsed_schedule_${Date.now()}.json`, parsed);
        console.log("Saved JSON to Drive with ID:", jsonFileId);
      } catch (e) {
          console.warn("Could not save to Drive (might be readonly or local mode logic error)", e);
      }

      // 4. Display
      setTimetableData(parsed);
      setAppState(AppState.VIEW_SCHEDULE);

    } catch (err) {
      console.error(err);
      setAppState(AppState.ERROR);
      setErrorMsg(err instanceof Error ? err.message : "An unknown error occurred during processing.");
    }
  }, []);

  // --- LOCAL MODE HANDLERS ---
  const handleLocalFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const fileName = file.name.toLowerCase();
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

      if (isExcel) {
        // Handle Excel Binary
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                // Use global XLSX library
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                // Convert to CSV string for Gemini
                const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
                setLocalInputText(csvOutput);
            } catch (err) {
                console.error("Excel Parse Error:", err);
                alert("Failed to parse Excel file. Please try saving as CSV.");
            }
        };
        reader.readAsArrayBuffer(file);
      } else {
        // Handle Text/CSV
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            setLocalInputText(text);
        };
        reader.readAsText(file);
      }
  };

  const handleProcessLocal = async () => {
      if (!localInputText.trim()) {
          alert("Please enter some text or upload a CSV/Excel file.");
          return;
      }

      setAppState(AppState.PARSING_AI);
      setStatus({ step: 'Analyzing your data with Gemini AI...' });

      try {
          const parsed = await parseSpreadsheetWithGemini(localInputText);
          setTimetableData(parsed);
          setAppState(AppState.VIEW_SCHEDULE);
      } catch (err) {
          console.error(err);
          setAppState(AppState.ERROR);
          setErrorMsg(err instanceof Error ? err.message : "Failed to parse local data.");
      }
  };

  const handleDownloadJson = () => {
      if (!timetableData) return;
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(timetableData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", (timetableData.scheduleName || "schedule") + ".json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
  };

  // --- RENDER: MAIN APP ---
  const renderContent = () => {
    // Critical: Check for Gemini API Key first
    if (!geminiApiKey) {
        return (
             <div className="text-center p-8 bg-red-50 rounded-xl border border-red-200 max-w-lg mx-auto shadow-sm">
                <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </div>
                <h2 className="text-xl font-bold text-red-900 mb-2">Environment Configuration Error</h2>
                <p className="text-red-700 mb-6 text-sm">
                    The <code>API_KEY</code> environment variable is missing. 
                    This application requires a Google Gemini API Key to function.
                </p>
             </div>
        )
    }

    switch (appState) {
      case AppState.IDLE:
        const hasKeys = !!(clientId && googleApiKey);
        
        return (
          <div className="text-center px-4 max-w-4xl mx-auto">
            <div className="mb-10">
              <div className="w-24 h-24 bg-gradient-to-tr from-indigo-100 to-white text-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl border border-indigo-50">
                 <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              </div>
              <h1 className="text-4xl font-extrabold text-slate-800 mb-4 tracking-tight">SmartSchedule</h1>
              <p className="text-slate-500 max-w-lg mx-auto text-lg leading-relaxed">
                Transform your spreadsheet timetables into beautiful, interactive schedules using Google Gemini AI.
              </p>
            </div>
            
            <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
                {/* Option 1: Local Mode (Recommended for Preview) */}
                <button
                    onClick={() => setAppState(AppState.INPUT_LOCAL)}
                    className="bg-white hover:bg-indigo-50 border-2 border-indigo-100 hover:border-indigo-300 text-slate-700 p-6 rounded-2xl shadow-sm hover:shadow-md transition group text-left flex flex-col items-center justify-center h-48"
                >
                     <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                     </div>
                     <span className="font-bold text-lg text-indigo-900">Use Local File / Paste</span>
                     <span className="text-xs text-slate-400 mt-2">Upload .xlsx, .csv or paste text.</span>
                </button>

                {/* Option 2: Google Drive */}
                {!hasKeys ? (
                     <div className="bg-slate-50 border-2 border-slate-100 p-6 rounded-2xl shadow-inner text-center flex flex-col items-center justify-center h-48 opacity-75">
                         <h3 className="font-bold text-slate-600 mb-2">Connect Google Drive</h3>
                         <p className="text-xs text-slate-400 mb-4">Requires Client ID & API Key setup.</p>
                         <button 
                            onClick={() => { 
                                // Simple UX enhancement: user can fill the inputs below
                            }}
                            className="text-indigo-600 text-sm font-bold underline cursor-default"
                         >
                             Setup Keys below
                         </button>
                     </div>
                ) : (
                    <button
                        onClick={handleConnectClick}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white p-6 rounded-2xl shadow-lg hover:shadow-xl transition group text-left flex flex-col items-center justify-center h-48"
                    >
                        <div className="w-12 h-12 bg-white/20 text-white rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition">
                             <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M12.0003 20.45C7.94029 20.45 4.38029 18.23 2.31029 14.88L4.66029 10.8C4.94029 14.39 7.95029 17.25 11.6603 17.25H12.0003V20.45ZM6.64029 9.39001L4.29029 5.32001C2.56029 7.37001 1.58029 9.94001 1.58029 12.68C1.58029 13.06 1.60029 13.43 1.63029 13.8L6.64029 9.39001ZM12.0003 3.55002C14.6103 3.55002 16.9203 4.67002 18.4903 6.44002L20.4403 3.06002C18.2503 1.52002 15.3503 0.530016 12.0003 0.530016C8.07029 0.530016 4.54029 2.45002 2.45029 5.41002L5.27029 10.3C5.99029 6.47002 8.71029 3.55002 12.0003 3.55002ZM22.3803 10.97L17.7203 19.04H12.3503L16.2903 12.21L17.0203 10.97H22.3803ZM22.3803 12.67C22.4003 12.29 22.4203 11.91 22.4203 11.53C22.4203 8.35002 20.9703 5.49002 18.7203 3.65002L16.2903 7.87002C18.6703 8.33002 20.5703 10.23 21.0503 12.67H22.3803Z"/></svg>
                        </div>
                        <span className="font-bold text-lg">Connect Drive</span>
                        <span className="text-xs text-indigo-200 mt-2">Sync with Google Sheets</span>
                    </button>
                )}
            </div>

            {/* Config Section */}
            {!hasKeys && (
                <div className="mt-12 bg-white p-6 rounded-xl border border-slate-200 max-w-lg mx-auto text-left">
                    <h3 className="font-bold text-slate-700 mb-4">Setup Google Drive (Optional)</h3>
                    <div className="space-y-4">
                        <input 
                            type="text" 
                            className="w-full px-4 py-2 border rounded-lg text-sm bg-slate-50"
                            placeholder="Client ID"
                            value={tempClientId}
                            onChange={(e) => setTempClientId(e.target.value)}
                        />
                        <input 
                            type="text" 
                            className="w-full px-4 py-2 border rounded-lg text-sm bg-slate-50"
                            placeholder="API Key"
                            value={tempApiKey}
                            onChange={(e) => setTempApiKey(e.target.value)}
                        />
                        <button onClick={handleSaveConfig} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-bold">Save Credentials</button>
                    </div>
                    <div className="bg-amber-50 p-2 mt-4 text-[10px] text-amber-800 rounded border border-amber-200">
                        Origin: {currentOrigin}
                    </div>
                </div>
            )}
            
            {hasKeys && (
                <div className="mt-8">
                     <button onClick={handleReset} className="text-xs text-slate-400 underline hover:text-red-500">Reset Credentials</button>
                </div>
            )}

            {errorMsg && (
                 <div className="mt-6 bg-red-50 text-red-700 p-4 rounded-lg text-sm border border-red-200">
                    <p className="font-bold">Error:</p>
                    <pre className="whitespace-pre-wrap text-xs mt-1">{errorMsg}</pre>
                 </div>
            )}
          </div>
        );

      case AppState.INPUT_LOCAL:
          return (
              <div className="w-full max-w-3xl mx-auto bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
                  <div className="flex justify-between items-center mb-6">
                      <h2 className="text-2xl font-bold text-slate-800">Local Data Input</h2>
                      <button onClick={() => setAppState(AppState.IDLE)} className="text-sm text-slate-400 hover:text-indigo-600">Back</button>
                  </div>

                  <div className="space-y-6">
                      {/* File Upload */}
                      <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:bg-slate-50 transition cursor-pointer relative">
                          <input 
                            type="file" 
                            accept=".csv,.txt,.xlsx,.xls"
                            onChange={handleLocalFileChange}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          />
                          <div className="text-indigo-500 mb-2">
                              <svg className="w-10 h-10 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                          </div>
                          <p className="font-medium text-slate-700">Click to upload .xlsx, .csv or .txt</p>
                          <p className="text-xs text-slate-400 mt-1">or drag and drop here</p>
                      </div>

                      <div className="relative flex py-2 items-center">
                        <div className="flex-grow border-t border-slate-200"></div>
                        <span className="flex-shrink-0 mx-4 text-slate-400 text-xs uppercase font-bold">OR PASTE TEXT</span>
                        <div className="flex-grow border-t border-slate-200"></div>
                      </div>

                      {/* Text Area */}
                      <div>
                          <textarea 
                            className="w-full h-48 p-4 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm font-mono bg-slate-50"
                            placeholder="Paste your schedule data here...&#10;Example:&#10;Monday, 09:00, 10:30, Math, Room 101&#10;Tuesday, 14:00, 15:30, Physics, Lab 2"
                            value={localInputText}
                            onChange={(e) => setLocalInputText(e.target.value)}
                          ></textarea>
                      </div>

                      <button 
                        onClick={handleProcessLocal}
                        disabled={!localInputText.trim()}
                        className={`w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-xl shadow-lg transition ${!localInputText.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                          Generate Schedule
                      </button>
                  </div>
              </div>
          );

      case AppState.AUTHENTICATING:
        return (
          <div className="text-center animate-pulse flex flex-col items-center">
            <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
            <p className="text-lg text-indigo-600 font-medium">Authenticating with Google...</p>
            <p className="text-sm text-slate-400 mt-2">Check for the popup window</p>
          </div>
        );

      case AppState.PICKING_FILE:
        return (
          <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-lg border border-slate-100 flex flex-col h-[600px]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
               <h2 className="text-xl font-bold text-slate-800">Select Spreadsheet</h2>
               <button onClick={fetchFiles} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                   <svg className={`w-5 h-5 ${isLoadingFiles ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
               </button>
            </div>
            
            <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                {isLoadingFiles && files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin mb-2"></div>
                        <p className="text-sm">Loading files from Drive...</p>
                    </div>
                ) : files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <p>No spreadsheet files found.</p>
                        <p className="text-xs mt-2">Ensure you have .xlsx or Google Sheets files.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {files.map(file => (
                            <div 
                                key={file.id} 
                                onClick={() => handleFileSelect(file.id, file.name)}
                                className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer transition group"
                            >
                                <div className="w-10 h-10 bg-green-100 text-green-600 rounded-lg flex items-center justify-center group-hover:bg-white group-hover:text-green-700 transition">
                                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-2h2v2zm0-4H7v-2h2v2zm0-4H7V7h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2z"/></svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="font-semibold text-slate-700 truncate group-hover:text-indigo-900">{file.name}</h4>
                                    <p className="text-xs text-slate-400">Last Modified: {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'Unknown'}</p>
                                </div>
                                <div className="text-slate-300 group-hover:text-indigo-500">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {errorMsg && (
                 <div className="bg-red-50 p-3 text-xs text-red-600 border-t border-red-100 text-center">
                     {errorMsg}
                 </div>
            )}
            <div className="p-4 border-t border-slate-100 text-center">
                 <button onClick={() => setAppState(AppState.IDLE)} className="text-slate-400 text-sm hover:text-slate-600">Cancel</button>
            </div>
          </div>
        );

      case AppState.READING_FILE:
      case AppState.PARSING_AI:
      case AppState.SAVING_DRIVE:
        return (
          <div className="text-center w-full max-w-md mx-auto bg-white p-8 rounded-2xl shadow-lg border border-slate-100">
             <div className="relative pt-1">
              <div className="flex mb-4 items-center justify-between">
                <div>
                  <span className="text-xs font-bold inline-block py-1 px-3 uppercase rounded-full text-indigo-600 bg-indigo-100">
                    Processing
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold inline-block text-indigo-600">
                    {appState === AppState.READING_FILE ? "30%" : appState === AppState.PARSING_AI ? "60%" : "90%"}
                  </span>
                </div>
              </div>
              <div className="overflow-hidden h-2 mb-6 text-xs flex rounded-full bg-slate-100">
                <div style={{ width: appState === AppState.READING_FILE ? "30%" : appState === AppState.PARSING_AI ? "60%" : "90%" }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-700 ease-out"></div>
              </div>
            </div>
            
            <div className="flex flex-col items-center">
                 {appState === AppState.PARSING_AI ? (
                     <div className="mb-4 text-indigo-500 animate-bounce">
                         <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                     </div>
                 ) : (
                     <div className="mb-4 text-slate-300">
                         <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                     </div>
                 )}
                <h3 className="text-xl font-bold text-slate-800">{status.step}</h3>
                <p className="text-sm text-slate-400 mt-2 max-w-xs mx-auto">
                    {appState === AppState.PARSING_AI ? "AI is analyzing the structure of your data..." : "Please wait while we process your request."}
                </p>
            </div>
          </div>
        );

      case AppState.ERROR:
        return (
          <div className="text-center p-8 max-w-lg mx-auto bg-white rounded-2xl border border-red-100 shadow-xl">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Oops!</h2>
            <p className="text-slate-500 mb-6 font-medium">We encountered an issue</p>
            <div className="bg-red-50 p-4 rounded-lg text-left mb-6 overflow-auto max-h-40">
                <code className="text-red-700 text-xs font-mono break-all">{errorMsg}</code>
            </div>
            <div className="flex gap-3 justify-center">
                <button
                onClick={() => {
                    setAppState(AppState.IDLE);
                    setErrorMsg('');
                    window.location.reload();
                }}
                className="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium py-2 px-6 rounded-lg transition"
                >
                Reload App
                </button>
                <button
                onClick={() => {
                    setAppState(AppState.IDLE);
                    setErrorMsg('');
                }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-6 rounded-lg transition shadow-md shadow-indigo-200"
                >
                Try Again
                </button>
            </div>
          </div>
        );

      case AppState.VIEW_SCHEDULE:
        return timetableData ? <TimetableGrid data={timetableData} /> : null;

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="px-6 py-4 bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm/50">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setAppState(AppState.IDLE)}>
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold shadow-indigo-200 shadow-lg">S</div>
            <span className="font-bold text-slate-800 text-lg tracking-tight">SmartSchedule</span>
          </div>
          <div className="flex items-center gap-2">
            {appState === AppState.VIEW_SCHEDULE && (
                <>
                <button 
                    onClick={handleDownloadJson} 
                    className="text-sm font-semibold text-white bg-green-600 hover:bg-green-700 py-2 px-4 rounded-lg transition flex items-center gap-2"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    <span>Download JSON</span>
                </button>
                <button 
                    onClick={() => setAppState(AppState.IDLE)} 
                    className="text-sm font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 py-2 px-4 rounded-lg transition"
                >
                    New
                </button>
                </>
            )}
            {appState === AppState.IDLE && (clientId || googleApiKey) && (
                <button 
                    onClick={handleReset}
                    className="text-xs text-slate-400 hover:text-red-500 transition px-2"
                    title="Clear Credentials"
                >
                    Reset Keys
                </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col items-center justify-center p-6 w-full relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
            <div className="absolute top-[-10%] left-[-5%] w-96 h-96 bg-indigo-100 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
            <div className="absolute top-[-10%] right-[-5%] w-96 h-96 bg-purple-100 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
            <div className="absolute bottom-[-20%] left-[20%] w-96 h-96 bg-pink-100 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
        </div>
        
        {renderContent()}
      </main>

       {/* Footer */}
       <footer className="py-6 text-center text-slate-400 text-xs border-t border-slate-100 bg-white/50 backdrop-blur-sm">
        <p>Powered by Gemini 2.5 Flash | {APP_VERSION}</p>
      </footer>
    </div>
  );
};

export default App;
