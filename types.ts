
export interface TimetableEvent {
  day: string; // "Monday", "Tuesday", etc.
  startTime: string; // "09:00"
  endTime: string; // "10:30"
  subject: string;
  location?: string;
  instructor?: string;
  color?: string; // Hex code or Tailwind class reference
}

export interface TimetableData {
  scheduleName: string;
  events: TimetableEvent[];
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

// Google API Types (simplified)
export interface GoogleAuthToken {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export enum AppState {
  IDLE = 'IDLE',
  AUTHENTICATING = 'AUTHENTICATING',
  PICKING_FILE = 'PICKING_FILE',
  INPUT_LOCAL = 'INPUT_LOCAL', // New state for local input
  READING_FILE = 'READING_FILE',
  PARSING_AI = 'PARSING_AI',
  SAVING_DRIVE = 'SAVING_DRIVE',
  VIEW_SCHEDULE = 'VIEW_SCHEDULE',
  ERROR = 'ERROR'
}

export interface ProcessingStatus {
  step: string;
  details?: string;
}
