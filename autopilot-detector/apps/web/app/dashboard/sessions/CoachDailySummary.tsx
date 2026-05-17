"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Sparkles } from "lucide-react";

export function CoachDailySummary() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;

    fetch("http://localhost:3001/ai/daily-summary", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setSummary(data.summary))
      .catch((err) => {
        console.error("Failed to load daily summary", err);
        setSummary("Coach could not generate a summary right now.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="h-full flex flex-col justify-center">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-3 bg-black text-[#facc15] shadow-neo border-2 border-black">
          <Sparkles className="w-6 h-6" />
        </div>
        <h4 className="font-black text-xl uppercase tracking-tight">AI Coach Insight</h4>
      </div>

      {loading ? (
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-4 border-neo-primary border-t-transparent rounded-full animate-spin" />
          <span className="font-bold text-neo-muted">Analyzing your day...</span>
        </div>
      ) : (
        <p className="text-lg font-medium leading-relaxed bg-neo-surface p-4 border-l-4 border-neo-primary">
          {summary}
        </p>
      )}
    </div>
  );
}
