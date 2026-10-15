import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db/connection.js";
import { applyMigrations } from "./db/migrate.js";
import { createServer } from "./server.js";
import { NeoxaService } from "./neoxa/service.js";

const DB_PATH = process.env.XBT_DB_PATH ?? "./xbt.sqlite";
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT ?? 8787);
const TICK_MS = Number(process.env.XBT_TICK_MS ?? 30_000);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_STATIC_DIR = process.env.DASHBOARD_STATIC_DIR ?? path.join(__dirname, "..", "public");

async function main() {
  const db = openDatabase(DB_PATH);
  applyMigrations(db);
  const neoxa = new NeoxaService(DB_PATH, db);

  console.log(`[xbt] starting (tick every ${TICK_MS} ms). The bot does nothing until it is enabled in the dashboard.`);
  await createServer({ neoxa, port: DASHBOARD_PORT, staticDir: DASHBOARD_STATIC_DIR, dbPath: DB_PATH });

  const tick = () => neoxa.tick().catch((err) => console.error("[xbt] tick failed:", err));
  await tick();
  setInterval(tick, TICK_MS);
}

main().catch((err) => {
  console.error("[xbt] fatal:", err);
  process.exit(1);
});
