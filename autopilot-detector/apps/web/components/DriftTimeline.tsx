"use client";

import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useSocket } from "@/contexts/useSocket";

interface ScoreData {
  score: number;
  timestamp: string;
}

interface DriftTimelineProps {
  sessionId: string;
}

export function DriftTimeline({ sessionId }: DriftTimelineProps) {
  const { token } = useAuth();
  const { socket } = useSocket();
  const [data, setData] = useState<{ time: string; score: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !sessionId) return;

    const fetchScores = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/sessions/${sessionId}/scores`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const scores: ScoreData[] = await res.json();
          const formatted = scores.map((s) => {
            const d = new Date(s.timestamp);
            return {
              time: `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`,
              score: s.score,
            };
          });
          setData(formatted);
        }
      } catch (err) {
        console.error("Failed to load scores:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchScores();
  }, [token, sessionId]);

  useEffect(() => {
    if (!socket) return;
    
    const handleScoreUpdate = (scoreData: any) => {
      if (scoreData.sessionId === sessionId) {
        setData((prev) => {
          const d = new Date(scoreData.timestamp);
          const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
          return [...prev, { time, score: scoreData.score }];
        });
      }
    };

    socket.on("score:update", handleScoreUpdate);
    return () => {
      socket.off("score:update", handleScoreUpdate);
    };
  }, [socket, sessionId]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-neo-surface border-4 border-black shadow-neo">
        <p className="font-black text-xl uppercase animate-pulse">Loading Telemetry...</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-neo-surface border-4 border-black shadow-neo">
        <p className="font-bold text-lg uppercase bg-yellow-300 px-2 py-1 transform rotate-2 border-2 border-black">
          No telemetry available yet
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-white border-4 border-black shadow-neo p-4 flex flex-col">
      <h3 className="text-xl font-black uppercase mb-4 bg-black text-white px-3 py-1 inline-block self-start">
        Drift Timeline
      </h3>
      <div className="flex-1 min-h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#000" vertical={false} />
            <XAxis dataKey="time" stroke="#000" tick={{ fill: "#000", fontWeight: "bold" }} axisLine={{ strokeWidth: 4 }} />
            <YAxis stroke="#000" domain={[0, 100]} tick={{ fill: "#000", fontWeight: "bold" }} axisLine={{ strokeWidth: 4 }} />
            <Tooltip 
              contentStyle={{ border: "4px solid black", borderRadius: 0, boxShadow: "4px 4px 0px 0px rgba(0,0,0,1)", fontWeight: "bold" }}
              itemStyle={{ color: "black", fontWeight: "900" }}
            />
            {/* Threshold Lines */}
            <ReferenceLine y={60} stroke="#ffcc00" strokeWidth={3} strokeDasharray="5 5" label={{ position: 'insideTopLeft', value: 'NUDGE (60)', fill: '#ffcc00', fontWeight: 'bold' }} />
            <ReferenceLine y={75} stroke="#ff3b30" strokeWidth={3} strokeDasharray="5 5" label={{ position: 'insideTopLeft', value: 'PAUSE (75)', fill: '#ff3b30', fontWeight: 'bold' }} />
            
            <Area 
              type="monotone" 
              dataKey="score" 
              stroke="#000" 
              strokeWidth={4} 
              fill="#22c55e" 
              fillOpacity={1}
              isAnimationActive={true}
              animationDuration={800}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
