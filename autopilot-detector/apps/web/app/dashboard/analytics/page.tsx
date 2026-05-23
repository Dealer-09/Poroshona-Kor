import { cookies } from "next/headers";
import { CognitiveHealthMeter } from "./CognitiveHealthMeter";
import { MoodCorrelationChart } from "./MoodCorrelationChart";

export const dynamic = "force-dynamic";

interface HeatmapCell {
  day: number;
  hour: number;
  avgScore: number | null;
  interventionCount: number;
}

interface MoodEntry {
  moodRating: number;
  avgScore: number;
  createdAt: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function getHeatmapData(): Promise<HeatmapCell[]> {
  const token = (await cookies()).get("access_token")?.value;
  if (!token) return [];

  try {
    const res = await fetch(`${API_URL}/analytics/heatmap`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok) return res.json();
  } catch (e) {
    console.error("Failed to fetch heatmap data:", e);
  }
  return [];
}

async function getMoodCorrelationData(): Promise<MoodEntry[]> {
  const token = (await cookies()).get("access_token")?.value;
  if (!token) return [];

  try {
    const res = await fetch(`${API_URL}/analytics/mood-correlation`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok) return res.json();
  } catch (e) {
    console.error("Failed to fetch mood correlation data:", e);
  }
  return [];
}

export default async function AnalyticsPage() {
  const [heatmapData, moodData] = await Promise.all([
    getHeatmapData(),
    getMoodCorrelationData(),
  ]);

  return (
    <div className="w-full flex flex-col gap-8">
      <div>
        <h2 className="text-5xl font-black uppercase tracking-tighter">Cognitive Health</h2>
        <p className="text-xl font-bold border-b-4 border-black inline-block pb-1 mt-2">LONG-TERM DRIFT ANALYSIS</p>
      </div>

      <CognitiveHealthMeter data={heatmapData} />

      {/* Stage 2: Mood × Drift correlation chart */}
      <div>
        <p className="text-xl font-bold border-b-4 border-black inline-block pb-1 mb-6">MOOD CORRELATION</p>
        <MoodCorrelationChart data={moodData} />
      </div>
    </div>
  );
}
