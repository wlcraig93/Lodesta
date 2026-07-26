import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  developmentSandboxTokenPath,
  isDevelopmentSandboxToken
} from "../packages/site-sandbox/runtime-config";

export async function ensureDevelopmentSandboxToken(
  environment: NodeJS.ProcessEnv = process.env,
  root = process.cwd()
) {
  const configured = environment.LODESTA_DEV_SANDBOX_TOKEN?.trim();
  if (configured) {
    if (!isDevelopmentSandboxToken(configured)) {
      throw new Error("LODESTA_DEV_SANDBOX_TOKEN is malformed.");
    }
    return { token: configured, created: false, source: "environment" as const };
  }

  const path = resolve(root, developmentSandboxTokenPath);
  const retained = await readFile(path, "utf8").catch(() => undefined);
  if (retained !== undefined) {
    const token = retained.trim();
    if (!isDevelopmentSandboxToken(token)) {
      throw new Error(`Development sandbox credentials are malformed at ${developmentSandboxTokenPath}.`);
    }
    return { token, created: false, source: "file" as const };
  }

  const token = randomBytes(32).toString("base64url");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${token}\n`, { mode: 0o600, flag: "wx" });
  return { token, created: true, source: "file" as const };
}
