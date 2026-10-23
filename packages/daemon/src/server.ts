import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import { hasNeoxaSecrets, writeNeoxaSecrets } from "./secrets.js";
import type { NeoxaService } from "./neoxa/service.js";
import { DEFAULT_DCA } from "./neoxa/strategy.js";
import { TOPIC_RE } from "./neoxa/alerts.js";

export interface CreateServerOptions {
  neoxa: NeoxaService;
  port: number;
  /** Built dashboard assets; skipped if missing (API still works). */
  staticDir?: string;
  /** SQLite path - the credentials file is stored next to it. */
  dbPath: string;
}

export async function createServer(opts: CreateServerOptions) {
  const { neoxa } = opts;
  const fastify = Fastify({ logger: false });

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    await fastify.register(fastifyStatic, { root: opts.staticDir });
    fastify.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api/")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  } else {
    console.warn(`[xbt] dashboard static dir not found (${opts.staticDir ?? "unset"}) - serving API only`);
  }

  fastify.get("/api/status", async () => neoxa.status());

  fastify.get("/api/secrets", async () => ({ configured: hasNeoxaSecrets(opts.dbPath) }));

  fastify.put("/api/secrets", async (req, reply) => {
    const body = req.body as { apiKey?: string; apiSecret?: string } | undefined;
    const apiKey = body?.apiKey?.trim();
    const apiSecret = body?.apiSecret?.trim();
    if (!apiKey || !apiSecret) {
      reply.code(400);
      return { error: "apiKey and apiSecret are both required" };
    }
    writeNeoxaSecrets(opts.dbPath, { apiKey, apiSecret });
    console.log("[xbt] Neoxa API credentials updated via dashboard.");
    return { configured: true };
  });

  fastify.put("/api/config", async (req, reply) => {
    const b = req.body as
      | {
          enabled?: boolean;
          mode?: string;
          budgetBtc?: number;
          chunkXbt?: number;
          postOnly?: boolean;
          tiers?: Array<{ price?: number; pct?: number }>;
          strategy?: string;
          floatWarnBtc?: number;
          alertTopic?: string;
          dca?: {
            intervalHours?: number;
            candleInterval?: string;
            maPeriod?: number;
            maxPrice?: number;
            bands?: Array<{ discountPct?: number; chunks?: number; budgetPct?: number; intervalHours?: number }>;
          };
          resetCounters?: boolean;
        }
      | undefined;
    const current = neoxa.store.getConfig();
    const okNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
    const strategy = b?.strategy === "TIERS" ? "TIERS" : "DCA";
    const tiers = b?.tiers ?? current.tiers;
    if (
      typeof b?.enabled !== "boolean" ||
      (b.mode !== "DRY_RUN" && b.mode !== "LIVE") ||
      typeof b.postOnly !== "boolean" ||
      !okNum(b.budgetBtc) ||
      b.budgetBtc < 0 ||
      !okNum(b.chunkXbt) ||
      b.chunkXbt <= 0
    ) {
      reply.code(400);
      return { error: "invalid config: need enabled, mode, postOnly, budgetBtc>=0 and chunkXbt>0" };
    }
    if (tiers.length < 1 || tiers.length > 5 || tiers.some((t) => !okNum(t.price) || t.price <= 0 || !okNum(t.pct) || t.pct <= 0)) {
      reply.code(400);
      return { error: "invalid tiers: 1-5 tiers with price>0 and pct>0" };
    }
    if (tiers.reduce((s, t) => s + (t.pct ?? 0), 0) > 100.0001) {
      reply.code(400);
      return { error: "tier percentages must not add up to more than 100" };
    }
    let dca = current.dca ?? DEFAULT_DCA;
    if (b.dca) {
      const d = b.dca;
      const bands = d.bands;
      if (
        !okNum(d.intervalHours) || d.intervalHours < 0.25 || d.intervalHours > 168 ||
        !["1h", "4h", "1d"].includes(d.candleInterval ?? "") ||
        !okNum(d.maPeriod) || d.maPeriod < 2 || d.maPeriod > 200 ||
        !okNum(d.maxPrice) || d.maxPrice < 0 ||
        !Array.isArray(bands) || bands.length < 1 || bands.length > 8 ||
        bands.some((x) => !okNum(x.discountPct) || x.discountPct < -100 || x.discountPct > 95 || !okNum(x.chunks) || x.chunks < 0 || x.chunks > 50 || !okNum(x.budgetPct) || x.budgetPct <= 0 || (x.intervalHours !== undefined && (!okNum(x.intervalHours) || x.intervalHours < 0.25 || x.intervalHours > 168)))
      ) {
        reply.code(400);
        return { error: "invalid DCA settings (interval 0.25-168h, 1h/4h/1d candles, MA period 2-200, 1-8 bands with chunks>=0 and budget%>0)" };
      }
      if (new Set(bands.map((x) => x.discountPct)).size !== bands.length) {
        reply.code(400);
        return { error: "two bands have the same discount %" };
      }
      if (bands.some((x) => (x.budgetPct ?? 0) > 100)) {
        reply.code(400);
        return { error: "a band's share of the budget cannot exceed 100%" };
      }
      dca = {
        intervalHours: d.intervalHours,
        candleInterval: d.candleInterval as string,
        maPeriod: d.maPeriod,
        maxPrice: d.maxPrice,
        bands: bands.map((x) => ({
          discountPct: x.discountPct as number,
          chunks: x.chunks as number,
          budgetPct: x.budgetPct as number,
          ...(x.intervalHours !== undefined ? { intervalHours: x.intervalHours } : {}),
        })),
      };
    }
    if (b.floatWarnBtc !== undefined && (!okNum(b.floatWarnBtc) || b.floatWarnBtc < 0)) {
      reply.code(400);
      return { error: "floatWarnBtc must be a number >= 0" };
    }
    const alertTopic = b.alertTopic === undefined ? (current.alertTopic ?? "") : b.alertTopic.trim();
    if (alertTopic !== "" && !TOPIC_RE.test(alertTopic)) {
      reply.code(400);
      return { error: "alert topic must be 8-64 characters: letters, digits, - or _" };
    }
    neoxa.store.setConfig({
      strategy,
      dca,
      floatWarnBtc: b.floatWarnBtc ?? current.floatWarnBtc ?? 0.02,
      alertTopic,
      enabled: b.enabled,
      mode: b.mode,
      pair: current.pair,
      budgetBtc: b.budgetBtc,
      chunkXbt: b.chunkXbt,
      postOnly: b.postOnly,
      tiers: tiers.map((t) => ({ price: t.price as number, pct: t.pct as number })),
    });
    if (b.resetCounters) {
      const st = neoxa.store.getState();
      neoxa.store.setState({ ...st, spentBtc: 0, boughtXbt: 0, bandSpent: {}, windows: {} });
    }
    console.log(`[xbt] config changed via dashboard (enabled=${b.enabled}, mode=${b.mode}, budget=${b.budgetBtc} BTC).`);
    return { ok: true };
  });

  fastify.get("/api/larsson", async () => neoxa.larssonStatus());

  fastify.put("/api/larsson-config", async (req, reply) => {
    const b = req.body as { enabled?: boolean; paperSizeXbt?: number } | undefined;
    if (typeof b?.enabled !== "boolean" || typeof b.paperSizeXbt !== "number" || !Number.isFinite(b.paperSizeXbt) || b.paperSizeXbt <= 0 || b.paperSizeXbt > 100000) {
      reply.code(400);
      return { error: "need enabled (boolean) and paperSizeXbt (XBT) in (0, 100000]" };
    }
    neoxa.larsson.setConfig({ enabled: b.enabled, paperSizeXbt: b.paperSizeXbt });
    return { ok: true };
  });

  fastify.post("/api/alert-test", async () => neoxa.sendTestAlert());
  fastify.post("/api/cancel", async () => neoxa.cancelOpenOrder());
  fastify.post("/api/run-now", async () => {
    neoxa.tick().catch((err) => console.error("[xbt] manual tick failed:", err));
    return { started: true };
  });

  await fastify.listen({ port: opts.port, host: "0.0.0.0" });
  console.log(`[xbt] dashboard/API listening on :${opts.port}`);
  return fastify;
}
