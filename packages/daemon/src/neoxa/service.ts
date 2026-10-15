import type { DatabaseSyncLike } from "../db/types.js";
import { hasNeoxaSecrets, readNeoxaSecrets } from "../secrets.js";
import { NeoxaClient, type NeoxaBalance } from "./client.js";
import { runNeoxaTick, type NeoxaTickResult } from "./bot.js";
import { NeoxaStore } from "./store.js";
import { planNextChunk, sortTiers } from "./strategy.js";

const BASE_URL = () => process.env.NEOXA_BASE_URL ?? "https://neoxa.exchange";

/** Wires the Neoxa bot to the daemon: credentials, tick loop guard, dashboard status. */
export class NeoxaService {
  readonly store: NeoxaStore;
  lastResult: NeoxaTickResult | null = null;
  lastTickAt: number | null = null;
  private running = false;

  constructor(
    private readonly dbPath: string,
    db: DatabaseSyncLike,
    private readonly fetchImpl?: typeof fetch
  ) {
    this.store = new NeoxaStore(db);
  }

  private client(): NeoxaClient {
    const s = readNeoxaSecrets(this.dbPath);
    return new NeoxaClient({
      baseUrl: BASE_URL(),
      apiKey: s.apiKey,
      apiSecret: s.apiSecret,
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });
  }

  async tick(): Promise<void> {
    if (this.running) return;
    if (!hasNeoxaSecrets(this.dbPath)) {
      this.lastResult = { action: "idle", detail: "Neoxa API key not configured" };
      return;
    }
    const cfg = this.store.getConfig();
    const state = this.store.getState();
    // Nothing to do and nothing open: skip all network calls.
    if (!cfg.enabled && !state.openOrderId) {
      this.lastResult = { action: "disabled", detail: "bot is disabled" };
      return;
    }
    this.running = true;
    try {
      const res = await runNeoxaTick({ client: this.client(), store: this.store });
      this.lastResult = res;
      this.lastTickAt = Date.now();
      if (res.action !== "waiting" && res.action !== "idle") console.log(`[neoxa] ${res.action}: ${res.detail}`);
    } finally {
      this.running = false;
    }
  }

  /** Cancels the bot's open order (kill switch). */
  async cancelOpenOrder(): Promise<{ cancelled: boolean }> {
    const state = this.store.getState();
    if (!state.openOrderId || !hasNeoxaSecrets(this.dbPath)) return { cancelled: false };
    await this.client().cancelOrder(state.openOrderId);
    this.lastResult = { action: "cancelled", detail: "open order cancelled from dashboard" };
    // The next tick settles the fill accounting for the cancelled order.
    return { cancelled: true };
  }

  async status() {
    const cfg = this.store.getConfig();
    const state = this.store.getState();
    const configured = hasNeoxaSecrets(this.dbPath);
    const c = this.client();
    let ticker: Awaited<ReturnType<NeoxaClient["getTicker"]>> | null = null;
    let balances: Record<string, NeoxaBalance> | null = null;
    let error: string | null = null;
    try {
      ticker = await c.getTicker(cfg.pair);
      if (configured) balances = await c.getBalances();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const tiers = sortTiers(cfg.tiers);
    let cumulative = 0;
    const tierStatus = tiers.map((t, i) => {
      cumulative += (t.pct / 100) * cfg.budgetBtc;
      return {
        index: i + 1,
        price: t.price,
        pct: t.pct,
        cumulativeBtc: cumulative,
        active: ticker ? ticker.bestAsk <= t.price : false,
      };
    });
    const next = ticker ? planNextChunk({ tiers: cfg.tiers, budgetBtc: cfg.budgetBtc, spentBtc: state.spentBtc, bestAsk: ticker.bestAsk }) : null;
    return {
      configured,
      config: cfg,
      state,
      ticker,
      balances: balances
        ? { BTC: balances["BTC"] ?? null, XBT: balances["BTCB2"] ?? balances["XBT"] ?? null }
        : null,
      tiers: tierStatus,
      nextTier: next && next.tierIndex >= 0 ? next.tierIndex + 1 : null,
      lastResult: this.lastResult,
      lastTickAt: this.lastTickAt,
      recentOrders: this.store.recentOrders(30),
      error,
    };
  }
}
