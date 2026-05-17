"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface SessionData {
  appOpened: string;
  peakScore: number;
}

export function AppInfluenceChart({ sessions }: { sessions: SessionData[] }) {
  const data = useMemo(() => {
    const appMap: Record<string, { totalScore: number; count: number }> = {};

    sessions.forEach(s => {
      const app = s.appOpened.toUpperCase();
      if (!appMap[app]) {
        appMap[app] = { totalScore: 0, count: 0 };
      }
      appMap[app].totalScore += s.peakScore;
      appMap[app].count += 1;
    });

    const chartData = Object.keys(appMap).map(app => {
      const stats = appMap[app]!;
      return {
        name: app,
        avgPeakScore: Math.round(stats.totalScore / stats.count)
      };
    });

    // Sort descending by score
    chartData.sort((a, b) => b.avgPeakScore - a.avgPeakScore);

    return chartData;
  }, [sessions]);

  if (data.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center font-bold uppercase text-gray-400">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#000" vertical={false} />
        <XAxis
          dataKey="name"
          stroke="#000"
          tick={{ fill: "#000", fontWeight: "bold" }}
          axisLine={{ strokeWidth: 4 }}
        />
        <YAxis
          stroke="#000"
          domain={[0, 100]}
          tick={{ fill: "#000", fontWeight: "bold" }}
          axisLine={{ strokeWidth: 4 }}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.1)" }}
          contentStyle={{
            border: "4px solid black",
            borderRadius: 0,
            boxShadow: "4px 4px 0px 0px rgba(0,0,0,1)",
            fontWeight: "bold"
          }}
          itemStyle={{ color: "black", fontWeight: "900" }}
        />
        <Bar
          dataKey="avgPeakScore"
          fill="#ff3b30"
          stroke="#000"
          strokeWidth={4}
          animationDuration={800}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
