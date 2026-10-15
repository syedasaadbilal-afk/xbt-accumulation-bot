import fs from "node:fs";
import path from "node:path";

export interface NeoxaSecrets {
  apiKey: string;
  apiSecret: string;
}

/** Neoxa credentials live in a 0600 file next to the DB inside the mounted data volume, never in the image. */
function secretsPath(dbPath: string): string {
  return path.join(path.dirname(dbPath), "neoxa-secrets.json");
}

export function readNeoxaSecrets(dbPath: string): NeoxaSecrets {
  try {
    const file = secretsPath(dbPath);
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<NeoxaSecrets>;
      if (parsed.apiKey && parsed.apiSecret) return { apiKey: parsed.apiKey, apiSecret: parsed.apiSecret };
    }
  } catch {
    // treated as not configured
  }
  return { apiKey: "", apiSecret: "" };
}

export function writeNeoxaSecrets(dbPath: string, secrets: NeoxaSecrets): void {
  const file = secretsPath(dbPath);
  fs.writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function hasNeoxaSecrets(dbPath: string): boolean {
  const s = readNeoxaSecrets(dbPath);
  return s.apiKey.length > 0 && s.apiSecret.length > 0;
}
