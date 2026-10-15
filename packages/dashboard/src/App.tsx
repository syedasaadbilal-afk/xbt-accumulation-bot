import { XbtTab } from "./components/XbtTab.js";

export default function App() {
  return (
    <div className="min-h-screen bg-ink-950 text-slate-100">
      <nav className="flex items-center gap-2 bg-ink-900 border-b border-slate-800 px-6 py-3">
        <span className="text-xl" aria-hidden>
          🪙
        </span>
        <span className="font-semibold text-slate-100 tracking-wide">XBT Accumulation Bot</span>
        <span className="text-xs text-slate-500 ml-2">Neoxa Exchange · XBT/BTC</span>
      </nav>
      <XbtTab />
    </div>
  );
}
