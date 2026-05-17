"use client";

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

export function SessionsTable({ sessions }: { sessions: SessionData[] }) {
  if (sessions.length === 0) {
    return (
      <div className="p-8 text-center font-bold text-xl uppercase bg-gray-100">
        No sessions recorded yet. Start tracking to see history.
      </div>
    );
  }

  return (
    <table className="w-full text-left border-collapse min-w-[800px]">
      <thead>
        <tr className="bg-neo-primary text-white text-lg uppercase tracking-wider">
          <th className="p-4 border-b-4 border-black">Date</th>
          <th className="p-4 border-b-4 border-l-4 border-black">App</th>
          <th className="p-4 border-b-4 border-l-4 border-black">Intent</th>
          <th className="p-4 border-b-4 border-l-4 border-black">Behavior</th>
          <th className="p-4 border-b-4 border-l-4 border-black">Peak Score</th>
          <th className="p-4 border-b-4 border-l-4 border-black">Alerts</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session, i) => {
          const date = new Date(session.startedAt);
          const isRed = session.peakScore > 75;
          const isYellow = session.peakScore > 50 && !isRed;
          
          return (
            <tr 
              key={session.id} 
              className={`font-bold transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-100'} hover:bg-yellow-200`}
            >
              <td className="p-4 border-b-4 border-black">
                {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </td>
              <td className="p-4 border-b-4 border-l-4 border-black uppercase text-blue-600">
                {session.appOpened}
              </td>
              <td className="p-4 border-b-4 border-l-4 border-black italic">
                &quot;{session.declaredIntent}&quot;
              </td>
              <td className="p-4 border-b-4 border-l-4 border-black uppercase tracking-wider">
                <span className={`px-2 py-1 border-2 border-black ${
                  session.actualBehavior === 'Study' ? 'bg-green-300' :
                  session.actualBehavior === 'Entertainment' ? 'bg-purple-300' :
                  session.actualBehavior === 'Doomscrolling' ? 'bg-red-400 text-white' : 'bg-yellow-300'
                }`}>
                  {session.actualBehavior}
                </span>
              </td>
              <td className="p-4 border-b-4 border-l-4 border-black text-center text-xl">
                <span className={isRed ? 'text-red-600 font-black' : isYellow ? 'text-yellow-600' : 'text-green-600'}>
                  {Math.round(session.peakScore)}
                </span>
              </td>
              <td className="p-4 border-b-4 border-l-4 border-black text-center">
                {session.interventionsCount > 0 ? (
                  <span className="bg-black text-white px-3 py-1 rounded-full">{session.interventionsCount}</span>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
