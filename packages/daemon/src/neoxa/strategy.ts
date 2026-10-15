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
