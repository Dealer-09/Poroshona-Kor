import { ReflectionChat } from "@/components/ReflectionChat";

export default function CoachPage() {
  return (
    <div className="w-full h-[calc(100vh-80px)] flex flex-col gap-4">
      <div>
        <h2 className="text-5xl font-black uppercase tracking-tighter">AI Coach</h2>
        <p className="text-xl font-bold border-b-4 border-black inline-block pb-1 mt-2">COGNITIVE REFLECTION</p>
      </div>

      <div className="flex-1 bg-neo-surface border-4 border-black shadow-neo overflow-hidden flex flex-col">
        <div className="bg-black text-white p-4 flex justify-between items-center border-b-4 border-black">
          <h3 className="font-black text-2xl uppercase tracking-widest">Secure Comms link</h3>
          <div className="flex items-center gap-2 font-bold bg-white text-black px-2 py-1 transform rotate-1">
            <div className="w-3 h-3 rounded-full bg-neo-primary animate-pulse border-2 border-black" />
            READY
          </div>
        </div>
        
        <div className="flex-1 relative bg-white">
          <ReflectionChat />
        </div>
      </div>
    </div>
  );
}
