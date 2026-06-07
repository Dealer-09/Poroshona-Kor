"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useSocket } from "@/contexts/useSocket";

interface OnsetPrediction {
  sessionId: string;
  probability: number;
  horizonMinutes: number;
  source: "heuristic" | "lstm";
  timestamp: string;
}

/**
 * Forward-looking onset-risk gauge. Unlike the LiveScoreWidget (which shows the
 * CURRENT drift), this renders the model's predicted probability that the user
 * is about to tip into autopilot within the next few minutes — the "warning
 * system" surface. Driven by the `prediction:risk` socket event.
 */
export function OnsetRiskWidget() {
  const { socket } = useSocket();
  const [prediction, setPrediction] = useState<OnsetPrediction | null>(null);

  useEffect(() => {
    if (!socket) return;
    const handle = (payload: OnsetPrediction) => setPrediction(payload);
    socket.on("prediction:risk", handle);
    return () => {
      socket.off("prediction:risk", handle);
    };
  }, [socket]);

  const pct = prediction ? Math.round(prediction.probability * 100) : 0;

  let band = "LOW";
  let color = "bg-green-500";
  if (pct >= 70) {
    band = "HIGH";
    color = "bg-red-500";
  } else if (pct >= 40) {
    band = "RISING";
    color = "bg-yellow-400";
  }

  return (
    <div>
      <h3 className="font-black text-2xl uppercase mb-2 bg-neo-primary text-white px-2 py-1 inline-block">
        Onset Risk
      </h3>
      <p className="text-xs font-bold uppercase mb-3 text-gray-600">
        Predicted autopilot in next{" "}
        {prediction ? prediction.horizonMinutes : 5} min
      </p>

      {prediction ? (
        <>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-5xl font-black drop-shadow-[3px_3px_0_rgba(0,0,0,1)]">
              {pct}%
            </span>
            <span className="font-black uppercase border-2 border-black px-2 py-0.5 bg-white">
              {band}
            </span>
          </div>
          <div className="h-5 bg-gray-200 border-2 border-black w-full relative overflow-hidden">
            <motion.div
              className={`absolute top-0 left-0 h-full ${color} border-r-2 border-black`}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ type: "spring", stiffness: 60 }}
            />
          </div>
          <p className="text-[10px] font-bold uppercase mt-2 text-gray-500">
            Model: {prediction.source}
          </p>
        </>
      ) : (
        <p className="font-bold text-sm uppercase bg-yellow-200 px-2 py-1 border-2 border-black inline-block transform -rotate-1">
          Awaiting live session…
        </p>
      )}
    </div>
  );
}
