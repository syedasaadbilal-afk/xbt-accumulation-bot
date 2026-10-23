/**
 * Larsson Line engine (plain version: no overextension entry cap, no
 * take-profit), ported from the Pine "Larsson Line Rotation" strategy.
 *
 * SMMA 15/19/25/29 of hl2 on daily XBT/BTC. Regime: gray if the middle lines
 * disagree with the fast/slow ordering; else orange (fast > slow) or navy.
 * Hold BTC by default; rotate into XBT on orange, back to BTC on navy/gray.
 * Signals use confirmed daily closes and execute at the NEXT bar's open.
 */
export interface DailyCandle {
  /** Unix seconds (bar open). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type LarssonRegime = "orange" | "navy" | "gray";

export interface LarssonBar extends DailyCandle {
  v1: number | null;
  m1: number | null;
  m2: number | null;
  v2: number | null;
  regime: LarssonRegime | null;
  /** (close - v2) / v2, null until the baseline exists. */
  dist: number | null;
  /** False for the still-forming current day. */
  confirmed: boolean;
}

export const SMMA_PERIODS = [15, 19, 25, 29] as const;
/** Bars after which the lines have mostly forgotten their SMA seed (practical warm-up). */
export const RELIABLE_BARS = 90;
const DAY_S = 86_400;

function smma(values: number[], length: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < length) return out;
  let prev = values.slice(0, length).reduce((s, x) => s + x, 0) / length;
  out[length - 1] = prev;
  for (let i = length; i < values.length; i++) {
    prev = (prev * (length - 1) + values[i]!) / length;
    out[i] = prev;
  }
  return out;
}

/** Computes lines and regimes for every bar. `nowMs` decides which bar is still forming. */
export function computeLarsson(candlesIn: DailyCandle[], nowMs: number): LarssonBar[] {
  const candles = [...candlesIn].filter((c) => Number.isFinite(c.close)).sort((a, b) => a.time - b.time);
  const hl2 = candles.map((c) => (c.high + c.low) / 2);
  const [v1, m1, m2, v2] = SMMA_PERIODS.map((p) => smma(hl2, p)) as [
    Array<number | null>,
    Array<number | null>,
    Array<number | null>,
    Array<number | null>,
  ];
  return candles.map((c, i) => {
    const a = v1[i] ?? null;
    const b = m1[i] ?? null;
    const m = m2[i] ?? null;
    const s = v2[i] ?? null;
    let regime: LarssonRegime | null = null;
    let dist: number | null = null;
    if (a !== null && b !== null && m !== null && s !== null) {
      const gray = a < b !== a < s || m < s !== a < s;
      regime = gray ? "gray" : a > s ? "orange" : "navy";
      dist = (c.close - s) / s;
    }
    return { ...c, v1: a, m1: b, m2: m, v2: s, regime, dist, confirmed: (c.time + DAY_S) * 1000 <= nowMs };
  });
}

export interface LarssonSignal {
  /** Bar whose confirmed close produced the signal (unix s). */
  signalBarTime: number;
  action: "enter" | "exit";
  /** Open of the following bar = the assumed execution price (null if that bar does not exist yet). */
  signalPrice: number | null;
  /** Unix s of the execution bar (signal bar + 1 day). */
  execTime: number;
}

/** Replays the plain engine over confirmed bars. Starts in BTC. */
export function replaySignals(bars: LarssonBar[]): { signals: LarssonSignal[]; holding: boolean } {
  const signals: LarssonSignal[] = [];
  let holding = false; // true = holding XBT
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    if (!b.confirmed || b.regime === null) continue;
    const next = bars[i + 1];
    if (!holding && b.regime === "orange") {
      holding = true;
      signals.push({ signalBarTime: b.time, action: "enter", signalPrice: next ? next.open : null, execTime: b.time + DAY_S });
    } else if (holding && b.regime !== "orange") {
      holding = false;
      signals.push({ signalBarTime: b.time, action: "exit", signalPrice: next ? next.open : null, execTime: b.time + DAY_S });
    }
  }
  return { signals, holding };
}

/** Recorded paper fill for one signal (actual price from the live order book). */
export interface LarssonFill {
  signalBarTime: number;
  action: "enter" | "exit";
  actualPrice: number;
  sizeXbt: number;
  filledAt: number;
}

export interface LarssonTrade {
  /** Round trip BTC -> XBT -> BTC. Exit fields are null while open. */
  entryTime: number;
  entrySignal: number | null;
  entryActual: number | null;
  exitTime: number | null;
  exitSignal: number | null;
  exitActual: number | null;
  status: "open" | "closed";
  /** Return in BTC terms: exit/entry - 1 (open trades are marked to markSignal / markActual). */
  signalReturnPct: number | null;
  actualReturnPct: number | null;
}

const pct = (from: number | null, to: number | null) => (from && to ? (to / from - 1) * 100 : null);

/** Pairs enter/exit signals into trades and joins recorded fills. Marks open trades to the given prices. */
export function buildTrades(
  signals: LarssonSignal[],
  fills: LarssonFill[],
  mark: { signal: number | null; actual: number | null }
): LarssonTrade[] {
  const fillBy = new Map(fills.map((f) => [`${f.signalBarTime}:${f.action}`, f]));
  const trades: LarssonTrade[] = [];
  let open: LarssonTrade | null = null;
  for (const s of signals) {
    const fill = fillBy.get(`${s.signalBarTime}:${s.action}`);
    if (s.action === "enter") {
      open = {
        entryTime: s.execTime,
        entrySignal: s.signalPrice,
        entryActual: fill?.actualPrice ?? null,
        exitTime: null,
        exitSignal: null,
        exitActual: null,
        status: "open",
        signalReturnPct: null,
        actualReturnPct: null,
      };
      trades.push(open);
    } else if (open) {
      open.exitTime = s.execTime;
      open.exitSignal = s.signalPrice;
      open.exitActual = fill?.actualPrice ?? null;
      open.status = "closed";
      open.signalReturnPct = pct(open.entrySignal, open.exitSignal);
      open.actualReturnPct = pct(open.entryActual, open.exitActual);
      open = null;
    }
  }
  if (open) {
    open.signalReturnPct = pct(open.entrySignal, mark.signal);
    open.actualReturnPct = pct(open.entryActual, mark.actual);
  }
  return trades;
}

/**
 * Volume-weighted BTC price per XBT to fill `sizeXbt` XBT against book levels
 * (asks for a buy, bids for a sell, best first). If the book is too thin the
 * remainder is priced at the worst level shown, which is a pessimistic estimate.
 */
export function bookVwap(levels: Array<{ price: number; quantity: number }>, sizeXbt: number): number | null {
  if (levels.length === 0 || sizeXbt <= 0) return null;
  let remaining = sizeXbt;
  let btc = 0;
  let lastPrice = 0;
  for (const l of levels) {
    if (l.price <= 0 || l.quantity <= 0) continue;
    const take = Math.min(l.quantity, remaining);
    btc += take * l.price;
    remaining -= take;
    lastPrice = l.price;
    if (remaining <= 1e-12) break;
  }
  if (lastPrice === 0) return null;
  if (remaining > 1e-12) btc += remaining * lastPrice;
  return btc / sizeXbt;
}
