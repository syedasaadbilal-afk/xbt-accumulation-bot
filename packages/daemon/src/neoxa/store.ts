import type { DatabaseSyncLike } from "../db/types.js";

export type BotMode = "DRY_RUN" | "LIVE";
import { DEFAULT_DCA, DEFAULT_NEOXA_TIERS, type BandWindow, type DcaConfig, type NeoxaTier } from "./strategy.js";

export type Strategy = "DCA" | "TIERS";

export interface NeoxaConfig {
  /** DCA = drawdown-scaled schedule vs the reference MA (default); TIERS = legacy fixed price tiers. */
  strategy?: Strategy;
  dca?: DcaConfig;
  /** Dashboard warns when available BTC on the exchange falls below this (time to deposit the next tranche). */
  floatWarnBtc?: number;
  /** ntfy topic for phone alerts; empty = alerts off. */
  alertTopic?: string;
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
  /** DCA: discountPct key of the band the open order is funded from. */
  openOrderBand: number | null;
  /** DCA: per-band interval window id and chunks (fractional) bought in it, keyed by band discountPct. */
  windows: Record<string, BandWindow>;
  /** DCA: BTC spent per band, keyed by the band's discountPct. */
  bandSpent: Record<string, number>;
  /** When the last float-low / error push alert went out (ms), or null. */
  lastFloatAlertAt: number | null;
  lastErrorAlertAt: number | null;
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
  strategy: "DCA",
  dca: DEFAULT_DCA,
  floatWarnBtc: 0.02,
  alertTopic: "",
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
      | { enabled: number; mode: string; pair: string; budget_btc: number; chunk_xbt: number; post_only: number; tiers_json: string; strategy: string; dca_json: string; float_warn_btc: number; alert_topic: string }
      | undefined;
    if (!row) {
      return {
        ...DEFAULT_NEOXA_CONFIG,
        tiers: DEFAULT_NEOXA_TIERS.map((t) => ({ ...t })),
        dca: { ...DEFAULT_DCA, bands: DEFAULT_DCA.bands.map((b) => ({ ...b })) },
      };
    }
    let dca: DcaConfig = { ...DEFAULT_DCA, bands: DEFAULT_DCA.bands.map((b) => ({ ...b })) };
    try {
      const parsed = JSON.parse(row.dca_json) as DcaConfig;
      if (parsed && Array.isArray(parsed.bands) && parsed.bands.length > 0) dca = parsed;
    } catch {
      // empty/invalid -> defaults
    }
    let tiers: NeoxaTier[] = DEFAULT_NEOXA_TIERS;
    try {
      const parsed = JSON.parse(row.tiers_json) as NeoxaTier[];
      if (Array.isArray(parsed) && parsed.length > 0) tiers = parsed;
    } catch {
      // fall back to defaults
    }
    return {
      strategy: row.strategy === "TIERS" ? "TIERS" : "DCA",
      dca,
      floatWarnBtc: row.float_warn_btc ?? 0.02,
      alertTopic: row.alert_topic ?? "",
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
        `INSERT INTO neoxa_config (id, enabled, mode, pair, budget_btc, chunk_xbt, post_only, tiers_json, strategy, dca_json, float_warn_btc, alert_topic, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, mode = excluded.mode, pair = excluded.pair, budget_btc = excluded.budget_btc,
           chunk_xbt = excluded.chunk_xbt, post_only = excluded.post_only, tiers_json = excluded.tiers_json,
           strategy = excluded.strategy, dca_json = excluded.dca_json, float_warn_btc = excluded.float_warn_btc,
           alert_topic = excluded.alert_topic, updated_at = excluded.updated_at`
      )
      .run(
        c.enabled ? 1 : 0,
        c.mode,
        c.pair,
        c.budgetBtc,
        c.chunkXbt,
        c.postOnly ? 1 : 0,
        JSON.stringify(c.tiers),
        c.strategy ?? "DCA",
        JSON.stringify(c.dca ?? DEFAULT_DCA),
        c.floatWarnBtc ?? 0.02,
        c.alertTopic ?? "",
        Date.now()
      );
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
          open_order_band: number | null;
          band_spent_json: string;
          windows_json: string;
          last_float_alert_at: number | null;
          last_error_alert_at: number | null;
        }
      | undefined;
    let bandSpent: Record<string, number> = {};
    let windows: Record<string, BandWindow> = {};
    try {
      const p = JSON.parse(row?.band_spent_json ?? "{}") as Record<string, number>;
      if (p && typeof p === "object") bandSpent = p;
      const w = JSON.parse(row?.windows_json ?? "{}") as Record<string, BandWindow>;
      if (w && typeof w === "object") windows = w;
    } catch {
      // keep {}
    }
    return {
      lastFloatAlertAt: row?.last_float_alert_at ?? null,
      lastErrorAlertAt: row?.last_error_alert_at ?? null,
      openOrderBand: row?.open_order_band ?? null,
      windows,
      bandSpent,
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
        `INSERT INTO neoxa_state (id, spent_btc, bought_xbt, open_order_id, open_order_price, open_order_qty, open_order_placed_at,
           open_order_band, band_spent_json, windows_json, last_float_alert_at, last_error_alert_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET spent_btc = excluded.spent_btc, bought_xbt = excluded.bought_xbt,
           open_order_id = excluded.open_order_id, open_order_price = excluded.open_order_price,
           open_order_qty = excluded.open_order_qty, open_order_placed_at = excluded.open_order_placed_at,
           open_order_band = excluded.open_order_band, band_spent_json = excluded.band_spent_json,
           windows_json = excluded.windows_json, last_float_alert_at = excluded.last_float_alert_at,
           last_error_alert_at = excluded.last_error_alert_at, updated_at = excluded.updated_at`
      )
      .run(
        s.spentBtc,
        s.boughtXbt,
        s.openOrderId,
        s.openOrderPrice,
        s.openOrderQty,
        s.openOrderPlacedAt,
        s.openOrderBand,
        JSON.stringify(s.bandSpent),
        JSON.stringify(s.windows),
        s.lastFloatAlertAt,
        s.lastErrorAlertAt,
        Date.now()
      );
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
