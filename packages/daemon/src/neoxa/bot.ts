import type { NeoxaClient } from "./client.js";
import type { NeoxaConfig, NeoxaStore } from "./store.js";
import {
  DEFAULT_DCA,
  chunkPrice,
  maFromCandles,
  planDca,
  planNextChunk,
  type DcaConfig,
} from "./strategy.js";

export interface NeoxaTickResult {
  action: "disabled" | "idle" | "waiting" | "placed" | "repriced" | "filled" | "cancelled" | "would_place" | "blocked" | "error";
  detail: string;
}

const REPRICE_AFTER_MS = 60_000;
const REPRICE_DRIFT = 0.005; // our bid is >0.5% below the best bid

interface Plan {
  /** -1 = nothing may be bought now. */
  index: number;
  priceCap: number;
  remainingBtc: number;
  /** DCA band key (discountPct) when strategy is DCA. */
  bandKey: number | null;
  /** DCA: id of the band's current interval window. */
  windowId?: number;
  label: string;
  reason: string;
}

function dcaOf(cfg: NeoxaConfig): DcaConfig {
  return cfg.dca ?? DEFAULT_DCA;
}

async function referenceMa(client: NeoxaClient, cfg: NeoxaConfig): Promise<number> {
  const dca = dcaOf(cfg);
  const candles = await client.getCandles(cfg.pair, dca.candleInterval, Math.max(dca.maPeriod + 5, 40));
  const ma = maFromCandles(candles, dca.maPeriod);
  if (ma === null || ma <= 0) throw new Error(`not enough ${dca.candleInterval} candles for a ${dca.maPeriod}-period reference`);
  return ma;
}

function makePlan(params: {
  cfg: NeoxaConfig;
  state: ReturnType<NeoxaStore["getState"]>;
  bestAsk: number;
  ma: number | null;
  now: number;
  ignoreWindow?: boolean;
}): Plan {
  const { cfg, state, bestAsk, ma, now } = params;
  if ((cfg.strategy ?? "DCA") === "TIERS") {
    const p = planNextChunk({ tiers: cfg.tiers, budgetBtc: cfg.budgetBtc, spentBtc: state.spentBtc, bestAsk });
    return {
      index: p.tierIndex,
      priceCap: p.priceCap,
      remainingBtc: p.remainingBtc,
      bandKey: null,
      label: `tier ${p.tierIndex + 1}, cap ${p.priceCap}`,
      reason: p.tierIndex < 0 ? `ask ${bestAsk} above every active tier, or budget used (${state.spentBtc.toFixed(8)}/${cfg.budgetBtc} BTC)` : "ok",
    };
  }
  const dca = dcaOf(cfg);
  const p = planDca({
    dca,
    budgetBtc: cfg.budgetBtc,
    bandSpent: state.bandSpent,
    totalSpent: state.spentBtc,
    windows: state.windows,
    now,
    ma: ma as number,
    bestAsk,
    ...(params.ignoreWindow ? { ignoreWindow: true } : {}),
  });
  return {
    index: p.bandIndex,
    priceCap: p.priceCap,
    remainingBtc: p.remainingBtc,
    bandKey: p.bandKey,
    windowId: p.windowId,
    label: `band ${p.bandIndex + 1} (${p.discountPct.toFixed(1)}% vs MA${dca.maPeriod} ${ma?.toFixed(8)}, ${p.chunksAllowed} chunk/${p.intervalHours}h)`,
    reason: p.bandIndex < 0 ? `${p.reason} (ask ${bestAsk}, MA ${ma?.toFixed(8)}, ${p.discountPct.toFixed(1)}% below)` : "ok",
  };
}

/**
 * One tick of the XBT accumulation bot. Exactly one buy order is ever open:
 * it is tracked in neoxa_state, polled until it leaves the active list, then
 * accounted for (cost bounded by price x filled) before the next chunk goes
 * out. Safe by default: does nothing unless enabled AND its mode is LIVE
 * (DRY_RUN only reports what it would place).
 */
export async function runNeoxaTick(params: {
  client: NeoxaClient;
  store: NeoxaStore;
  now?: number;
}): Promise<NeoxaTickResult> {
  const { client, store } = params;
  const now = params.now ?? Date.now();
  const cfg = store.getConfig();
  const runMode = cfg.mode;
  const isDca = (cfg.strategy ?? "DCA") !== "TIERS";
  let state = store.getState();

  try {
    // ---- settle / manage an order that is already open ----
    if (state.openOrderId) {
      const active = await client.getActiveOrders(cfg.pair);
      const open = active.find((o) => o.order_id === state.openOrderId);
      const killed = !cfg.enabled;
      if (open) {
        const book = await client.getOrderBook(cfg.pair, 5);
        const bestBid = book.bids[0]?.price ?? 0;
        const bestAsk = book.asks[0]?.price ?? Infinity;
        const ma = isDca ? await referenceMa(client, cfg) : null;
        const plan = makePlan({ cfg, state, bestAsk, ma, now, ignoreWindow: true });
        const stale =
          plan.index < 0 ||
          bestAsk > (state.openOrderPrice ?? 0) * 1.5 ||
          (now - (state.openOrderPlacedAt ?? now) > REPRICE_AFTER_MS &&
            bestBid > 0 &&
            (state.openOrderPrice ?? 0) < bestBid * (1 - REPRICE_DRIFT));
        if (!killed && !stale) return { action: "waiting", detail: `order ${open.order_id} open at ${state.openOrderPrice}, ${open.quantity_filled}/${open.quantity} filled` };
        await client.cancelOrder(open.order_id);
        state = await settleOrder(client, store, state, cfg, open.order_id, "cancelled");
        return { action: "cancelled", detail: killed ? "cancelled: bot disabled" : "cancelled: stale price or buy conditions no longer met" };
      }
      state = await settleOrder(client, store, state, cfg, state.openOrderId, "filled");
      // fall through: a new chunk may be placed right away
    }

    if (!cfg.enabled) return { action: "disabled", detail: "bot is disabled" };

    // ---- plan the next chunk ----
    const [pairInfo, book, balances] = await Promise.all([
      client.getPairInfo(cfg.pair),
      client.getOrderBook(cfg.pair, 10),
      client.getBalances(),
    ]);
    if (pairInfo.tradingPaused) return { action: "blocked", detail: "trading is paused on this pair" };
    const bestBid = book.bids[0]?.price ?? 0;
    const bestAsk = book.asks[0]?.price ?? 0;
    if (bestBid <= 0 || bestAsk <= 0) return { action: "blocked", detail: "no two-sided book" };

    const ma = isDca ? await referenceMa(client, cfg) : null;
    const plan = makePlan({ cfg, state, bestAsk, ma, now });
    if (plan.index < 0) return { action: "idle", detail: plan.reason };

    const price = chunkPrice({
      postOnly: cfg.postOnly,
      priceCap: plan.priceCap,
      bestBid,
      bestAsk,
      ...(book.pool ? { pool: book.pool } : {}),
      pricePrecision: pairInfo.pricePrecision,
    });
    if (price <= 0) return { action: "blocked", detail: "could not derive a valid buy price" };

    const qtyDigits = pairInfo.quantityPrecision;
    const maxByPlan = plan.remainingBtc / price;
    const btcAvailable = balances["BTC"]?.available ?? 0;
    const maxByBalance = (btcAvailable * 0.998) / price;
    let quantity = Math.min(cfg.chunkXbt, maxByPlan, maxByBalance);
    quantity = Math.floor(quantity * 10 ** qtyDigits + 1e-9) / 10 ** qtyDigits;
    if (quantity < pairInfo.minQuantity || quantity <= 0) {
      return { action: "blocked", detail: `chunk below minimum (qty ${quantity}); BTC available ${btcAvailable}` };
    }

    if (runMode !== "LIVE") {
      return { action: "would_place", detail: `[${runMode}] would buy ${quantity} XBT at ${price} (${plan.label})` };
    }

    const order = await client.placeOrder({ pair: cfg.pair, side: "buy", quantity, price, postOnly: cfg.postOnly });
    const windows = { ...state.windows };
    if (isDca && plan.bandKey !== null && plan.windowId !== undefined) {
      const k = String(plan.bandKey);
      if (windows[k]?.id !== plan.windowId) windows[k] = { id: plan.windowId, chunks: 0 };
    }
    store.setState({
      ...state,
      openOrderId: order.order_id,
      openOrderPrice: price,
      openOrderQty: quantity,
      openOrderPlacedAt: now,
      openOrderBand: plan.bandKey,
      windows,
    });
    store.logOrder({
      orderId: order.order_id,
      placedAt: now,
      pair: cfg.pair,
      price,
      quantity,
      filled: order.quantity_filled ?? 0,
      status: order.status ?? "open",
      tier: plan.index + 1,
      note: cfg.postOnly ? "post-only" : "limit",
    });
    return { action: "placed", detail: `buy ${quantity} XBT at ${price} (${plan.label})` };
  } catch (err) {
    return { action: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Looks up the final fill of an order that is no longer active, books it, and clears the open-order slot. */
async function settleOrder(
  client: NeoxaClient,
  store: NeoxaStore,
  state: ReturnType<NeoxaStore["getState"]>,
  cfg: NeoxaConfig,
  orderId: string,
  fallbackStatus: string
) {
  const hist = await client.getOrderHistory(100);
  const o = hist.find((h) => h.order_id === orderId);
  if (!o && Date.now() - (state.openOrderPlacedAt ?? 0) < 10 * 60_000) {
    // Not in history yet (propagation lag): keep the slot occupied and retry next tick rather than losing a fill.
    return state;
  }
  const price = state.openOrderPrice ?? o?.price ?? 0;
  const filled = o?.quantity_filled ?? 0;
  const status = o?.status ?? fallbackStatus;
  const bandSpent = { ...state.bandSpent };
  if (state.openOrderBand !== null && filled > 0) {
    const k = String(state.openOrderBand);
    bandSpent[k] = (bandSpent[k] ?? 0) + filled * price;
  }
  const windows = { ...state.windows };
  if (state.openOrderBand !== null && filled > 0 && cfg.chunkXbt > 0) {
    const k = String(state.openOrderBand);
    const w = windows[k];
    if (w) windows[k] = { id: w.id, chunks: w.chunks + filled / cfg.chunkXbt };
  }
  const next = {
    ...state,
    spentBtc: state.spentBtc + filled * price,
    boughtXbt: state.boughtXbt + filled,
    openOrderId: null,
    openOrderPrice: null,
    openOrderQty: null,
    openOrderPlacedAt: null,
    openOrderBand: null,
    windows,
    bandSpent,
  };
  store.setState(next);
  store.logOrder({
    orderId,
    placedAt: state.openOrderPlacedAt ?? Date.now(),
    pair: o?.pair ?? cfg.pair,
    price,
    quantity: o?.quantity ?? state.openOrderQty ?? 0,
    filled,
    status,
    tier: null,
    note: null,
  });
  return next;
}
