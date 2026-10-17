/**
 * Minimal Neoxa Exchange REST client (https://neoxa.exchange/api-docs).
 * Auth is two plain headers (X-API-Key / X-API-Secret, no HMAC), so the key's
 * IP allow list is the main protection - create read+trade keys only. The API
 * exposes NO deposit/withdraw endpoints; funds are moved by hand on the site.
 * Symbols are ledger symbols: Bitcoin BLAKE2b is BTCB2 (shown as XBT on site).
 */
export interface NeoxaBookLevel {
  price: number;
  quantity: number;
  isAmm?: boolean;
}

export interface NeoxaOrderBook {
  bids: NeoxaBookLevel[];
  asks: NeoxaBookLevel[];
  pool?: { reserveBase: number; reserveQuote: number; feeRate: number; enabled: boolean };
}

export interface NeoxaPairInfo {
  pair: string;
  minQuantity: number;
  pricePrecision: number;
  quantityPrecision: number;
  tradingPaused: boolean;
  makerFeeRate: number;
  takerFeeRate: number;
}

export interface NeoxaOrder {
  order_id: string;
  pair: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  quantity_filled: number;
  quantity_remaining: number;
  status: string;
  post_only?: boolean;
}

export interface NeoxaBalance {
  available: number;
  locked: number;
  total: number;
  in_orders: number;
}

export interface NeoxaClientConfig {
  baseUrl?: string;
  apiKey: string;
  apiSecret: string;
  fetchImpl?: typeof fetch;
  /** Min ms between requests (limit is 600/min per IP; keep well below). */
  minIntervalMs?: number;
}

export class NeoxaClient {
  private lastAt = 0;
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(private readonly cfg: NeoxaClientConfig) {
    this.base = (cfg.baseUrl ?? "https://neoxa.exchange").replace(/\/+$/, "");
    this.f = cfg.fetchImpl ?? fetch;
  }

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, auth = false): Promise<T> {
    const gap = this.cfg.minIntervalMs ?? 150;
    const wait = this.lastAt + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastAt = Date.now();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      headers["X-API-Key"] = this.cfg.apiKey;
      headers["X-API-Secret"] = this.cfg.apiSecret;
    }
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      // Node's fetch hides the real reason in err.cause (ENOTFOUND, ETIMEDOUT, ECONNREFUSED, TLS...).
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      const why = cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
      throw new Error(`Neoxa ${method} ${path} -> network error: ${why} (host ${this.base})`);
    }
    const text = await res.text();
    let json: { success?: boolean; error?: string; code?: string } & Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Neoxa ${method} ${path} -> HTTP ${res.status}, non-JSON response`);
    }
    if (!res.ok || json.success === false) {
      throw new Error(`Neoxa ${method} ${path} -> HTTP ${res.status} ${json.code ?? ""} ${json.error ?? ""}`.trim());
    }
    return json as T;
  }

  async getPairInfo(pair: string): Promise<NeoxaPairInfo> {
    const r = await this.request<{ pairs: NeoxaPairInfo[] }>("GET", "/api/exchange/pairs");
    const p = r.pairs.find((x) => x.pair === pair);
    if (!p) throw new Error(`Neoxa pair ${pair} not found`);
    return p;
  }

  async getOrderBook(pair: string, depth = 10): Promise<NeoxaOrderBook> {
    const r = await this.request<NeoxaOrderBook>("GET", `/api/exchange/orderbook/${pair}?depth=${depth}`);
    return { bids: r.bids ?? [], asks: r.asks ?? [], ...(r.pool ? { pool: r.pool } : {}) };
  }

  async getTicker(pair: string): Promise<{ lastPrice: number; bestBid: number; bestAsk: number; volume24h: number; quoteVolume24h: number }> {
    const r = await this.request<{ ticker: { lastPrice: number; bestBid: number; bestAsk: number; volume24h: number; quoteVolume24h: number } }>(
      "GET",
      `/api/exchange/ticker/${pair}`
    );
    return r.ticker;
  }

  /** Public OHLCV candles (oldest first not guaranteed; callers sort by time). */
  async getCandles(pair: string, interval: string, limit: number): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>> {
    const r = await this.request<{ candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> }>(
      "GET",
      `/api/exchange/candles/${pair}?interval=${encodeURIComponent(interval)}&limit=${limit}`
    );
    return r.candles ?? [];
  }

  async getBalances(): Promise<Record<string, NeoxaBalance>> {
    const r = await this.request<{ balances: Record<string, NeoxaBalance> }>("GET", "/api/exchange/balances", undefined, true);
    return r.balances ?? {};
  }

  async getActiveOrders(pair: string): Promise<NeoxaOrder[]> {
    const r = await this.request<{ orders: NeoxaOrder[] }>("GET", `/api/exchange/orders?status=active&pair=${pair}&limit=100`, undefined, true);
    return r.orders ?? [];
  }

  async getOrderHistory(limit = 100): Promise<NeoxaOrder[]> {
    const r = await this.request<{ orders: NeoxaOrder[] }>("GET", `/api/exchange/orders/history?limit=${limit}`, undefined, true);
    return r.orders ?? [];
  }

  async placeOrder(o: { pair: string; side: "buy" | "sell"; quantity: number; price: number; postOnly: boolean }): Promise<NeoxaOrder> {
    const r = await this.request<{ order: NeoxaOrder }>(
      "POST",
      "/api/exchange/order",
      { pair: o.pair, side: o.side, quantity: o.quantity, price: o.price, ...(o.postOnly ? { postOnly: true } : {}) },
      true
    );
    return r.order;
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request("DELETE", `/api/exchange/order/${encodeURIComponent(orderId)}`, undefined, true);
  }
}
