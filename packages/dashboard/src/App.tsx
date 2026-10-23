import { useState } from "react";
import { LarssonTab } from "./components/LarssonTab.js";
import { XbtTab } from "./components/XbtTab.js";

type Tab = "dca" | "larsson";

export default function App() {
  const [tab, setTab] = useState<Tab>("dca");
  const tabCls = (t: Tab) =>
    `px-3 py-1.5 rounded text-sm font-medium border ${tab === t ? "bg-slate-800 text-slate-100 border-slate-600" : "text-slate-400 border-transparent hover:text-slate-200"}`;
  return (
    <div className="min-h-screen bg-ink-950 text-slate-100">
      <nav className="flex items-center gap-2 bg-ink-900 border-b border-slate-800 px-6 py-3">
        <span className="text-xl" aria-hidden>
          🪙
        </span>
        <span className="font-semibold text-slate-100 tracking-wide">XBT Accumulation Bot</span>
        <span className="text-xs text-slate-500 ml-2">Neoxa Exchange · XBT/BTC</span>
        <div className="ml-6 flex gap-1">
          <button className={tabCls("dca")} onClick={() => setTab("dca")}>
            Accumulation
          </button>
          <button className={tabCls("larsson")} onClick={() => setTab("larsson")}>
            Larsson
          </button>
        </div>
      </nav>
      {tab === "dca" ? <XbtTab /> : <LarssonTab />}
    </div>
  );
}
