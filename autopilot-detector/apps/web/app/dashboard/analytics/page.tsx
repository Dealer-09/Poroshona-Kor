import { cookies } from "next/headers";
import { CognitiveHealthMeter } from "./CognitiveHealthMeter";

export const dynamic = "force-dynamic";

interface HeatmapCell {
  day: number;
  hour: number;
  avgScore: number | null;
  interventionCount: number;
}

async function getHeatmapData(): Promise<HeatmapCell[]> {
  const token = (await cookies()).get("access_token")?.value;
  if (!token) return [];

  try {
    const res = await fetch("http://localhost:3001/analytics/heatmap", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (res.ok) {
      return res.json();
    }
  } catch (e) {
    console.error("Failed to fetch heatmap data:", e);
  }
  return [];
}

export default async function AnalyticsPage() {
  const data = await getHeatmapData();

  return (
    <div className="w-full flex flex-col gap-8">
      <div>
        <h2 className="text-5xl font-black uppercase tracking-tighter">Cognitive Health</h2>
        <p className="text-xl font-bold border-b-4 border-black inline-block pb-1 mt-2">LONG-TERM DRIFT ANALYSIS</p>
      </div>

      <CognitiveHealthMeter data={data} />
    </div>
  );
}
