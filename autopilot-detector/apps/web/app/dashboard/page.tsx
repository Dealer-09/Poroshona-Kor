import { LiveScoreWidget } from "@/components/LiveScoreWidget";
import { DriftTimeline } from "@/components/DriftTimeline";
import { OnsetRiskWidget } from "@/components/OnsetRiskWidget";
import { cookies } from "next/headers";

async function getCurrentSessionId() {
  const token = (await cookies()).get("access_token")?.value;
  if (!token) return null;

  try {
    const res = await fetch(`${process.env.API_URL || "http://localhost:3001"}/sessions/current`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (res.ok) {
      const text = await res.text();
      if (!text) return null;
      const session = JSON.parse(text);
      return session?.id || null;
    }
  } catch (e) {
    console.error("Failed to fetch session:", e);
  }
  return null;
}

export default async function DashboardPage() {
  const sessionId = await getCurrentSessionId();

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-5xl font-black uppercase tracking-tighter">System Overview</h2>
        <p className="text-xl font-bold border-b-4 border-black inline-block pb-1 mt-2">LIVE METRICS & ANALYSIS</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="neo-card p-6 md:col-span-2 min-h-[300px] flex items-center justify-center bg-neo-secondary">
          <LiveScoreWidget />
        </div>
        
        <div className="neo-card p-6 min-h-[300px] flex flex-col justify-between">
          <OnsetRiskWidget />

          <div className="mt-6 space-y-3">
            <div className="flex justify-between items-center border-b-2 border-black pb-2">
              <span className="font-bold">SYSTEM</span>
              <span className="font-black text-neo-primary">ONLINE</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8">
        {sessionId ? (
          <div className="h-[400px] w-full">
            <DriftTimeline sessionId={sessionId} />
          </div>
        ) : (
          <div className="neo-card p-6 bg-white min-h-[300px] flex items-center justify-center">
            <p className="font-bold text-xl uppercase bg-yellow-300 px-4 py-2 border-4 border-black transform -rotate-1 shadow-neo">
              Start a session in the extension to view timeline
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
