'use client';

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface MoodEntry {
  moodRating: number;
  avgScore: number;
  createdAt: string;
}

const MOOD_LABELS: Record<number, string> = {
  1: '😩 Drained',
  2: '😕 Meh',
  3: '😐 Neutral',
  4: '🙂 Good',
  5: '😄 Energized',
};

function getDotColor(avgScore: number): string {
  if (avgScore > 60) return '#ef4444'; // red
  if (avgScore > 40) return '#f59e0b'; // amber
  return '#22c55e'; // green
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { payload: MoodEntry }[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  if (!first) return null;
  const d = first.payload;
  const date = new Date(d.createdAt).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
  });
  return (
    <div
      style={{
        background: '#fff',
        border: '2px solid #000',
        padding: '10px 14px',
        fontFamily: 'monospace',
        fontSize: '13px',
        fontWeight: 700,
      }}
    >
      <div>Mood: {MOOD_LABELS[d.moodRating] ?? d.moodRating}</div>
      <div>Drift Score: {Math.round(d.avgScore)}</div>
      <div style={{ color: '#64748b', fontWeight: 400 }}>Date: {date}</div>
    </div>
  );
}

export function MoodCorrelationChart({ data }: { data: MoodEntry[] }) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          border: '3px solid #000',
          padding: '40px',
          textAlign: 'center',
          fontFamily: 'monospace',
          fontWeight: 700,
          color: '#64748b',
        }}
      >
        No mood data yet. End a session and rate your mood to see correlations here.
      </div>
    );
  }

  return (
    <div
      style={{
        border: '3px solid #000',
        padding: '24px',
        background: '#fff',
      }}
    >
      <div
        style={{
          fontFamily: 'monospace',
          fontWeight: 900,
          fontSize: '18px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '4px',
        }}
      >
        MOOD × DRIFT CORRELATION
      </div>
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#64748b',
          marginBottom: '24px',
          fontWeight: 700,
        }}
      >
        Each dot = one session. Do high-drift sessions leave you feeling drained?
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis
            dataKey="moodRating"
            type="number"
            domain={[0.5, 5.5]}
            ticks={[1, 2, 3, 4, 5]}
            tickFormatter={(v) => MOOD_LABELS[v]?.split(' ')[0] ?? v}
            label={{
              value: 'MOOD AFTER SESSION',
              position: 'insideBottom',
              offset: -15,
              style: { fontFamily: 'monospace', fontWeight: 700, fontSize: 12, textTransform: 'uppercase' },
            }}
          />
          <YAxis
            dataKey="avgScore"
            type="number"
            domain={[0, 100]}
            label={{
              value: 'AVG DRIFT SCORE',
              angle: -90,
              position: 'insideLeft',
              style: { fontFamily: 'monospace', fontWeight: 700, fontSize: 12, textTransform: 'uppercase' },
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={60}
            stroke="#ef4444"
            strokeDasharray="6 3"
            label={{
              value: 'DANGER ZONE',
              position: 'right',
              style: { fontFamily: 'monospace', fontWeight: 700, fontSize: 11, fill: '#ef4444' },
            }}
          />
          <Scatter data={data} fill="#000">
            {data.map((entry, index) => (
              <Cell key={index} fill={getDotColor(entry.avgScore)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginTop: '16px',
          fontFamily: 'monospace',
          fontSize: '12px',
          fontWeight: 700,
        }}
      >
        <span><span style={{ color: '#22c55e' }}>●</span> Low drift (&lt;40)</span>
        <span><span style={{ color: '#f59e0b' }}>●</span> Moderate (40–60)</span>
        <span><span style={{ color: '#ef4444' }}>●</span> High drift (&gt;60)</span>
      </div>
    </div>
  );
}
