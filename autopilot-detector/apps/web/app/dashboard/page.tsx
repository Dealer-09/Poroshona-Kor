export default function DashboardPage() {
  return (
    <div>
      <div className="mb-8">
        <h2 className="text-5xl font-black uppercase tracking-tighter">System Overview</h2>
        <p className="text-xl font-bold border-b-4 border-black inline-block pb-1 mt-2">LIVE METRICS & ANALYSIS</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="neo-card p-6 md:col-span-2 min-h-[300px] flex items-center justify-center bg-neo-secondary">
          <p className="font-bold text-2xl uppercase border-4 border-black px-4 py-2 bg-white transform -rotate-1">
            [ LIVE SCORE WIDGET PENDING ]
          </p>
        </div>
        
        <div className="neo-card p-6 min-h-[300px] flex flex-col justify-between">
          <div>
            <h3 className="font-black text-2xl uppercase mb-2 bg-neo-primary text-white px-2 py-1 inline-block">STATUS</h3>
            <div className="mt-4 space-y-4">
              <div className="flex justify-between items-center border-b-2 border-black pb-2">
                <span className="font-bold">SYSTEM</span>
                <span className="font-black text-neo-primary">ONLINE</span>
              </div>
              <div className="flex justify-between items-center border-b-2 border-black pb-2">
                <span className="font-bold">INTERVENTIONS</span>
                <span className="font-black text-neo-accent">ACTIVE</span>
              </div>
            </div>
          </div>
          
          <div className="mt-8">
            <button className="neo-btn-accent w-full text-lg">RUN DIAGNOSTICS</button>
          </div>
        </div>
      </div>
    </div>
  );
}
