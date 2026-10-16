import { describe, expect, it, beforeEach } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { applyMigrations } from "../src/db/migrate.js";
import { NeoxaStore } from "../src/neoxa/store.js";
import { runNeoxaTick } from "../src/neoxa/bot.js";
import { DEFAULT_DCA, maFromCandles, planDca, windowIndex } from "../src/neoxa/strategy.js";
import type { NeoxaClient, NeoxaOrder } from "../src/neoxa/client.js";

const MA = 0.0087; // reference
const H = 3_600_000;
const NOW = 1_000 * 12 * H; // aligned to a window start for 1h/2h/4h/6h

describe("dca strategy", () => {
  it("MA is the mean of the last N closes (order independent) and null without enough data", () => {
    const c = Array.from({ length: 40 }, (_, i) => ({ time: i, close: i < 10 ? 1 : 2 }));
    expect(maFromCandles(c, 30)).toBeCloseTo(2, 9);
    expect(maFromCandles([...c].reverse(), 30)).toBeCloseTo(2, 9);
    expect(maFromCandles(c.slice(0, 10), 30)).toBeNull();
  });

  const base = { dca: DEFAULT_DCA, budgetBtc: 0.05, bandSpent: {}, windows: {}, now: NOW, ma: MA };

  it("deeper discount means more chunks and a shorter interval", () => {
    const at = (disc: number) => planDca({ ...base, bestAsk: MA * (1 - disc / 100) });
    expect(at(-20).bandIndex).toBe(-1); // >15% above the reference: skip
    expect([at(0).chunksAllowed, at(0).intervalHours]).toEqual([1, 4]);
    expect([at(12).chunksAllowed, at(12).intervalHours]).toEqual([1, 2]);
    expect([at(24).chunksAllowed, at(24).intervalHours]).toEqual([1, 1]);
    expect([at(27).chunksAllowed, at(27).intervalHours]).toEqual([2, 1]);
    expect([at(38).chunksAllowed, at(38).intervalHours]).toEqual([3, 1]);
    expect([at(50).chunksAllowed, at(50).intervalHours]).toEqual([3, 1]);
  });

  it("interval quota is per band; a deeper band or the next window reopens buying", () => {
    const ask = MA * 0.73; // 27% below -> band 25: 2 chunks per 1h
    const wid = windowIndex(NOW, 1);
    expect(planDca({ ...base, bestAsk: ask, windows: { "25": { id: wid, chunks: 1 } } }).bandIndex).toBeGreaterThanOrEqual(0);
    expect(planDca({ ...base, bestAsk: ask, windows: { "25": { id: wid, chunks: 2 } } }).bandIndex).toBe(-1);
    // price falls into the next band: fresh counter
    expect(planDca({ ...base, bestAsk: MA * 0.62, windows: { "25": { id: wid, chunks: 2 } } }).bandIndex).toBeGreaterThanOrEqual(0);
    // an hour later the same band's quota has reset
    expect(planDca({ ...base, bestAsk: ask, now: NOW + H, windows: { "25": { id: wid, chunks: 2 } } }).bandIndex).toBeGreaterThanOrEqual(0);
  });

  it("a band cannot spend more than its share of the budget", () => {
    const ask = MA * 0.78; // 22% below -> band 20: 25% of 0.05 = 0.0125
    expect(planDca({ ...base, bestAsk: ask, bandSpent: { "20": 0.01 } }).remainingBtc).toBeCloseTo(0.0025, 9);
    expect(planDca({ ...base, bestAsk: ask, bandSpent: { "20": 0.0125 } }).bandIndex).toBe(-1);
  });

  it("max price ceiling blocks buys", () => {
    const p = planDca({ ...base, dca: { ...DEFAULT_DCA, maxPrice: 0.005 }, bestAsk: MA * 0.78 });
    expect(p.bandIndex).toBe(-1);
  });

  it("a band without its own interval falls back to the global interval", () => {
    const dca = { ...DEFAULT_DCA, intervalHours: 8, bands: [{ discountPct: 0, chunks: 1, budgetPct: 100 }] };
    expect(planDca({ ...base, dca, bestAsk: MA }).intervalHours).toBe(8);
  });
});

function candles(closeAll: number, n = 40) {
  return Array.from({ length: n }, (_, i) => ({ time: i * 14_400, open: closeAll, high: closeAll, low: closeAll, close: closeAll, volume: 1 }));
}

function fakeClient(opts: { bestBid: number; bestAsk: number; btc: number; ma: number }) {
  const placed: Array<{ quantity: number; price: number }> = [];
  const orders = new Map<string, NeoxaOrder & { active: boolean }>();
  let n = 0;
  const client = {
    getPairInfo: async () => ({ pair: "BTCB2_BTC", minQuantity: 1e-8, pricePrecision: 8, quantityPrecision: 8, tradingPaused: false, makerFeeRate: 0.001, takerFeeRate: 0.002 }),
    getOrderBook: async () => ({ bids: [{ price: opts.bestBid, quantity: 4 }], asks: [{ price: opts.bestAsk, quantity: 3 }] }),
    getBalances: async () => ({ BTC: { available: opts.btc, locked: 0, total: opts.btc, in_orders: 0 } }),
    getCandles: async () => candles(opts.ma),
    getActiveOrders: async () => [...orders.values()].filter((o) => o.active),
    getOrderHistory: async () => [...orders.values()].filter((o) => !o.active),
    placeOrder: async (o: { pair: string; side: "buy" | "sell"; quantity: number; price: number }) => {
      placed.push({ quantity: o.quantity, price: o.price });
      const id = `ORD-${++n}`;
      const row = { order_id: id, pair: o.pair, side: o.side, price: o.price, quantity: o.quantity, quantity_filled: 0, quantity_remaining: o.quantity, status: "open", active: true };
      orders.set(id, row);
      return row;
    },
    cancelOrder: async (id: string) => {
      const o = orders.get(id)!;
      o.active = false;
      o.status = "cancelled";
    },
  } as unknown as NeoxaClient;
  const fillAll = () => {
    const o = [...orders.values()].find((x) => x.active)!;
    o.quantity_filled = o.quantity;
    o.quantity_remaining = 0;
    o.status = "filled";
    o.active = false;
  };
  return { client, placed, fillAll };
}

describe("dca bot", () => {
  let store: NeoxaStore;
  beforeEach(() => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    store = new NeoxaStore(db);
    store.setConfig({ ...store.getConfig(), enabled: true, mode: "LIVE", budgetBtc: 0.05, chunkXbt: 0.25 });
  });

  it("buys the band's chunk per its own interval, idles inside the interval, buys again in the next one", async () => {
    // ask 12% below MA -> band 10: 1 chunk per 2h
    const f = fakeClient({ bestBid: MA * 0.88 - 0.0001, bestAsk: MA * 0.88, btc: 1, ma: MA });
    expect((await runNeoxaTick({ client: f.client, store, now: NOW })).action).toBe("placed");
    f.fillAll();
    const second = await runNeoxaTick({ client: f.client, store, now: NOW + 60_000 });
    expect(second.action).toBe("idle");
    expect(second.detail).toContain("quota");
    expect(f.placed).toHaveLength(1);
    expect((await runNeoxaTick({ client: f.client, store, now: NOW + 2 * H + 1000 })).action).toBe("placed");
    expect(f.placed).toHaveLength(2);
  });

  it("a deeper discount buys on a shorter interval (hourly)", async () => {
    // ask 22% below MA -> band 20: 1 chunk per 1h
    const f = fakeClient({ bestBid: MA * 0.78 - 0.0001, bestAsk: MA * 0.78, btc: 1, ma: MA });
    await runNeoxaTick({ client: f.client, store, now: NOW });
    f.fillAll();
    expect((await runNeoxaTick({ client: f.client, store, now: NOW + 30 * 60_000 })).action).toBe("idle");
    expect((await runNeoxaTick({ client: f.client, store, now: NOW + H + 1000 })).action).toBe("placed");
  });

  it("tracks spend per band", async () => {
    const f = fakeClient({ bestBid: MA * 0.88 - 0.0001, bestAsk: MA * 0.88, btc: 1, ma: MA });
    await runNeoxaTick({ client: f.client, store, now: NOW });
    f.fillAll();
    await runNeoxaTick({ client: f.client, store, now: NOW + 1000 });
    const spent = store.getState().bandSpent["10"] ?? 0;
    expect(spent).toBeGreaterThan(0.0015);
    expect(spent).toBeLessThanOrEqual(0.05 * 0.2 + 1e-9);
  });

  it("does not buy when price is far above the reference", async () => {
    const f = fakeClient({ bestBid: MA * 1.2, bestAsk: MA * 1.21, btc: 1, ma: MA });
    const r = await runNeoxaTick({ client: f.client, store, now: NOW });
    expect(r.action).toBe("idle");
    expect(f.placed).toHaveLength(0);
  });
});
