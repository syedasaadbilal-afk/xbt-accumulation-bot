export interface NeoxaTier {
  /** XBT/BTC price at or below which this tier is active. */
  price: number;
  /** Share of the budget (percent) deployable once this tier is active. */
  pct: number;
}

export const DEFAULT_NEOXA_TIERS: NeoxaTier[] = [
  { price: 0.009, pct: 30 },
  { price: 0.008, pct: 30 },
  { price: 0.007, pct: 40 },
];

/** Tiers sorted by price, highest first (so the first tier to activate is the shallowest dip). */
export function sortTiers(tiers: NeoxaTier[]): NeoxaTier[] {
  return [...tiers].filter((t) => t.price > 0 && t.pct > 0).sort((a, b) => b.price - a.price);
}

export interface TierPlan {
  /** Index (in sorted order) of the tier the NEXT chunk is funded from, or -1 when nothing is deployable now. */
  tierIndex: number;
  /** Highest price the chunk may be bought at (the tier's price). */
  priceCap: number;
  /** BTC still deployable at the current price right now. */
  remainingBtc: number;
}

/**
 * Cumulative spend allowed at the current market: every tier whose price is >=
 * the best ask is active, and unlocks its share of the budget cumulatively
 * (tiers sorted highest price first: tier k's cumulative limit is the sum of
 * pct of tiers 0..k). Returns the first active tier whose cumulative limit is
 * not yet spent.
 */
export function planNextChunk(params: { tiers: NeoxaTier[]; budgetBtc: number; spentBtc: number; bestAsk: number }): TierPlan {
  const tiers = sortTiers(params.tiers);
  let cumulative = 0;
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]!;
    cumulative += (tier.pct / 100) * params.budgetBtc;
    if (params.bestAsk <= tier.price && params.spentBtc < cumulative - 1e-7) {
      return { tierIndex: i, priceCap: tier.price, remainingBtc: cumulative - params.spentBtc };
    }
  }
  return { tierIndex: -1, priceCap: 0, remainingBtc: 0 };
}

// ---------------------------------------------------------------------------
// Drawdown-scaled DCA: every `intervalHours` the bot may buy N chunks, where N
// grows with how far the ask sits BELOW a reference moving average of the
// exchange's own candles. Each band owns a share of the budget, so a long slide
// cannot exhaust the money meant for deeper prices.
// ---------------------------------------------------------------------------

export interface DcaBand {
  /** Active once the ask is at least this many % below the reference MA (negative = above it). */
  discountPct: number;
  /** Chunks (of chunkXbt) the bot may buy per interval while this band is the deepest active one. */
  chunks: number;
  /** This band's own interval in hours; falls back to DcaConfig.intervalHours. Deeper discount can use a shorter interval. */
  intervalHours?: number;
  /** Share of the total budget (percent) this band may spend in total. */
  budgetPct: number;
}

export interface DcaConfig {
  intervalHours: number;
  /** Exchange candle interval used for the reference MA ("1h" | "4h" | "1d"). */
  candleInterval: string;
  maPeriod: number;
  /** Hard ceiling for any buy price (BTC); 0 = off. */
  maxPrice: number;
  bands: DcaBand[];
}

export const DEFAULT_DCA: DcaConfig = {
  intervalHours: 4,
  candleInterval: "4h",
  maPeriod: 30,
  maxPrice: 0,
  bands: [
    { discountPct: -15, chunks: 1, intervalHours: 4, budgetPct: 10 },
    { discountPct: 10, chunks: 1, intervalHours: 2, budgetPct: 20 },
    { discountPct: 20, chunks: 1, intervalHours: 1, budgetPct: 25 },
    { discountPct: 25, chunks: 2, intervalHours: 1, budgetPct: 25 },
    { discountPct: 35, chunks: 3, intervalHours: 1, budgetPct: 20 },
  ],
};

export interface BandWindow {
  id: number;
  chunks: number;
}

export function sortBands(bands: DcaBand[]): DcaBand[] {
  return [...bands].sort((a, b) => a.discountPct - b.discountPct);
}

export interface Candle {
  time: number;
  close: number;
}

/** Simple moving average of the last `period` closes (including the forming candle, as the chart does). Null if not enough data. */
export function maFromCandles(candles: Candle[], period: number): number | null {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  if (period < 1 || sorted.length < period) return null;
  const last = sorted.slice(-period);
  return last.reduce((s, c) => s + c.close, 0) / period;
}

export function windowIndex(now: number, intervalHours: number): number {
  return Math.floor(now / (intervalHours * 3_600_000));
}

export interface DcaPlan {
  /** Band index in sorted order, or -1 when nothing may be bought now. */
  bandIndex: number;
  bandKey: number | null;
  priceCap: number;
  remainingBtc: number;
  discountPct: number;
  chunksAllowed: number;
  /** Chunks already bought in the active band's current window, and that window's id / length. */
  windowChunks: number;
  windowId: number;
  intervalHours: number;
  reason: string;
}

export function bandIntervalHours(dca: DcaConfig, band: DcaBand): number {
  return band.intervalHours && band.intervalHours > 0 ? band.intervalHours : dca.intervalHours;
}

export function planDca(params: {
  dca: DcaConfig;
  budgetBtc: number;
  bandSpent: Record<string, number>;
  /** Per-band interval windows (keyed by band discountPct), see BandWindow. */
  windows: Record<string, BandWindow>;
  now: number;
  ma: number;
  bestAsk: number;
  /** true when judging an already-open order (it already counts toward the window). */
  ignoreWindow?: boolean;
}): DcaPlan {
  const none = (reason: string, discountPct: number): DcaPlan => ({
    bandIndex: -1,
    bandKey: null,
    priceCap: 0,
    remainingBtc: 0,
    discountPct,
    chunksAllowed: 0,
    windowChunks: 0,
    windowId: 0,
    intervalHours: params.dca.intervalHours,
    reason,
  });
  const bands = sortBands(params.dca.bands);
  const discountPct = ((params.ma - params.bestAsk) / params.ma) * 100;
  let idx = -1;
  for (let i = 0; i < bands.length; i++) if (discountPct >= bands[i]!.discountPct) idx = i;
  if (idx < 0) return none(`ask is ${(-discountPct).toFixed(1)}% above the reference, beyond the highest band`, discountPct);
  const band = bands[idx]!;
  if (params.dca.maxPrice > 0 && params.bestAsk > params.dca.maxPrice) return none("ask above the max price ceiling", discountPct);
  if (band.chunks <= 0) return none("active band buys 0 chunks", discountPct);
  const cap = (params.budgetBtc * band.budgetPct) / 100;
  const remaining = cap - (params.bandSpent[String(band.discountPct)] ?? 0);
  if (remaining <= 1e-7) return none(`band budget used (${band.budgetPct}% of budget)`, discountPct);
  const hours = bandIntervalHours(params.dca, band);
  const windowId = windowIndex(params.now, hours);
  const w = params.windows[String(band.discountPct)];
  const windowChunks = w && w.id === windowId ? w.chunks : 0;
  if (!params.ignoreWindow && windowChunks >= band.chunks - 1e-6) {
    return none(`interval quota reached (${band.chunks} chunk${band.chunks === 1 ? "" : "s"} per ${hours}h)`, discountPct);
  }
  const ceil = bands[0]!.discountPct;
  const priceCap = Math.min(params.dca.maxPrice > 0 ? params.dca.maxPrice : Infinity, params.ma * (1 - ceil / 100));
  return {
    bandIndex: idx,
    bandKey: band.discountPct,
    priceCap,
    remainingBtc: remaining,
    discountPct,
    chunksAllowed: band.chunks,
    windowChunks,
    windowId,
    intervalHours: hours,
    reason: "ok",
  };
}

/** floor to `digits` decimals (for buy prices) without float drift */
export function floorTo(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.floor(value * f + 1e-9) / f;
}

/**
 * Buy price for a chunk. Post-only: one tick above the best bid, but strictly
 * below the best ask and the AMM pool's ask threshold (a post-only order that
 * would match is rejected), never above the tier cap. Otherwise a normal limit
 * at min(tier cap, best ask).
 */
export function chunkPrice(params: {
  postOnly: boolean;
  priceCap: number;
  bestBid: number;
  bestAsk: number;
  pool?: { reserveBase: number; reserveQuote: number; feeRate: number; enabled: boolean };
  pricePrecision: number;
}): number {
  const tick = 10 ** -params.pricePrecision;
  if (!params.postOnly) return floorTo(Math.min(params.priceCap, params.bestAsk), params.pricePrecision);
  let ceiling = Math.min(params.priceCap, params.bestAsk - tick);
  if (params.pool?.enabled && params.pool.reserveBase > 0) {
    const poolAsk = params.pool.reserveQuote / (params.pool.reserveBase * (1 - params.pool.feeRate));
    ceiling = Math.min(ceiling, poolAsk - tick);
  }
  const target = Math.min(params.bestBid + tick, ceiling);
  return floorTo(target, params.pricePrecision);
}
