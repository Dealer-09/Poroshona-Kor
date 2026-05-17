import { cookies } from "next/headers";
import { SessionsTable } from "./SessionsTable";
import { CoachDailySummary } from "./CoachDailySummary";

interface SessionData {
  id: string;
  startedAt: string;
  endedAt: string | null;
  appOpened: string;
  declaredIntent: string;
  peakScore: number;
  interventionsCount: number;
  actualBehavior: string;
}

async function getSessions(): Promise<SessionData[]> {
  const token = (await cookies()).get("access_token")?.value;
  if (!token) return [];

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (res.ok) {
      return res.json();
    }
  } catch (e) {
    console.error("Failed to fetch sessions:", e);
  }
  return [];
}

export default async function SessionsPage() {
  const sessions = await getSessions();

  return (
    <div className="w-full flex flex-col gap-8">
      <div>
        <h2 className="text-5xl font-black uppercase tracking-tighter">Session History</h2>
        <p className="text-xl font-bold border-b-4 border-black inline-block pb-1 mt-2">TELEMETRY ARCHIVE</p>
      </div>

      <div className="neo-card p-6 bg-neo-secondary">
        <h3 className="font-black text-2xl uppercase mb-6 bg-black text-white px-4 py-2 inline-block transform rotate-1 shadow-[4px_4px_0_#ff3b30]">
          Coach&apos;s Daily Summary
        </h3>
        
        <div className="min-h-[150px] border-4 border-black bg-white p-6">
          <CoachDailySummary />
        </div>
      </div>

      <div className="neo-card p-6 bg-white overflow-hidden">
        <h3 className="font-black text-2xl uppercase mb-6 bg-black text-white px-4 py-2 inline-block transform -rotate-1 shadow-[4px_4px_0_#facc15]">
          All Sessions
        </h3>
        
        <div className="overflow-x-auto border-4 border-black">
          <SessionsTable sessions={sessions} />
        </div>
      </div>
    </div>
  );
}
