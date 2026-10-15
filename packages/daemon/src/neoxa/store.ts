import type { DatabaseSyncLike } from "../db/types.js";

export type BotMode = "DRY_RUN" | "LIVE";
import { DEFAULT_NEOXA_TIERS, type NeoxaTier } from "./strategy.js";

export interface NeoxaConfig {
  enabled: boolean;
  /** DRY_RUN only reports what it would place; LIVE places real orders. */
  mode: BotMode;
  pair: string;
  /** Total BTC the bot may spend on XBT (the "float" you deposited). */
  budgetBtc: number;
  chunkXbt: number;
  postOnly: boolean;
  tiers: NeoxaTier[];
}

export interface NeoxaState {
  spentBtc: number;
  boughtXbt: number;
  openOrderId: string | null;
  openOrderPrice: number | null;
  openOrderQty: number | null;
  openOrderPlacedAt: number | null;
}

export interface NeoxaOrderRow {
  orderId: string;
  placedAt: number;
  pair: string;
  price: number;
  quantity: number;
  filled: number;
  status: string;
  tier: number | null;
  note: string | null;
}

export const DEFAULT_NEOXA_CONFIG: NeoxaConfig = {
  enabled: false,
  mode: "DRY_RUN",
  pair: "BTCB2_BTC",
  budgetBtc: 0,
  chunkXbt: 0.25,
  postOnly: true,
  tiers: DEFAULT_NEOXA_TIERS,
};

export class NeoxaStore {
  constructor(private readonly db: DatabaseSyncLike) {}

  getConfig(): NeoxaConfig {
    const row = this.db.prepare("SELECT * FROM neoxa_config WHERE id = 1").get() as
      | { enabled: number; mode: string; pair: string; budget_btc: number; chunk_xbt: number; post_only: number; tiers_json: string }
      | undefined;
    if (!row) return { ...DEFAULT_NEOXA_CONFIG, tiers: DEFAULT_NEOXA_TIERS.map((t) => ({ ...t })) };
    let tiers: NeoxaTier[] = DEFAULT_NEOXA_TIERS;
    try {
      const parsed = JSON.parse(row.tiers_json) as NeoxaTier[];
      if (Array.isArray(parsed) && parsed.length > 0) tiers = parsed;
    } catch {
      // fall back to defaults
    }
    return {
      enabled: row.enabled === 1,
      mode: row.mode === "LIVE" ? "LIVE" : "DRY_RUN",
      pair: row.pair,
      budgetBtc: row.budget_btc,
      chunkXbt: row.chunk_xbt,
      postOnly: row.post_only === 1,
      tiers,
    };
  }

  setConfig(c: NeoxaConfig): void {
    this.db
      .prepare(
        `INSERT INTO neoxa_config (id, enabled, mode, pair, budget_btc, chunk_xbt, post_only, tiers_json, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, mode = excluded.mode, pair = excluded.pair, budget_btc = excluded.budget_btc,
           chunk_xbt = excluded.chunk_xbt, post_only = excluded.post_only, tiers_json = excluded.tiers_json, updated_at = excluded.updated_at`
      )
      .run(c.enabled ? 1 : 0, c.mode, c.pair, c.budgetBtc, c.chunkXbt, c.postOnly ? 1 : 0, JSON.stringify(c.tiers), Date.now());
  }

  getState(): NeoxaState {
    const row = this.db.prepare("SELECT * FROM neoxa_state WHERE id = 1").get() as
      | {
          spent_btc: number;
          bought_xbt: number;
          open_order_id: string | null;
          open_order_price: number | null;
          open_order_qty: number | null;
          open_order_placed_at: number | null;
        }
      | undefined;
    return {
      spentBtc: row?.spent_btc ?? 0,
      boughtXbt: row?.bought_xbt ?? 0,
      openOrderId: row?.open_order_id ?? null,
      openOrderPrice: row?.open_order_price ?? null,
      openOrderQty: row?.open_order_qty ?? null,
      openOrderPlacedAt: row?.open_order_placed_at ?? null,
    };
  }

  setState(s: NeoxaState): void {
    this.db
      .prepare(
        `INSERT INTO neoxa_state (id, spent_btc, bought_xbt, open_order_id, open_order_price, open_order_qty, open_order_placed_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET spent_btc = excluded.spent_btc, bought_xbt = excluded.bought_xbt,
           open_order_id = excluded.open_order_id, open_order_price = excluded.open_order_price,
           open_order_qty = excluded.open_order_qty, open_order_placed_at = excluded.open_order_placed_at, updated_at = excluded.updated_at`
      )
      .run(s.spentBtc, s.boughtXbt, s.openOrderId, s.openOrderPrice, s.openOrderQty, s.openOrderPlacedAt, Date.now());
  }

  logOrder(o: NeoxaOrderRow): void {
    this.db
      .prepare(
        `INSERT INTO neoxa_orders (order_id, placed_at, pair, price, quantity, filled, status, tier, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(order_id) DO UPDATE SET filled = excluded.filled, status = excluded.status, note = COALESCE(excluded.note, neoxa_orders.note)`
      )
      .run(o.orderId, o.placedAt, o.pair, o.price, o.quantity, o.filled, o.status, o.tier, o.note);
  }

  recentOrders(limit = 50): NeoxaOrderRow[] {
    const rows = this.db.prepare("SELECT * FROM neoxa_orders ORDER BY placed_at DESC LIMIT ?").all(limit) as Array<{
      order_id: string;
      placed_at: number;
      pair: string;
      price: number;
      quantity: number;
      filled: number;
      status: string;
      tier: number | null;
      note: string | null;
    }>;
    return rows.map((r) => ({
      orderId: r.order_id,
      placedAt: r.placed_at,
      pair: r.pair,
      price: r.price,
      quantity: r.quantity,
      filled: r.filled,
      status: r.status,
      tier: r.tier,
      note: r.note,
    }));
  }
}
