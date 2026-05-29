import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shellEnvKeys = new Set(Object.keys(process.env));

for (const fileName of [".env", ".env.local"]) {
  loadEnvFile(resolve(rootDir, fileName));
}

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;

  const values = parseEnvFile(readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (shellEnvKeys.has(key)) continue;
    process.env[key] = value;
  }
}

function parseEnvFile(source: string) {
  const parsed: Record<string, string> = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    parsed[key] = normalizeEnvValue(rawValue);
  }

  return parsed;
}

function normalizeEnvValue(rawValue: string) {
  const value = rawValue.trim();
  const quote = value[0];
  if ((quote === `"` || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1).replace(/\\n/g, "\n");
  }

  return value.replace(/\s+#.*$/, "");
}
