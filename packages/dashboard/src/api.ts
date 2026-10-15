export interface NeoxaTierDto {
  price: number;
  pct: number;
}

export type BotMode = "DRY_RUN" | "LIVE";

export interface NeoxaStatus {
  configured: boolean;
  config: { enabled: boolean; mode: BotMode; pair: string; budgetBtc: number; chunkXbt: number; postOnly: boolean; tiers: NeoxaTierDto[] };
  state: { spentBtc: number; boughtXbt: number; openOrderId: string | null; openOrderPrice: number | null; openOrderQty: number | null };
  ticker: { lastPrice: number; bestBid: number; bestAsk: number; volume24h: number; quoteVolume24h: number } | null;
  balances: { BTC: { available: number; total: number; in_orders: number } | null; XBT: { available: number; total: number; in_orders: number } | null } | null;
  tiers: Array<{ index: number; price: number; pct: number; cumulativeBtc: number; active: boolean }>;
  nextTier: number | null;
  lastResult: { action: string; detail: string } | null;
  lastTickAt: number | null;
  recentOrders: Array<{ orderId: string; placedAt: number; price: number; quantity: number; filled: number; status: string; tier: number | null; note: string | null }>;
  error: string | null;
}

export async function fetchNeoxaStatus(): Promise<NeoxaStatus | undefined> {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) return undefined;
    return (await res.json()) as NeoxaStatus;
  } catch {
    return undefined;
  }
}

async function sendJson(method: "PUT" | "POST", url: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error ?? `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: "daemon unreachable" };
  }
}

export const saveNeoxaConfig = (cfg: {
  enabled: boolean;
  mode: BotMode;
  budgetBtc: number;
  chunkXbt: number;
  postOnly: boolean;
  tiers: NeoxaTierDto[];
  resetCounters: boolean;
}) => sendJson("PUT", "/api/config", cfg);
export const saveNeoxaSecrets = (apiKey: string, apiSecret: string) => sendJson("PUT", "/api/secrets", { apiKey, apiSecret });
export const neoxaCancelOpenOrder = () => sendJson("POST", "/api/cancel");
export const neoxaRunNow = () => sendJson("POST", "/api/run-now");
