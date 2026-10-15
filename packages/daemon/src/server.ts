import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import { hasNeoxaSecrets, writeNeoxaSecrets } from "./secrets.js";
import type { NeoxaService } from "./neoxa/service.js";

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
          resetCounters?: boolean;
        }
      | undefined;
    const tiers = b?.tiers;
    const okNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
    if (
      typeof b?.enabled !== "boolean" ||
      (b.mode !== "DRY_RUN" && b.mode !== "LIVE") ||
      typeof b.postOnly !== "boolean" ||
      !okNum(b.budgetBtc) ||
      b.budgetBtc < 0 ||
      !okNum(b.chunkXbt) ||
      b.chunkXbt <= 0 ||
      !Array.isArray(tiers) ||
      tiers.length < 1 ||
      tiers.length > 5 ||
      tiers.some((t) => !okNum(t.price) || t.price <= 0 || !okNum(t.pct) || t.pct <= 0)
    ) {
      reply.code(400);
      return { error: "invalid config: need enabled, mode, postOnly, budgetBtc>=0, chunkXbt>0 and 1-5 tiers with price>0 and pct>0" };
    }
    const pctSum = tiers.reduce((s, t) => s + (t.pct ?? 0), 0);
    if (pctSum > 100.0001) {
      reply.code(400);
      return { error: `tier percentages add up to ${pctSum}; the total must not exceed 100` };
    }
    const current = neoxa.store.getConfig();
    neoxa.store.setConfig({
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
      neoxa.store.setState({ ...st, spentBtc: 0, boughtXbt: 0 });
    }
    console.log(`[xbt] config changed via dashboard (enabled=${b.enabled}, mode=${b.mode}, budget=${b.budgetBtc} BTC).`);
    return { ok: true };
  });

  fastify.post("/api/cancel", async () => neoxa.cancelOpenOrder());
  fastify.post("/api/run-now", async () => {
    neoxa.tick().catch((err) => console.error("[xbt] manual tick failed:", err));
    return { started: true };
  });

  await fastify.listen({ port: opts.port, host: "0.0.0.0" });
  console.log(`[xbt] dashboard/API listening on :${opts.port}`);
  return fastify;
}
