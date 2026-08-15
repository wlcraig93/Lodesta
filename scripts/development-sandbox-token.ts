import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  developmentSandboxTokenPath,
  isDevelopmentSandboxToken
} from "../packages/site-sandbox/runtime-config";
import type { SiteSandboxSlot } from "../packages/site-contracts";

export async function ensureDevelopmentSandboxToken(
  slot: SiteSandboxSlot,
  environment: NodeJS.ProcessEnv = process.env,
  root = process.cwd()
) {
  const key = `LODESTA_DEV_SANDBOX_${slot.toUpperCase()}_TOKEN`;
  const configured = environment[key]?.trim();
  if (configured) {
    if (!isDevelopmentSandboxToken(configured)) {
      throw new Error(`${key} is malformed.`);
    }
    return { token: configured, created: false, source: "environment" as const };
  }

  const path = resolve(root, developmentSandboxTokenPath(slot));
  const retained = await readFile(path, "utf8").catch(() => undefined);
  if (retained !== undefined) {
    const token = retained.trim();
    if (!isDevelopmentSandboxToken(token)) {
      throw new Error(`Development ${slot} sandbox credentials are malformed at ${developmentSandboxTokenPath(slot)}.`);
    }
    return { token, created: false, source: "file" as const };
  }

  const token = randomBytes(32).toString("base64url");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${token}\n`, { mode: 0o600, flag: "wx" });
  return { token, created: true, source: "file" as const };
}
