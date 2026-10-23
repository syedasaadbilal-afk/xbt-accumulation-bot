export interface NeoxaTierDto {
  price: number;
  pct: number;
}

export type BotMode = "DRY_RUN" | "LIVE";

export interface DcaBandDto {
  discountPct: number;
  chunks: number;
  budgetPct: number;
  intervalHours?: number;
}

export interface DcaConfigDto {
  intervalHours: number;
  candleInterval: string;
  maPeriod: number;
  maxPrice: number;
  bands: DcaBandDto[];
}

export interface NeoxaStatus {
  configured: boolean;
  float: { availableBtc: number | null; warnBelowBtc: number; low: boolean; budgetRemainingBtc: number };
  dca: {
    ma: number | null;
    discountPct: number | null;
    windowChunks: number;
    nextWindowAt: number | null;
    activeBand: number | null;
    canBuyNow: boolean;
    reason: string | null;
    bands: Array<{
      index: number;
      discountPct: number;
      chunks: number;
      intervalHours: number;
      windowChunks: number;
      budgetPct: number;
      capBtc: number;
      spentBtc: number;
      active: boolean;
    }>;
  };
  config: {
    strategy: "DCA" | "TIERS";
    dca: DcaConfigDto;
    floatWarnBtc: number;
    alertTopic: string;
    enabled: boolean;
    mode: BotMode;
    pair: string;
    budgetBtc: number;
    chunkXbt: number;
    postOnly: boolean;
    tiers: NeoxaTierDto[];
  };
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
  strategy: "DCA" | "TIERS";
  dca: DcaConfigDto;
  floatWarnBtc: number;
  alertTopic: string;
  resetCounters: boolean;
}) => sendJson("PUT", "/api/config", cfg);
export const saveNeoxaSecrets = (apiKey: string, apiSecret: string) => sendJson("PUT", "/api/secrets", { apiKey, apiSecret });
export async function neoxaAlertTest(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/alert-test", { method: "POST" });
    return (await res.json()) as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: "daemon unreachable" };
  }
}
export interface LarssonBarDto {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  v1: number | null;
  m1: number | null;
  m2: number | null;
  v2: number | null;
  regime: "orange" | "navy" | "gray" | null;
  dist: number | null;
  confirmed: boolean;
}

export interface LarssonTradeDto {
  entryTime: number;
  entrySignal: number | null;
  entryActual: number | null;
  exitTime: number | null;
  exitSignal: number | null;
  exitActual: number | null;
  status: "open" | "closed";
  signalReturnPct: number | null;
  actualReturnPct: number | null;
}

export interface LarssonStatus {
  config: { enabled: boolean; paperSizeXbt: number };
  pair: string;
  error: string | null;
  barsCount: number;
  reliableBars: number;
  warmup: boolean;
  holding: boolean;
  current: { regime: "orange" | "navy" | "gray" | null; dist: number | null; confirmedBarTime: number } | null;
  ticker: { bestBid: number; bestAsk: number; lastPrice: number } | null;
  bars: LarssonBarDto[];
  signals: Array<{ signalBarTime: number; action: "enter" | "exit"; signalPrice: number | null; execTime: number }>;
  trades: LarssonTradeDto[];
  summary: { trades: number; closed: number; wins: number; signalReturnPct: number; actualReturnPct: number | null };
}

export async function fetchLarsson(): Promise<LarssonStatus | undefined> {
  try {
    const res = await fetch("/api/larsson");
    if (!res.ok) return undefined;
    return (await res.json()) as LarssonStatus;
  } catch {
    return undefined;
  }
}
export const saveLarssonConfig = (enabled: boolean, paperSizeXbt: number) => sendJson("PUT", "/api/larsson-config", { enabled, paperSizeXbt });

export const neoxaCancelOpenOrder = () => sendJson("POST", "/api/cancel");
export const neoxaRunNow = () => sendJson("POST", "/api/run-now");
