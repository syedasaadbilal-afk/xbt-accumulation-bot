/**
 * Push alerts through ntfy (https://ntfy.sh): a plain-text POST to a private topic
 * the owner subscribes to in the ntfy phone app. The topic name is the secret, no
 * credentials are stored, and messages carry only balances / error text.
 */
export const FLOAT_REMIND_MS = 24 * 3_600_000;
export const ERROR_REMIND_MS = 6 * 3_600_000;
export const ERROR_THRESHOLD = 5; // consecutive failed ticks (~2.5 min at 30 s)

export interface AlertDecision {
  sendFloat: boolean;
  /** Float recovered after an alert: forget it so the next dip alerts immediately. */
  clearFloat: boolean;
  sendError: boolean;
}

export function evaluateAlerts(p: {
  now: number;
  availableBtc: number | null;
  warnBelowBtc: number;
  lastFloatAlertAt: number | null;
  consecutiveErrors: number;
  lastErrorAlertAt: number | null;
}): AlertDecision {
  const low = p.availableBtc !== null && p.availableBtc < p.warnBelowBtc;
  return {
    sendFloat: low && (p.lastFloatAlertAt === null || p.now - p.lastFloatAlertAt >= FLOAT_REMIND_MS),
    clearFloat: !low && p.availableBtc !== null && p.lastFloatAlertAt !== null,
    sendError: p.consecutiveErrors >= ERROR_THRESHOLD && (p.lastErrorAlertAt === null || p.now - p.lastErrorAlertAt >= ERROR_REMIND_MS),
  };
}

export const TOPIC_RE = /^[A-Za-z0-9_-]{8,64}$/;

export async function sendNtfy(opts: {
  topic: string;
  title: string;
  message: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!TOPIC_RE.test(opts.topic)) throw new Error("invalid alert topic");
  const base = (process.env.NTFY_BASE_URL ?? "https://ntfy.sh").replace(/\/+$/, "");
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${base}/${opts.topic}`, {
    method: "POST",
    // header values must be plain ASCII
    headers: { Title: opts.title, Priority: String(opts.priority ?? 3), ...(opts.tags ? { Tags: opts.tags } : {}) },
    body: opts.message,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}
