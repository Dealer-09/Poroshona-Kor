"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useSocket } from "@/contexts/useSocket";

interface ScoreData {
  score: number;
  focusFragmentation: number;
  passiveRatio: number;
  cognitiveDrift: number;
  doomscrollProbability: number;
  timestamp: string;
}

export function LiveScoreWidget() {
  const { socket, isConnected } = useSocket();
  const [data, setData] = useState<ScoreData>({
    score: 0,
    focusFragmentation: 0,
    passiveRatio: 0,
    cognitiveDrift: 0,
    doomscrollProbability: 0,
    timestamp: new Date().toISOString(),
  });

  useEffect(() => {
    if (!socket) return;

    const handleScoreUpdate = (payload: ScoreData) => {
      setData(payload);
    };

    socket.on("score:update", handleScoreUpdate);

    return () => {
      socket.off("score:update", handleScoreUpdate);
    };
  }, [socket]);

  // Determine color based on score thresholds
  let scoreColor = "text-green-500";
  let strokeColor = "#22c55e"; // green
  if (data.score > 70) {
    scoreColor = "text-neo-primary";
    strokeColor = "#ff3b30"; // cyberpunk red
  } else if (data.score > 40) {
    scoreColor = "text-neo-secondary";
    strokeColor = "#ffcc00"; // caution yellow
  }

  // Calculate SVG stroke dasharray logic
  const circumference = 2 * Math.PI * 120; // r=120
  const strokeDashoffset = circumference - (data.score / 100) * circumference;

  return (
    <div className="flex flex-col md:flex-row items-center w-full gap-8">
      {/* Circular Gauge */}
      <div className="relative flex justify-center items-center">
        <svg width="300" height="300" className="transform -rotate-90">
          {/* Manual Brutalist Drop Shadow (solid block shadow) */}
          <circle cx="154" cy="154" r="140" fill="black" />
          
          {/* Main Background Circle */}
          <circle cx="150" cy="150" r="140" fill="#facc15" stroke="black" strokeWidth="8" />

          {/* Dashed outer ring - calculated to fit perfectly (Circumference ~879.6, divided by 44 dashes = 19.99) */}
          <circle 
            cx="150" 
            cy="150" 
            r="130" 
            stroke="black" 
            strokeWidth="6" 
            fill="transparent" 
            strokeDasharray="10 9.99" 
          />

          {/* White track for the progress bar */}
          <circle
            cx="150"
            cy="150"
            r="105"
            stroke="white"
            strokeWidth="16"
            fill="transparent"
            stroke="black"
          />
          <circle
            cx="150"
            cy="150"
            r="105"
            stroke="white"
            strokeWidth="12"
            fill="transparent"
          />
          
          {/* Animated progress circle */}
          <motion.circle
            cx="150"
            cy="150"
            r="105"
            stroke={strokeColor}
            strokeWidth="12"
            fill="transparent"
            strokeLinecap="butt"
            initial={{ strokeDashoffset: 2 * Math.PI * 105 }}
            animate={{ strokeDashoffset: (2 * Math.PI * 105) - (data.score / 100) * (2 * Math.PI * 105) }}
            transition={{ type: "spring", stiffness: 50, damping: 15 }}
            style={{ strokeDasharray: 2 * Math.PI * 105 }}
            className="transition-colors duration-500"
          />
        </svg>

        <div className="absolute flex flex-col items-center justify-center">
          <span className="text-xl font-black uppercase tracking-widest">Score</span>
          <motion.span 
            key={data.score}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`text-6xl font-black ${scoreColor} drop-shadow-[2px_2px_0_rgba(0,0,0,1)]`}
          >
            {Math.round(data.score)}
          </motion.span>
        </div>
      </div>

      {/* Sub-metrics */}
      <div className="flex-1 w-full space-y-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-2xl font-black uppercase bg-black text-white px-3 py-1 inline-block transform -rotate-1">
            Signal Telemetry
          </h3>
          <div className="flex items-center gap-2 font-bold border-2 border-black px-2 py-1 bg-white">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse border border-black`} />
            {isConnected ? "LIVE" : "OFFLINE"}
          </div>
        </div>

        <MetricBar label="Focus Fragmentation" value={Math.min(100, data.focusFragmentation)} color="bg-blue-500" />
        <MetricBar label="Passive Ratio" value={data.passiveRatio * 100} color="bg-purple-500" />
        <MetricBar label="Cognitive Drift" value={data.cognitiveDrift * 100} color="bg-orange-500" />
      </div>
    </div>
  );
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="border-4 border-black bg-white p-3 shadow-neo-sm">
      <div className="flex justify-between font-bold mb-2 uppercase text-sm">
        <span>{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <div className="h-4 bg-gray-200 border-2 border-black w-full relative overflow-hidden">
        <motion.div
          className={`absolute top-0 left-0 h-full ${color} border-r-2 border-black`}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ type: "spring", stiffness: 60 }}
        />
      </div>
    </div>
  );
}
