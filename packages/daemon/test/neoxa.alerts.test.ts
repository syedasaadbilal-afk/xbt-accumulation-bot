import { describe, expect, it } from "vitest";
import { ERROR_REMIND_MS, ERROR_THRESHOLD, FLOAT_REMIND_MS, TOPIC_RE, evaluateAlerts, sendNtfy } from "../src/neoxa/alerts.js";

const base = { now: 1_000_000_000, availableBtc: 0.05 as number | null, warnBelowBtc: 0.02, lastFloatAlertAt: null as number | null, consecutiveErrors: 0, lastErrorAlertAt: null as number | null };

describe("alert decisions", () => {
  it("alerts once when the float drops below the warning level, then reminds only after 24h", () => {
    expect(evaluateAlerts({ ...base, availableBtc: 0.03 }).sendFloat).toBe(false);
    expect(evaluateAlerts({ ...base, availableBtc: 0.01 }).sendFloat).toBe(true);
    const after = { ...base, availableBtc: 0.01, lastFloatAlertAt: base.now - 3_600_000 };
    expect(evaluateAlerts(after).sendFloat).toBe(false);
    expect(evaluateAlerts({ ...after, lastFloatAlertAt: base.now - FLOAT_REMIND_MS - 1 }).sendFloat).toBe(true);
  });

  it("forgets the alert after a top-up so the next dip alerts immediately", () => {
    const d = evaluateAlerts({ ...base, availableBtc: 0.1, lastFloatAlertAt: base.now - 1000 });
    expect(d.clearFloat).toBe(true);
    expect(d.sendFloat).toBe(false);
  });

  it("does not alert when the balance is unknown (network trouble)", () => {
    const d = evaluateAlerts({ ...base, availableBtc: null });
    expect(d.sendFloat).toBe(false);
    expect(d.clearFloat).toBe(false);
  });

  it("alerts after repeated tick errors and then at most every 6h", () => {
    expect(evaluateAlerts({ ...base, consecutiveErrors: ERROR_THRESHOLD - 1 }).sendError).toBe(false);
    expect(evaluateAlerts({ ...base, consecutiveErrors: ERROR_THRESHOLD }).sendError).toBe(true);
    expect(evaluateAlerts({ ...base, consecutiveErrors: 20, lastErrorAlertAt: base.now - 60_000 }).sendError).toBe(false);
    expect(evaluateAlerts({ ...base, consecutiveErrors: 20, lastErrorAlertAt: base.now - ERROR_REMIND_MS - 1 }).sendError).toBe(true);
  });
});

describe("ntfy sender", () => {
  it("posts plain text to the topic with ASCII headers", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    await sendNtfy({ topic: "xbt-abcdefghij", title: "XBT bot: BTC float low", message: "Only 0.01 BTC", priority: 4, tags: "warning", fetchImpl: f });
    expect(calls[0]!.url).toBe("https://ntfy.sh/xbt-abcdefghij");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBe("Only 0.01 BTC");
    expect((calls[0]!.init.headers as Record<string, string>).Priority).toBe("4");
  });

  it("rejects bad topics and surfaces HTTP errors", async () => {
    expect(TOPIC_RE.test("short")).toBe(false);
    expect(TOPIC_RE.test("has space in it")).toBe(false);
    await expect(sendNtfy({ topic: "bad topic!", title: "t", message: "m" })).rejects.toThrow("invalid alert topic");
    const f = (async () => ({ ok: false, status: 429 }) as Response) as unknown as typeof fetch;
    await expect(sendNtfy({ topic: "xbt-abcdefghij", title: "t", message: "m", fetchImpl: f })).rejects.toThrow("429");
  });
});
