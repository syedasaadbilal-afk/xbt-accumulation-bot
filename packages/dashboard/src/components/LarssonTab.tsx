import { useEffect, useState } from "react";
import { fetchLarsson, saveLarssonConfig, type LarssonBarDto, type LarssonStatus, type LarssonTradeDto } from "../api.js";

const inputCls = "bg-ink-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-slate-200 w-28";
const btnCls = "px-3 py-1.5 rounded text-sm font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50 border border-slate-700";

const fmtP = (n: number | null | undefined) => (n === null || n === undefined ? "-" : n.toFixed(8));
const fmtDate = (s: number | null) => (s === null ? "-" : new Date(s * 1000).toISOString().slice(0, 10));
const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const pctCls = (n: number | null | undefined) => (n === null || n === undefined ? "text-slate-500" : n >= 0 ? "text-emerald-400" : "text-red-400");

const REGIME_COLOR = { orange: "#f59e0b", navy: "#3b82f6", gray: "#94a3b8" } as const;

function Stat({ label, value, cls = "text-slate-200" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="bg-ink-900 border border-slate-800 rounded-lg p-3">
      <div className="text-[11px] tracking-wider text-slate-500 uppercase mb-1">{label}</div>
      <div className={`text-lg font-semibold font-mono ${cls}`}>{value}</div>
    </div>
  );
}

function Chart({ bars, signals }: { bars: LarssonBarDto[]; signals: LarssonStatus["signals"] }) {
  const W = 960;
  const H = 340;
  const padL = 8;
  const padR = 70;
  const padT = 12;
  const padB = 24;
  if (bars.length < 2) return <div className="text-sm text-slate-500">Not enough candles yet.</div>;
  const vals: number[] = [];
  for (const b of bars) {
    vals.push(b.high, b.low);
    if (b.v1 !== null) vals.push(b.v1);
    if (b.v2 !== null) vals.push(b.v2);
  }
  // Ignore absurd listing-day wicks when scaling so the lines stay readable.
  const sorted = [...vals].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.01)] ?? sorted[0]!;
  const hi = sorted[Math.ceil(sorted.length * 0.99) - 1] ?? sorted[sorted.length - 1]!;
  const span = Math.max(hi - lo, 1e-12);
  const min = lo - span * 0.05;
  const max = hi + span * 0.05;
  const x = (i: number) => padL + (i / (bars.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (Math.min(Math.max(v, min), max) - min) / (max - min)) * (H - padT - padB);
  const cw = Math.max(1.5, ((W - padL - padR) / bars.length) * 0.6);
  const idxByTime = new Map(bars.map((b, i) => [b.time, i]));

  // Regime-coloured channel: a polygon per run of identical regime between v1 and v2.
  const bands: Array<{ regime: keyof typeof REGIME_COLOR; from: number; to: number }> = [];
  bars.forEach((b, i) => {
    if (!b.regime || b.v1 === null || b.v2 === null) return;
    const last = bands[bands.length - 1];
    if (last && last.regime === b.regime && last.to === i - 1) last.to = i;
    else bands.push({ regime: b.regime, from: i, to: i });
  });
  const line = (key: "v1" | "v2", from: number, to: number) =>
    bars
      .slice(from, to + 1)
      .map((b, k) => `${k === 0 ? "M" : "L"}${x(from + k).toFixed(1)},${y(b[key] as number).toFixed(1)}`)
      .join(" ");
  const poly = (from: number, to: number) => {
    const top = bars.slice(from, to + 1).map((b, k) => `${x(from + k).toFixed(1)},${y(b.v1 as number).toFixed(1)}`);
    const bot = bars
      .slice(from, to + 1)
      .map((b, k) => `${x(from + k).toFixed(1)},${y(b.v2 as number).toFixed(1)}`)
      .reverse();
    return [...top, ...bot].join(" ");
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
  const labelEvery = Math.ceil(bars.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="XBT/BTC daily candles with Larsson lines">
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#1e293b" strokeWidth={1} />
          <text x={W - padR + 6} y={y(t) + 4} fontSize={10} fill="#64748b" fontFamily="monospace">
            {t.toFixed(6)}
          </text>
        </g>
      ))}
      {bands.map((b, k) => (
        <polygon key={k} points={poly(b.from, b.to)} fill={REGIME_COLOR[b.regime]} fillOpacity={0.2} />
      ))}
      {bars.map((b, i) => {
        const up = b.close >= b.open;
        const c = up ? "#34d399" : "#f87171";
        return (
          <g key={b.time} opacity={b.confirmed ? 1 : 0.5}>
            <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} stroke={c} strokeWidth={1} />
            <rect x={x(i) - cw / 2} y={Math.min(y(b.open), y(b.close))} width={cw} height={Math.max(1, Math.abs(y(b.open) - y(b.close)))} fill={c} />
          </g>
        );
      })}
      {bands.map((b, k) => (
        <g key={`l${k}`}>
          <path d={line("v1", b.from, b.to)} fill="none" stroke={REGIME_COLOR[b.regime]} strokeWidth={1.6} />
          <path d={line("v2", b.from, b.to)} fill="none" stroke={REGIME_COLOR[b.regime]} strokeWidth={2.4} />
        </g>
      ))}
      {signals.map((s) => {
        const i = idxByTime.get(s.signalBarTime);
        if (i === undefined) return null;
        const enter = s.action === "enter";
        const cy = enter ? y(bars[i]!.low) + 14 : y(bars[i]!.high) - 14;
        return (
          <g key={`${s.signalBarTime}${s.action}`}>
            <polygon
              points={enter ? `${x(i)},${cy - 7} ${x(i) - 6},${cy + 4} ${x(i) + 6},${cy + 4}` : `${x(i)},${cy + 7} ${x(i) - 6},${cy - 4} ${x(i) + 6},${cy - 4}`}
              fill={enter ? "#34d399" : "#f87171"}
            />
          </g>
        );
      })}
      {bars.map((b, i) =>
        i % labelEvery === 0 ? (
          <text key={`t${b.time}`} x={x(i)} y={H - 6} fontSize={10} fill="#64748b" textAnchor="middle" fontFamily="monospace">
            {fmtDate(b.time).slice(5)}
          </text>
        ) : null
      )}
    </svg>
  );
}

function TradeRow({ t }: { t: LarssonTradeDto }) {
  const gap = t.signalReturnPct !== null && t.actualReturnPct !== null ? t.actualReturnPct - t.signalReturnPct : null;
  return (
    <tr className="border-t border-slate-800">
      <td className="py-1.5 pr-3 text-slate-300">{t.status === "open" ? "open" : "closed"}</td>
      <td className="py-1.5 pr-3 font-mono">{fmtDate(t.entryTime)}</td>
      <td className="py-1.5 pr-3 font-mono">{fmtDate(t.exitTime)}</td>
      <td className="py-1.5 pr-3 font-mono text-right">{fmtP(t.entrySignal)}</td>
      <td className="py-1.5 pr-3 font-mono text-right">{fmtP(t.entryActual)}</td>
      <td className="py-1.5 pr-3 font-mono text-right">{t.status === "open" ? "mark" : fmtP(t.exitSignal)}</td>
      <td className="py-1.5 pr-3 font-mono text-right">{t.status === "open" ? "bid" : fmtP(t.exitActual)}</td>
      <td className={`py-1.5 pr-3 font-mono text-right ${pctCls(t.signalReturnPct)}`}>{fmtPct(t.signalReturnPct)}</td>
      <td className={`py-1.5 pr-3 font-mono text-right ${pctCls(t.actualReturnPct)}`}>{fmtPct(t.actualReturnPct)}</td>
      <td className={`py-1.5 font-mono text-right ${pctCls(gap)}`}>{fmtPct(gap)}</td>
    </tr>
  );
}

export function LarssonTab() {
  const [s, setS] = useState<LarssonStatus | undefined>(undefined);
  const [enabled, setEnabled] = useState(true);
  const [size, setSize] = useState("0.25");
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);

  async function reload(initial = false) {
    const r = await fetchLarsson();
    setS(r);
    if (r && initial) {
      setEnabled(r.config.enabled);
      setSize(String(r.config.paperSizeXbt));
      setLoaded(true);
    }
  }
  useEffect(() => {
    void reload(true);
    const id = setInterval(() => void reload(), 60_000);
    return () => clearInterval(id);
  }, []);

  async function save() {
    const n = Number(size);
    if (!Number.isFinite(n) || n <= 0) {
      setNote("Paper size must be a number above 0.");
      return;
    }
    const r = await saveLarssonConfig(enabled, n);
    setNote(r.ok ? "Saved." : (r.error ?? "Save failed"));
    if (r.ok) void reload(true);
  }

  if (!s) return <div className="p-6 text-slate-400">Loading Larsson data...</div>;
  const regime = s.current?.regime ?? null;
  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      {s.error && <div className="bg-red-950/40 border border-red-900 rounded p-3 text-sm text-red-300">{s.error}</div>}
      {s.warmup && (
        <div className="bg-amber-950/30 border border-amber-900 rounded p-3 text-sm text-amber-200">
          Only {s.barsCount} daily bars so far (about {s.reliableBars} are needed before the lines are reliable). Treat signals as informational.
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Regime (last confirmed close)"
          value={regime ?? "n/a"}
          cls={regime === "orange" ? "text-amber-400" : regime === "navy" ? "text-blue-400" : "text-slate-300"}
        />
        <Stat label="Paper position" value={s.holding ? "XBT" : "BTC"} />
        <Stat label="Distance to baseline" value={s.current?.dist == null ? "-" : fmtPct(s.current.dist * 100)} />
        <Stat label="Bars (daily)" value={String(s.barsCount)} />
      </div>
      <div className="bg-ink-900 border border-slate-800 rounded-lg p-3">
        <h3 className="text-xs font-semibold tracking-wider text-slate-300 uppercase mb-2">
          XBT/BTC daily · Larsson lines (15 fast / 29 baseline SMMA of hl2) · plain version
        </h3>
        <Chart bars={s.bars} signals={s.signals} />
        <p className="text-xs text-slate-500 mt-2">
          Orange = hold XBT, navy/gray = hold BTC. Arrows mark the confirmed-close signal (green up = enter XBT, red down = exit to BTC); the faded last candle is still forming.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Paper trades" value={`${s.summary.trades} (${s.summary.closed} closed)`} />
        <Stat label="Wins (signal)" value={`${s.summary.wins} / ${s.summary.closed}`} />
        <Stat label="Compounded · signal" value={fmtPct(s.summary.signalReturnPct)} cls={pctCls(s.summary.signalReturnPct)} />
        <Stat label="Compounded · actual*" value={fmtPct(s.summary.actualReturnPct)} cls={pctCls(s.summary.actualReturnPct)} />
      </div>
      <div className="bg-ink-900 border border-slate-800 rounded-lg p-3 overflow-x-auto">
        <h3 className="text-xs font-semibold tracking-wider text-slate-300 uppercase mb-2">Paper trades (newest first)</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-500 text-left">
              <th className="pr-3 pb-1 font-medium">Status</th>
              <th className="pr-3 pb-1 font-medium">Entry</th>
              <th className="pr-3 pb-1 font-medium">Exit</th>
              <th className="pr-3 pb-1 font-medium text-right">Entry signal</th>
              <th className="pr-3 pb-1 font-medium text-right">Entry actual</th>
              <th className="pr-3 pb-1 font-medium text-right">Exit signal</th>
              <th className="pr-3 pb-1 font-medium text-right">Exit actual</th>
              <th className="pr-3 pb-1 font-medium text-right">Signal %</th>
              <th className="pr-3 pb-1 font-medium text-right">Actual %</th>
              <th className="pb-1 font-medium text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {s.trades.length === 0 && (
              <tr>
                <td colSpan={10} className="py-3 text-slate-500">
                  No signals yet.
                </td>
              </tr>
            )}
            {s.trades.map((t) => (
              <TradeRow key={t.entryTime} t={t} />
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-2">
          Signal = next daily open after the confirmed close (what a chart backtest assumes). Actual = the live order-book price for the paper size, recorded when the signal is first seen
          (asks to enter, bids to exit). * Actual only exists for signals seen live; older history is signal-only. An open trade is marked to the last candle (signal) and to the current best bid
          (actual).
        </p>
      </div>
      <div className="bg-ink-900 border border-slate-800 rounded-lg p-3">
        <h3 className="text-xs font-semibold tracking-wider text-slate-300 uppercase mb-2">Paper settings</h3>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!loaded} />
            Track signals and record actual prices
          </label>
          <label className="flex items-center gap-2">
            Paper size (XBT per order)
            <input className={inputCls} value={size} onChange={(e) => setSize(e.target.value)} disabled={!loaded} />
          </label>
          <button className={btnCls} onClick={() => void save()} disabled={!loaded}>
            Save
          </button>
          {note && <span className="text-slate-400">{note}</span>}
        </div>
        <p className="text-xs text-slate-500 mt-2">Paper only: this tab never places orders. One paper position at a time (enter, then exit, then the next). A live switch can be added later once there is enough history.</p>
      </div>
    </div>
  );
}
