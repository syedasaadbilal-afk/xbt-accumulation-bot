import { describe, expect, it, beforeEach } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { applyMigrations } from "../src/db/migrate.js";
import { NeoxaStore } from "../src/neoxa/store.js";
import { runNeoxaTick } from "../src/neoxa/bot.js";
import { chunkPrice, planNextChunk } from "../src/neoxa/strategy.js";
import type { NeoxaClient, NeoxaOrder } from "../src/neoxa/client.js";

const TIERS = [
  { price: 0.009, pct: 30 },
  { price: 0.008, pct: 30 },
  { price: 0.007, pct: 40 },
];

describe("neoxa strategy", () => {
  it("unlocks budget cumulatively as the ask falls through the tiers", () => {
    const base = { tiers: TIERS, budgetBtc: 1, spentBtc: 0 };
    expect(planNextChunk({ ...base, bestAsk: 0.0095 }).tierIndex).toBe(-1); // above every tier
    const t1 = planNextChunk({ ...base, bestAsk: 0.0089 });
    expect(t1.tierIndex).toBe(0);
    expect(t1.priceCap).toBe(0.009);
    expect(t1.remainingBtc).toBeCloseTo(0.3, 9);
    // tier 1 spent -> nothing more until tier 2 activates
    expect(planNextChunk({ ...base, spentBtc: 0.3, bestAsk: 0.0089 }).tierIndex).toBe(-1);
    const t2 = planNextChunk({ ...base, spentBtc: 0.3, bestAsk: 0.0079 });
    expect(t2.tierIndex).toBe(1);
    expect(t2.remainingBtc).toBeCloseTo(0.3, 9);
    // a deep dip unlocks all 100% at once
    expect(planNextChunk({ ...base, bestAsk: 0.0069 }).remainingBtc).toBeCloseTo(0.3, 9); // first tier first
    expect(planNextChunk({ ...base, spentBtc: 1, bestAsk: 0.001 }).tierIndex).toBe(-1); // budget used
  });

  it("post-only price stays strictly below ask and pool threshold, never above the tier cap", () => {
    const p = chunkPrice({ postOnly: true, priceCap: 0.0092, bestBid: 0.00929134, bestAsk: 0.009346, pricePrecision: 8 });
    expect(p).toBeLessThanOrEqual(0.0092);
    const q = chunkPrice({
      postOnly: true,
      priceCap: 0.5,
      bestBid: 0.00929134,
      bestAsk: 0.009346,
      pool: { reserveBase: 21.74648788, reserveQuote: 0.20263366, feeRate: 0.003, enabled: true },
      pricePrecision: 8,
    });
    expect(q).toBeCloseTo(0.00929135, 8); // bid + 1 tick, under the ask and the pool ask (~0.009346)
    expect(q).toBeLessThan(0.009346);
  });
});

interface Fake {
  client: NeoxaClient;
  placed: Array<{ quantity: number; price: number; postOnly: boolean }>;
  cancelled: string[];
  fillNext: (filled: number) => void;
}

function fakeClient(opts: { bestBid: number; bestAsk: number; btc: number }): Fake {
  const placed: Fake["placed"] = [];
  const cancelled: string[] = [];
  const orders = new Map<string, NeoxaOrder & { active: boolean }>();
  let n = 0;
  const client = {
    getPairInfo: async () => ({ pair: "BTCB2_BTC", minQuantity: 1e-8, pricePrecision: 8, quantityPrecision: 8, tradingPaused: false, makerFeeRate: 0.001, takerFeeRate: 0.002 }),
    getOrderBook: async () => ({ bids: [{ price: opts.bestBid, quantity: 4 }], asks: [{ price: opts.bestAsk, quantity: 3 }] }),
    getBalances: async () => ({ BTC: { available: opts.btc, locked: 0, total: opts.btc, in_orders: 0 } }),
    getActiveOrders: async () => [...orders.values()].filter((o) => o.active),
    getOrderHistory: async () => [...orders.values()].filter((o) => !o.active),
    placeOrder: async (o: { pair: string; side: "buy" | "sell"; quantity: number; price: number; postOnly: boolean }) => {
      placed.push({ quantity: o.quantity, price: o.price, postOnly: o.postOnly });
      const id = `ORD-${++n}`;
      const row = { order_id: id, pair: o.pair, side: o.side, price: o.price, quantity: o.quantity, quantity_filled: 0, quantity_remaining: o.quantity, status: "open", active: true };
      orders.set(id, row);
      return row;
    },
    cancelOrder: async (id: string) => {
      cancelled.push(id);
      const o = orders.get(id)!;
      o.active = false;
      o.status = "cancelled";
    },
  } as unknown as NeoxaClient;
  return {
    client,
    placed,
    cancelled,
    fillNext: (filled: number) => {
      const o = [...orders.values()].find((x) => x.active)!;
      o.quantity_filled = filled;
      o.quantity_remaining = o.quantity - filled;
      o.status = filled >= o.quantity ? "filled" : "cancelled";
      o.active = false;
    },
  };
}

describe("neoxa bot", () => {
  let store: NeoxaStore;
  beforeEach(() => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    store = new NeoxaStore(db);
    store.setConfig({ enabled: true, mode: "LIVE", pair: "BTCB2_BTC", budgetBtc: 0.05, chunkXbt: 0.25, postOnly: true, tiers: TIERS });
  });

  it("does nothing while disabled, and only reports in DRY_RUN mode", async () => {
    const f = fakeClient({ bestBid: 0.0088, bestAsk: 0.0089, btc: 1 });
    store.setConfig({ ...store.getConfig(), enabled: false });
    expect((await runNeoxaTick({ client: f.client, store })).action).toBe("disabled");
    store.setConfig({ ...store.getConfig(), enabled: true });
    store.setConfig({ ...store.getConfig(), mode: "DRY_RUN" });
    const dry = await runNeoxaTick({ client: f.client, store });
    expect(dry.action).toBe("would_place");
    expect(f.placed).toHaveLength(0);
  });

  it("places ONE 0.25 XBT post-only order, waits, then places the next only after the fill", async () => {
    const f = fakeClient({ bestBid: 0.0088, bestAsk: 0.0089, btc: 1 });
    const r1 = await runNeoxaTick({ client: f.client, store, now: 1_000 });
    expect(r1.action).toBe("placed");
    expect(f.placed).toEqual([{ quantity: 0.25, price: 0.00880001, postOnly: true }]);

    const r2 = await runNeoxaTick({ client: f.client, store, now: 2_000 });
    expect(r2.action).toBe("waiting");
    expect(f.placed).toHaveLength(1);

    f.fillNext(0.25);
    const r3 = await runNeoxaTick({ client: f.client, store, now: 3_000 });
    expect(r3.action).toBe("placed"); // filled order settled, next chunk placed in the same tick
    expect(f.placed).toHaveLength(2);
    const st = store.getState();
    expect(st.boughtXbt).toBeCloseTo(0.25, 9);
    expect(st.spentBtc).toBeCloseTo(0.25 * 0.00880001, 9);
  });

  it("never exceeds the tier budget: stops when tier 1's share is spent", async () => {
    const f = fakeClient({ bestBid: 0.0088, bestAsk: 0.0089, btc: 1 });
    store.setConfig({ ...store.getConfig(), budgetBtc: 0.001 }); // tier 1 = 0.0003 BTC ~ 0.034 XBT
    await runNeoxaTick({ client: f.client, store, now: 1 });
    expect(f.placed[0]!.quantity).toBeLessThan(0.25); // limited by the tier's remaining budget
    f.fillNext(f.placed[0]!.quantity);
    const r = await runNeoxaTick({ client: f.client, store, now: 2 });
    expect(r.action).toBe("idle"); // tier 1 fully spent, ask still above tier 2
  });

  it("cancels and books the partial fill when the bot is disabled", async () => {
    const f = fakeClient({ bestBid: 0.0088, bestAsk: 0.0089, btc: 1 });
    await runNeoxaTick({ client: f.client, store, now: 1 });
    store.setConfig({ ...store.getConfig(), enabled: false });
    const r = await runNeoxaTick({ client: f.client, store, now: 2 });
    expect(r.action).toBe("cancelled");
    expect(f.cancelled).toHaveLength(1);
    expect(store.getState().openOrderId).toBeNull();
  });

  it("caps the chunk to the BTC actually available", async () => {
    const f = fakeClient({ bestBid: 0.0088, bestAsk: 0.0089, btc: 0.001 });
    await runNeoxaTick({ client: f.client, store, now: 1 });
    expect(f.placed[0]!.quantity * f.placed[0]!.price).toBeLessThanOrEqual(0.001);
  });
});
