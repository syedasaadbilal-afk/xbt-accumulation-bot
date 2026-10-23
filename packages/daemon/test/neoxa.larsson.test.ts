import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { applyMigrations } from "../src/db/migrate.js";
import { bookVwap, buildTrades, computeLarsson, replaySignals, type DailyCandle } from "../src/neoxa/larsson.js";
import { LarssonStore, larssonStatus, larssonTick } from "../src/neoxa/larssonService.js";

const DAY = 86_400;
const T0 = 1_700_000_000 - (1_700_000_000 % DAY);

/** Daily candles from a close path (high/low +-1%). */
function path(closes: number[]): DailyCandle[] {
  return closes.map((c, i) => ({ time: T0 + i * DAY, open: i === 0 ? c : closes[i - 1]!, high: c * 1.01, low: c * 0.99, close: c }));
}
const nowAfter = (n: number) => (T0 + n * DAY + 3600) * 1000; // 1h into the day after bar n-1... i.e. bars 0..n-1 confirmed, bar n forming

// flat 40 bars, then a rally of 25 bars, then a collapse of 25 bars
const FLAT = Array.from({ length: 40 }, () => 1);
const RALLY = Array.from({ length: 25 }, (_, i) => 1 + (i + 1) * 0.03);
const DROP = Array.from({ length: 25 }, (_, i) => 1.75 - (i + 1) * 0.04);
const CLOSES = [...FLAT, ...RALLY, ...DROP];

describe("larsson engine", () => {
  it("has no lines before bar 29 and marks the forming bar unconfirmed", () => {
    const bars = computeLarsson(path(CLOSES), nowAfter(CLOSES.length - 1));
    expect(bars[27]!.v2).toBeNull();
    expect(bars[27]!.regime).toBeNull();
    expect(bars[28]!.v2).not.toBeNull();
    expect(bars[bars.length - 1]!.confirmed).toBe(false);
    expect(bars[bars.length - 2]!.confirmed).toBe(true);
  });

  it("enters on orange during the rally and exits when the regime turns navy/gray", () => {
    const bars = computeLarsson(path(CLOSES), nowAfter(CLOSES.length));
    const { signals, holding } = replaySignals(bars);
    expect(signals.map((s) => s.action)).toEqual(["enter", "exit"]);
    expect(signals[0]!.signalBarTime).toBeGreaterThanOrEqual(T0 + 39 * DAY);
    expect(signals[1]!.signalBarTime).toBeGreaterThan(signals[0]!.signalBarTime);
    expect(holding).toBe(false);
    // execution price = next bar open = previous close
    const entryBar = bars.findIndex((b) => b.time === signals[0]!.signalBarTime);
    expect(signals[0]!.signalPrice).toBeCloseTo(bars[entryBar + 1]!.open, 12);
  });

  it("does not signal on the still-forming bar", () => {
    const all = computeLarsson(path(CLOSES), nowAfter(CLOSES.length));
    const cut = computeLarsson(path(CLOSES), nowAfter(CLOSES.length - 1));
    // one fewer confirmed bar can only remove (never add) trailing signals
    expect(replaySignals(cut).signals.length).toBeLessThanOrEqual(replaySignals(all).signals.length);
    expect(cut[cut.length - 1]!.confirmed).toBe(false);
  });
});

describe("book vwap and trade pairing", () => {
  it("walks the book (quantity in XBT) and falls back to the worst level when thin", () => {
    const asks = [
      { price: 0.005, quantity: 0.2 },
      { price: 0.006, quantity: 1 },
    ];
    expect(bookVwap(asks, 0.1)).toBeCloseTo(0.005, 12);
    // 0.2 XBT at 0.005 + 0.05 XBT at 0.006 -> (0.001 + 0.0003) / 0.25
    expect(bookVwap(asks, 0.25)).toBeCloseTo(0.0013 / 0.25, 12);
    expect(bookVwap(asks, 5)).toBeGreaterThan(0.0059); // beyond depth -> pessimistic
    expect(bookVwap([], 0.25)).toBeNull();
  });

  it("builds signal vs actual returns and marks the open trade", () => {
    const signals = [
      { signalBarTime: 1, action: "enter" as const, signalPrice: 0.005, execTime: 2 },
      { signalBarTime: 5, action: "exit" as const, signalPrice: 0.006, execTime: 6 },
      { signalBarTime: 9, action: "enter" as const, signalPrice: 0.005, execTime: 10 },
    ];
    const fills = [
      { signalBarTime: 1, action: "enter" as const, actualPrice: 0.0051, sizeXbt: 0.25, filledAt: 0 },
      { signalBarTime: 5, action: "exit" as const, actualPrice: 0.0059, sizeXbt: 0.25, filledAt: 0 },
    ];
    const t = buildTrades(signals, fills, { signal: 0.0055, actual: 0.0052 });
    expect(t).toHaveLength(2);
    expect(t[0]!.status).toBe("closed");
    expect(t[0]!.signalReturnPct).toBeCloseTo(20, 9);
    expect(t[0]!.actualReturnPct).toBeCloseTo((0.0059 / 0.0051 - 1) * 100, 9);
    expect(t[1]!.status).toBe("open");
    expect(t[1]!.signalReturnPct).toBeCloseTo(10, 9);
    expect(t[1]!.actualReturnPct).toBeNull(); // no recorded entry fill
  });
});

function fakeClient(closes: number[], bid: number, ask: number) {
  return {
    getCandles: async () => path(closes).map((c) => ({ ...c, volume: 1 })),
    getOrderBook: async () => ({ bids: [{ price: bid, quantity: 100 }], asks: [{ price: ask, quantity: 100 }] }),
    getTicker: async () => ({ lastPrice: (bid + ask) / 2, bestBid: bid, bestAsk: ask, volume24h: 0, quoteVolume24h: 0 }),
  };
}

describe("larsson paper tracking", () => {
  it("records one actual fill at the book price for a fresh signal, once", async () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    const store = new LarssonStore(db);
    expect(store.getConfig()).toEqual({ enabled: true, paperSizeXbt: 0.25 });
    const closes = [...FLAT, ...RALLY.slice(0, 8)];
    const bars = computeLarsson(path(closes), nowAfter(closes.length));
    const entry = replaySignals(bars).signals[0]!;
    const entryIdx = bars.findIndex((b) => b.time === entry.signalBarTime);
    // "now" = shortly after the entry signal's execution bar opened
    const now = (entry.execTime + 3600) * 1000;
    const client = fakeClient(closes.slice(0, entryIdx + 2), 0.0049, 0.0051);
    const r1 = await larssonTick({ client: client as never, store, pair: "BTCB2_BTC", now });
    expect(r1.recorded).toContain("enter");
    expect(store.fills()).toHaveLength(1);
    expect(store.fills()[0]!.actualPrice).toBeCloseTo(0.0051, 10); // bought at the ask
    const r2 = await larssonTick({ client: client as never, store, pair: "BTCB2_BTC", now });
    expect(r2.recorded).toBeNull();
    expect(store.fills()).toHaveLength(1);
  });

  it("does not invent actual prices for old signals, and does nothing when disabled", async () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    const store = new LarssonStore(db);
    const client = fakeClient(CLOSES, 0.0049, 0.0051);
    const farFuture = nowAfter(CLOSES.length + 30);
    expect((await larssonTick({ client: client as never, store, pair: "BTCB2_BTC", now: farFuture })).recorded).toBeNull();
    store.setConfig({ enabled: false, paperSizeXbt: 0.25 });
    expect((await larssonTick({ client: client as never, store, pair: "BTCB2_BTC", now: nowAfter(CLOSES.length) })).recorded).toBeNull();
  });

  it("status reports trades, summary and warm-up", async () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    const store = new LarssonStore(db);
    const s = await larssonStatus({ client: fakeClient(CLOSES, 0.0049, 0.0051) as never, store, pair: "BTCB2_BTC", now: nowAfter(CLOSES.length) });
    expect(s.error).toBeNull();
    expect(s.barsCount).toBe(90);
    expect(s.warmup).toBe(false); // 90 bars = reliable threshold
    expect(s.trades.length).toBe(1);
    expect(s.trades[0]!.status).toBe("closed");
    expect(s.summary.actualReturnPct).toBeNull();
  });
});
