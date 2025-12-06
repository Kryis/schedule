import { GoogleGenAI, Type } from "@google/genai";
import { TimetableData } from "../types";

export const parseSpreadsheetWithGemini = async (csvContent: string, apiKey: string): Promise<TimetableData> => {
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please provide a valid key.");
  }

  // Initialize the client with the provided key (Dynamic initialization)
  const ai = new GoogleGenAI({ apiKey: apiKey });

  const prompt = `
    You are a data processing assistant. I have raw data from a spreadsheet representing a school or work timetable.
    Please analyze the following CSV/Text data and extract a structured weekly schedule.
    
    Rules:
    1. Identify days of the week (Monday through Sunday).
    2. Identify start and end times for each event.
    3. Identify the subject/event name.
    4. Identify location/room if available.
    5. Identify instructor/person if available.
    6. If the data is messy, do your best to infer the structure based on common timetable formats.
    7. Return the times in 24-hour format (HH:MM).
    8. Translate days to English (Monday, Tuesday...) if they are in another language, but keep Subject/Location in the original language.

    Raw Data:
    ${csvContent}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            scheduleName: {
              type: Type.STRING,
              description: "Inferred name of the schedule (e.g. 'Fall 2024 Class Schedule')",
            },
            events: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  day: { type: Type.STRING, description: "Day of the week (e.g. Monday)" },
                  startTime: { type: Type.STRING, description: "Start time in HH:MM" },
                  endTime: { type: Type.STRING, description: "End time in HH:MM" },
                  subject: { type: Type.STRING, description: "Name of the class or event" },
                  location: { type: Type.STRING, description: "Room or location", nullable: true },
                  instructor: { type: Type.STRING, description: "Teacher or host", nullable: true },
                },
                required: ["day", "startTime", "endTime", "subject"],
              },
            },
          },
          required: ["scheduleName", "events"],
        },
      },
    });

    if (!response.text) {
      throw new Error("No response text from Gemini.");
    }

    const parsedData = JSON.parse(response.text) as TimetableData;
    return parsedData;

  } catch (error) {
    console.error("Gemini Parsing Error:", error);
    throw new Error("Failed to parse timetable data using Gemini.");
  }
};