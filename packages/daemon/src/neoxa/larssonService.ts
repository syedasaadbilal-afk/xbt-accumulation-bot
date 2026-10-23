import type { DatabaseSyncLike } from "../db/types.js";
import type { NeoxaClient } from "./client.js";
import {
  RELIABLE_BARS,
  bookVwap,
  buildTrades,
  computeLarsson,
  replaySignals,
  type DailyCandle,
  type LarssonFill,
} from "./larsson.js";

export interface LarssonConfig {
  enabled: boolean;
  paperSizeXbt: number;
}

const CANDLE_LIMIT = 500;
/** A signal older than this was not seen live, so it gets no "actual" price (we won't invent one). */
const FILL_MAX_AGE_MS = 2 * 86_400_000;

export class LarssonStore {
  constructor(private readonly db: DatabaseSyncLike) {}

  getConfig(): LarssonConfig {
    const r = this.db.prepare("SELECT enabled, paper_size_xbt FROM larsson_config WHERE id = 1").get() as
      | { enabled: number; paper_size_xbt: number }
      | undefined;
    return r ? { enabled: r.enabled === 1, paperSizeXbt: r.paper_size_xbt } : { enabled: true, paperSizeXbt: 0.25 };
  }

  setConfig(c: LarssonConfig): void {
    this.db
      .prepare(
        `INSERT INTO larsson_config (id, enabled, paper_size_xbt, updated_at) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, paper_size_xbt = excluded.paper_size_xbt, updated_at = excluded.updated_at`
      )
      .run(c.enabled ? 1 : 0, c.paperSizeXbt, Date.now());
  }

  fills(): LarssonFill[] {
    return (
      this.db.prepare("SELECT signal_bar_time, action, actual_price, size_xbt, filled_at FROM larsson_fills ORDER BY signal_bar_time").all() as Array<{
        signal_bar_time: number;
        action: "enter" | "exit";
        actual_price: number;
        size_xbt: number;
        filled_at: number;
      }>
    ).map((r) => ({ signalBarTime: r.signal_bar_time, action: r.action, actualPrice: r.actual_price, sizeXbt: r.size_xbt, filledAt: r.filled_at }));
  }

  addFill(f: LarssonFill): void {
    this.db
      .prepare("INSERT OR IGNORE INTO larsson_fills (signal_bar_time, action, actual_price, size_xbt, filled_at) VALUES (?, ?, ?, ?, ?)")
      .run(f.signalBarTime, f.action, f.actualPrice, f.sizeXbt, f.filledAt);
  }
}

type LarssonClient = Pick<NeoxaClient, "getCandles" | "getOrderBook" | "getTicker">;

async function loadCandles(client: LarssonClient, pair: string): Promise<DailyCandle[]> {
  const raw = await client.getCandles(pair, "1d", CANDLE_LIMIT);
  return raw.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
}

/**
 * Records the paper "actual" price when a fresh signal is seen: the real
 * order-book VWAP for the paper size (asks to enter, bids to exit). Idempotent.
 */
export async function larssonTick(opts: { client: LarssonClient; store: LarssonStore; pair: string; now?: number }): Promise<{ recorded: string | null }> {
  const now = opts.now ?? Date.now();
  const cfg = opts.store.getConfig();
  if (!cfg.enabled) return { recorded: null };
  const bars = computeLarsson(await loadCandles(opts.client, opts.pair), now);
  const { signals } = replaySignals(bars);
  const last = signals[signals.length - 1];
  if (!last) return { recorded: null };
  if (opts.store.fills().some((f) => f.signalBarTime === last.signalBarTime && f.action === last.action)) return { recorded: null };
  if (now - last.execTime * 1000 > FILL_MAX_AGE_MS) return { recorded: null };
  const book = await opts.client.getOrderBook(opts.pair, 20);
  const price = bookVwap(last.action === "enter" ? book.asks : book.bids, cfg.paperSizeXbt);
  if (price === null) return { recorded: null };
  opts.store.addFill({ signalBarTime: last.signalBarTime, action: last.action, actualPrice: price, sizeXbt: cfg.paperSizeXbt, filledAt: now });
  return { recorded: `${last.action} @ ${price.toFixed(8)}` };
}

/** Everything the dashboard's Larsson tab renders. */
export async function larssonStatus(opts: { client: LarssonClient; store: LarssonStore; pair: string; now?: number }) {
  const now = opts.now ?? Date.now();
  const config = opts.store.getConfig();
  let error: string | null = null;
  let bars: ReturnType<typeof computeLarsson> = [];
  let ticker: Awaited<ReturnType<LarssonClient["getTicker"]>> | null = null;
  try {
    bars = computeLarsson(await loadCandles(opts.client, opts.pair), now);
    ticker = await opts.client.getTicker(opts.pair);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const { signals, holding } = replaySignals(bars);
  const lastBar = bars[bars.length - 1];
  const lastConfirmed = [...bars].reverse().find((b) => b.confirmed && b.regime !== null) ?? null;
  const markSignal = lastBar ? lastBar.close : null;
  const markActual = ticker && ticker.bestBid > 0 ? ticker.bestBid : null;
  const trades = buildTrades(signals, opts.store.fills(), { signal: markSignal, actual: markActual });
  const closed = trades.filter((t) => t.status === "closed");
  const sum = (xs: Array<number | null>) => xs.reduce<number>((s, x) => (x === null ? s : s * (1 + x / 100)), 1);
  const compound = (get: (t: (typeof trades)[number]) => number | null) =>
    (sum(trades.map(get)) - 1) * 100;
  return {
    config,
    pair: opts.pair,
    error,
    barsCount: bars.length,
    reliableBars: RELIABLE_BARS,
    warmup: bars.length < RELIABLE_BARS,
    holding,
    current: lastConfirmed
      ? { regime: lastConfirmed.regime, dist: lastConfirmed.dist, confirmedBarTime: lastConfirmed.time }
      : null,
    ticker: ticker ? { bestBid: ticker.bestBid, bestAsk: ticker.bestAsk, lastPrice: ticker.lastPrice } : null,
    bars: bars.slice(-150),
    signals: signals.filter((s) => bars.length === 0 || s.signalBarTime >= (bars[Math.max(0, bars.length - 150)]?.time ?? 0)),
    trades: [...trades].reverse(),
    summary: {
      trades: trades.length,
      closed: closed.length,
      wins: closed.filter((t) => (t.signalReturnPct ?? 0) > 0).length,
      signalReturnPct: trades.length ? compound((t) => t.signalReturnPct) : 0,
      actualReturnPct: trades.some((t) => t.actualReturnPct !== null) ? compound((t) => t.actualReturnPct) : null,
    },
  };
}
