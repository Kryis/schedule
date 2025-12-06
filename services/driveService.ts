
// Global declarations for Google Scripts
declare var google: any;
declare var gapi: any;

const DISCOVERY_DOCS = ["https://sheets.googleapis.com/$discovery/rest?version=v4", "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
// Updated Scopes: Added drive.readonly to list files without Picker
const SCOPES = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.file";

let tokenClient: any;
let accessToken: string | null = null;
let currentApiKey: string | null = null;

// Helper to check if GIS is loaded
export const isGisLoaded = () => {
  return typeof google !== 'undefined' && google.accounts && google.accounts.oauth2;
}

// Initialize the Google Identity Services client
export const initGoogleAuth = (clientId: string, callback: (token: string) => void) => {
  if (!isGisLoaded()) {
      throw new Error("Google Identity Services (GIS) script is not fully loaded.");
  }

  // Basic validation of Client ID format
  if (!clientId || !clientId.includes('.apps.googleusercontent.com')) {
      console.error("Invalid Client ID format detected:", clientId);
  }

  try {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      ux_mode: 'popup', 
      callback: (tokenResponse: any) => {
        if (tokenResponse.error) {
            console.error("Token Error:", tokenResponse);
            let msg = `Authentication Error: ${tokenResponse.error}`;
            if (tokenResponse.error === 'popup_closed_by_user') {
                msg = "Login cancelled. Please try again.";
            } else if (tokenResponse.error === 'access_denied') {
                msg = "Access denied. Please grant the requested permissions.";
            }
            alert(msg);
            return;
        }
        accessToken = tokenResponse.access_token;
        callback(accessToken!);
      },
    });
  } catch (error) {
    console.error("Error initializing Google Auth:", error);
    throw error;
  }
};

// Trigger login popup
export const handleLogin = () => {
  if (tokenClient) {
    // FORCE 'select_account' to ensure we don't use a stale or invalid session cookie
    // This often fixes the 'File not found' or weird auth loop issues
    tokenClient.requestAccessToken({ prompt: 'select_account' });
  } else {
    console.error("Token Client not initialized");
    alert("Authentication client not ready. Please verify your Client ID and network connection.");
  }
};

// Initialize GAPI client for REST calls
export const initGapiClient = async (apiKey: string) => {
  if (!apiKey) {
      throw new Error("API Key is required for GAPI initialization");
  }
  
  currentApiKey = apiKey;

  // Wait for gapi to be available just in case
  if (typeof gapi === 'undefined') {
      throw new Error("Google API Client script not loaded.");
  }

  await new Promise<void>((resolve, reject) => {
    gapi.load('client', async () => {
      try {
        await gapi.client.init({
          apiKey: apiKey,
          discoveryDocs: DISCOVERY_DOCS,
        });
        resolve();
      } catch (e) {
        // Return the error object so it can be handled by the caller
        reject(e);
      }
    });
  });
};

// Fetch list of Spreadsheets directly using Drive API
// This replaces Google Picker to avoid Origin/Iframe issues
export const listSpreadsheets = async (): Promise<any[]> => {
  try {
    const response = await gapi.client.drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 20,
    });
    return response.result.files || [];
  } catch (error) {
    console.error("Error listing files:", error);
    throw error;
  }
};

// Read Spreadsheet Data
export const readSpreadsheet = async (spreadsheetId: string): Promise<string> => {
  try {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'A1:Z100', // Read reasonably large range
    });

    const rows = response.result.values;
    if (!rows || rows.length === 0) {
      return "No data found.";
    }

    // Convert to CSV-like string for Gemini
    return rows.map((row: any[]) => row.join(",")).join("\n");
  } catch (error) {
    console.error("Error reading spreadsheet:", error);
    throw error;
  }
};

// Save JSON file to Drive
export const saveJsonToDrive = async (filename: string, data: any): Promise<string> => {
  const fileContent = JSON.stringify(data, null, 2);
  const file = new Blob([fileContent], { type: 'application/json' });
  const metadata = {
    name: filename,
    mimeType: 'application/json',
    description: 'Timetable processed by SmartSchedule PWA',
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  try {
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
      },
      body: form,
    });
    
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Drive Upload Failed: ${errText}`);
    }

    const result = await response.json();
    return result.id;
  } catch (error) {
    console.error("Error saving file to Drive:", error);
    throw error;
  }
};
