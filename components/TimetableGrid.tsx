import React from 'react';
import { TimetableData, TimetableEvent } from '../types';

interface Props {
  data: TimetableData;
}

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const timeSlots = Array.from({ length: 14 }, (_, i) => i + 8); // 08:00 to 21:00

const TimetableGrid: React.FC<Props> = ({ data }) => {
  
  // Helper to parse HH:MM to grid row position
  const getGridRow = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    const startHour = 8;
    // Assume 1 hour = 2 grid rows (30 min blocks) or just 1 row per hour?
    // Let's do accurate positioning based on pixels or percentages, 
    // but for Grid CSS, let's assume 1 row = 30 minutes.
    // 08:00 is row 1. 
    // (Hour - 8) * 2 + (Minutes / 30) + 1 (header offset)
    
    // Simplified: Just 1 hour blocks for this visualization to fit easily
    return (hours - startHour) + 2; 
  };

  const getDurationSpan = (start: string, end: string): number => {
      const [h1, m1] = start.split(':').map(Number);
      const [h2, m2] = end.split(':').map(Number);
      const diffHours = (h2 + m2/60) - (h1 + m1/60);
      return Math.ceil(diffHours); // Span rows
  };
  
  // Helper to map Day string to Column index
  const getDayColumn = (day: string) => {
    const index = days.findIndex(d => d.toLowerCase() === day.toLowerCase());
    return index !== -1 ? index + 2 : -1; // +2 because Col 1 is time labels
  };

  const colors = [
    "bg-red-100 border-red-300 text-red-800",
    "bg-orange-100 border-orange-300 text-orange-800",
    "bg-amber-100 border-amber-300 text-amber-800",
    "bg-green-100 border-green-300 text-green-800",
    "bg-emerald-100 border-emerald-300 text-emerald-800",
    "bg-teal-100 border-teal-300 text-teal-800",
    "bg-cyan-100 border-cyan-300 text-cyan-800",
    "bg-sky-100 border-sky-300 text-sky-800",
    "bg-blue-100 border-blue-300 text-blue-800",
    "bg-indigo-100 border-indigo-300 text-indigo-800",
    "bg-violet-100 border-violet-300 text-violet-800",
    "bg-purple-100 border-purple-300 text-purple-800",
    "bg-fuchsia-100 border-fuchsia-300 text-fuchsia-800",
    "bg-pink-100 border-pink-300 text-pink-800",
    "bg-rose-100 border-rose-300 text-rose-800",
  ];

  // Assign a stable color based on subject name
  const getColor = (subject: string) => {
    let hash = 0;
    for (let i = 0; i < subject.length; i++) {
      hash = subject.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  return (
    <div className="w-full h-full overflow-auto bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white z-20">
        <h2 className="text-xl font-bold text-slate-800">{data.scheduleName || "My Timetable"}</h2>
      </div>
      
      <div className="min-w-[800px] p-4">
        {/* Header Row */}
        <div className="grid grid-cols-8 gap-2 mb-2">
          <div className="text-center text-xs font-semibold text-slate-400 uppercase py-2">Time</div>
          {days.map(day => (
            <div key={day} className="text-center font-semibold text-slate-700 py-2 bg-slate-50 rounded-lg">
              {day.substring(0, 3)}
            </div>
          ))}
        </div>

        {/* Grid Body */}
        <div className="relative grid grid-cols-8 gap-2" style={{ gridTemplateRows: `repeat(${timeSlots.length}, minmax(80px, 1fr))` }}>
          
          {/* Time Labels (Col 1) */}
          {timeSlots.map((hour, idx) => (
            <div key={hour} className="row-span-1 flex flex-col justify-start items-center text-xs text-slate-400 border-t border-slate-100 pt-2" style={{ gridRow: idx + 1, gridColumn: 1 }}>
              <span>{String(hour).padStart(2, '0')}:00</span>
            </div>
          ))}

          {/* Grid Lines/Background */}
          {timeSlots.map((_, rIdx) => (
            days.map((_, cIdx) => (
              <div 
                key={`cell-${rIdx}-${cIdx}`} 
                className="border-t border-slate-50 h-full w-full" 
                style={{ gridRow: rIdx + 1, gridColumn: cIdx + 2 }}
              />
            ))
          ))}

          {/* Events */}
          {data.events.map((evt, idx) => {
            const col = getDayColumn(evt.day);
            if (col === -1) return null;
            
            // Simple logic: Assuming clean hours. 
            // In a real app, calculate pixel offset for minutes.
            const [startH] = evt.startTime.split(':').map(Number);
            const rowStart = (startH - 8) + 1; // 1-based index
            const span = getDurationSpan(evt.startTime, evt.endTime);

            return (
              <div
                key={idx}
                className={`p-2 rounded-lg border text-sm flex flex-col justify-between overflow-hidden transition hover:scale-[1.02] hover:shadow-md cursor-pointer ${getColor(evt.subject)}`}
                style={{
                  gridColumn: col,
                  gridRow: `${rowStart} / span ${span > 0 ? span : 1}`,
                  zIndex: 10
                }}
                title={`${evt.startTime} - ${evt.endTime}\n${evt.location}`}
              >
                <div>
                  <div className="font-bold leading-tight">{evt.subject}</div>
                  <div className="text-xs opacity-80 mt-1 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    {evt.location || 'TBD'}
                  </div>
                </div>
                <div className="text-xs font-mono opacity-70 mt-auto">
                  {evt.startTime}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TimetableGrid;
