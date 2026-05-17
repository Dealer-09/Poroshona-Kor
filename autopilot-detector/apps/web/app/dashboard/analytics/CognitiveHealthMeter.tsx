"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";

interface HeatmapCell {
  day: number;
  hour: number;
  avgScore: number | null;
  interventionCount: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CognitiveHealthMeter({ data }: { data: HeatmapCell[] }) {
  // Pre-process the data to find healthiest day and riskiest hour
  const stats = useMemo(() => {
    let healthiestDay = { day: -1, score: Infinity };
    let riskiestHour = { day: -1, hour: -1, score: -1 };

    const dayScores: number[] = new Array(7).fill(0);
    const dayCounts: number[] = new Array(7).fill(0);

    data.forEach(cell => {
      if (cell.avgScore !== null) {
        const d = cell.day;
        if (d >= 0 && d < 7) {
          dayScores[d] = (dayScores[d] || 0) + cell.avgScore;
          dayCounts[d] = (dayCounts[d] || 0) + 1;
        }

        if (cell.avgScore > riskiestHour.score) {
          riskiestHour = { day: cell.day, hour: cell.hour, score: cell.avgScore };
        }
      }
    });

    for (let d = 0; d < 7; d++) {
      const count = dayCounts[d] || 0;
      const scoreSum = dayScores[d] || 0;
      if (count > 0) {
        const avg = scoreSum / count;
        if (avg < healthiestDay.score) {
          healthiestDay = { day: d, score: avg };
        }
      }
    }

    return { healthiestDay, riskiestHour };
  }, [data]);

  const getCellColor = (score: number | null) => {
    if (score === null) return "bg-gray-100";
    if (score > 75) return "bg-red-500 text-white";
    if (score > 50) return "bg-yellow-400";
    return "bg-green-400";
  };

  const formatHour = (h: number) => {
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}${ampm}`;
  };

  // Create a 7x24 grid layout
  return (
    <div className="flex flex-col gap-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="neo-card p-6 bg-green-200">
          <h3 className="font-black text-xl uppercase mb-2">Healthiest Day</h3>
          <div className="text-4xl font-black tracking-tighter">
            {stats.healthiestDay.day !== -1 ? DAYS[stats.healthiestDay.day] : "N/A"}
          </div>
          <div className="mt-2 font-bold text-green-900 border-2 border-green-900 px-2 py-1 inline-block">
            Lowest Avg Drift
          </div>
        </div>

        <div className="neo-card p-6 bg-red-200">
          <h3 className="font-black text-xl uppercase mb-2">Riskiest Window</h3>
          <div className="text-4xl font-black tracking-tighter text-red-900">
            {stats.riskiestHour.day !== -1 ? `${DAYS[stats.riskiestHour.day]} ${formatHour(stats.riskiestHour.hour)}` : "N/A"}
          </div>
          <div className="mt-2 font-bold bg-red-900 text-white border-2 border-black px-2 py-1 inline-block">
            Peak Drift: {stats.riskiestHour.score !== -1 ? Math.round(stats.riskiestHour.score) : "N/A"}
          </div>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="neo-card p-6 bg-white overflow-x-auto">
        <h3 className="font-black text-2xl uppercase mb-6 bg-black text-white px-4 py-2 inline-block shadow-[4px_4px_0_#facc15]">
          Weekly Heatmap
        </h3>
        
        <div className="min-w-[800px]">
          <div className="grid grid-cols-[auto_repeat(24,_1fr)] gap-1">
            {/* Hour headers */}
            <div className="h-8"></div>
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={`h-${i}`} className="text-xs font-bold text-center -rotate-45 origin-bottom-left pt-4">
                {formatHour(i)}
              </div>
            ))}

            {/* Grid rows */}
            {DAYS.map((day, d) => (
              <div key={`day-row-${d}`} className="contents">
                <div className="font-bold text-sm flex items-center justify-end pr-2 h-10 uppercase">{day}</div>
                {Array.from({ length: 24 }).map((_, h) => {
                  const cell = data.find(c => c.day === d && c.hour === h) || { avgScore: null, interventionCount: 0 };
                  
                  return (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: (d * 24 + h) * 0.005, type: "spring" }}
                      key={`cell-${d}-${h}`}
                      className={`h-10 border-2 border-black transition-transform hover:scale-110 cursor-help relative group ${getCellColor(cell.avgScore)}`}
                    >
                      {cell.interventionCount > 0 && (
                        <div className="absolute -top-2 -right-2 w-4 h-4 bg-black rounded-full border-2 border-white animate-pulse" />
                      )}
                      
                      {/* Tooltip */}
                      <div className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-max bg-black text-white text-xs font-bold p-2 border-2 border-yellow-400">
                        {day} {formatHour(h)}
                        <br/>
                        Score: {cell.avgScore !== null ? Math.round(cell.avgScore) : "No data"}
                        <br/>
                        Alerts: {cell.interventionCount}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
