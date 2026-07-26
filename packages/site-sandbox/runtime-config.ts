import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  expectedSiteSandboxManifest,
  sandboxImageDigest
} from "@/packages/site-contracts";
import { computeSiteToolchainIdentity } from "@/scripts/site-sandbox-manifest";

export const developmentSandboxWorkerName = "lodesta-site-sandbox-v1-dev";
export const developmentSandboxReceiptPath = ".data/site-sandbox-dev.json";
export const developmentSandboxTokenPath = ".data/site-sandbox-dev-token";
export const developmentSandboxConfigPath = "workers/site-sandbox/wrangler.dev.jsonc";

export type SiteSandboxManifest = {
  kind: "site-sandbox-manifest";
  artifactContractIdentity: string;
  toolchainIdentity: string;
  sourcePolicyIdentity: string;
};

export type DevelopmentSandboxReceipt = {
  schemaVersion: 1;
  workerName: typeof developmentSandboxWorkerName;
  url: string;
  imageDigest: `sha256:${string}`;
  sandboxManifest: SiteSandboxManifest;
  devConfigHash: `sha256:${string}`;
  deployedAt: string;
};

export type SiteSandboxRuntime = {
  mode: "development" | "production";
  url: string;
  token: string;
  imageDigest: `sha256:${string}`;
  sandboxManifest: SiteSandboxManifest;
};

export function configuredSiteSandboxRuntime(
  environment: NodeJS.ProcessEnv = process.env,
  root = process.cwd()
): SiteSandboxRuntime {
  if (environment.LODESTA_DEV_SANDBOX === "1") {
    const receipt = readDevelopmentSandboxReceipt(root);
    const token = readDevelopmentSandboxToken(environment, root);
    if (receipt.devConfigHash !== computeDevelopmentSandboxConfigHash(root)) {
      throw new Error("Development sandbox configuration changed. Run npm run deploy:site-sandbox:dev.");
    }
    if (!sameManifest(receipt.sandboxManifest, expectedSiteSandboxManifest)) {
      throw new Error("Development sandbox receipt has a stale manifest. Run npm run deploy:site-sandbox:dev.");
    }
    assertSeparateDevelopmentCredentials(receipt.url, token, environment);
    return {
      mode: "development",
      url: receipt.url,
      token,
      imageDigest: receipt.imageDigest,
      sandboxManifest: receipt.sandboxManifest
    };
  }

  if (environment.NODE_ENV === "production" && !hasProductionReleaseMarker(environment)) {
    throw new Error("Production sandbox access requires a valid release SHA and non-loopback HTTPS app origin.");
  }
  const url = environment.LODESTA_SANDBOX_URL?.trim();
  const token = environment.LODESTA_SANDBOX_TOKEN?.trim();
  if (!url || !token) throw new Error("Cloudflare Sandbox requires LODESTA_SANDBOX_URL and LODESTA_SANDBOX_TOKEN.");
  assertHttpsUrl(url, "Production sandbox URL");
  const configuredDigest = environment.LODESTA_SANDBOX_IMAGE_DIGEST?.trim();
  if (configuredDigest && !isImageDigest(configuredDigest)) {
    throw new Error("LODESTA_SANDBOX_IMAGE_DIGEST must be a SHA-256 content digest.");
  }
  return {
    mode: "production",
    url,
    token,
    imageDigest: (configuredDigest || sandboxImageDigest) as `sha256:${string}`,
    sandboxManifest: expectedSiteSandboxManifest
  };
}

export async function assertConfiguredSiteSandboxRuntimeReady(
  environment: NodeJS.ProcessEnv = process.env,
  root = process.cwd()
) {
  if (environment.LODESTA_REPOSITORY === "local" && environment.LODESTA_DEV_SANDBOX !== "1") return;
  const runtime = configuredSiteSandboxRuntime(environment, root);
  if (runtime.mode === "development") {
    const identity = await computeSiteToolchainIdentity(root);
    if (identity !== runtime.sandboxManifest.toolchainIdentity) {
      throw new Error("Development sandbox source changed. Run npm run deploy:site-sandbox:dev.");
    }
  }
  return runtime;
}

export function configuredSiteSandboxImageDigest(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.LODESTA_DEV_SANDBOX === "1") {
    return configuredSiteSandboxRuntime(environment).imageDigest;
  }
  const configured = environment.LODESTA_SANDBOX_IMAGE_DIGEST?.trim();
  if (!configured) return sandboxImageDigest;
  if (!isImageDigest(configured)) {
    throw new Error("LODESTA_SANDBOX_IMAGE_DIGEST must be a SHA-256 content digest.");
  }
  return configured;
}

export function readDevelopmentSandboxReceipt(root = process.cwd()): DevelopmentSandboxReceipt {
  const path = resolve(root, developmentSandboxReceiptPath);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Development sandbox is not deployed. Run npm run deploy:site-sandbox:dev.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Development sandbox receipt is malformed. Run npm run deploy:site-sandbox:dev.");
  }
  const receipt = value as Record<string, unknown>;
  const keys = Object.keys(receipt).sort().join(",");
  if (keys !== "deployedAt,devConfigHash,imageDigest,sandboxManifest,schemaVersion,url,workerName"
    || receipt.schemaVersion !== 1
    || receipt.workerName !== developmentSandboxWorkerName
    || typeof receipt.url !== "string"
    || !isImageDigest(receipt.imageDigest)
    || !isSha256(receipt.devConfigHash)
    || typeof receipt.deployedAt !== "string"
    || !Number.isFinite(Date.parse(receipt.deployedAt))
    || !validManifest(receipt.sandboxManifest)) {
    throw new Error("Development sandbox receipt is malformed. Run npm run deploy:site-sandbox:dev.");
  }
  assertDevelopmentSandboxUrl(receipt.url);
  return receipt as DevelopmentSandboxReceipt;
}

export function readDevelopmentSandboxToken(
  environment: NodeJS.ProcessEnv = process.env,
  root = process.cwd()
) {
  const configured = environment.LODESTA_DEV_SANDBOX_TOKEN?.trim();
  if (configured) {
    if (!isDevelopmentSandboxToken(configured)) {
      throw new Error("LODESTA_DEV_SANDBOX_TOKEN is malformed.");
    }
    return configured;
  }
  let token: string;
  try {
    token = readFileSync(resolve(root, developmentSandboxTokenPath), "utf8").trim();
  } catch {
    throw new Error("Development sandbox credentials are missing. Run npm run dev to configure them.");
  }
  if (!isDevelopmentSandboxToken(token)) {
    throw new Error("Development sandbox credentials are malformed. Run npm run dev to replace them.");
  }
  return token;
}

export function computeDevelopmentSandboxConfigHash(root = process.cwd()) {
  const bytes = readFileSync(resolve(root, developmentSandboxConfigPath));
  const hash = createHash("sha256");
  hash.update("lodesta-site-sandbox-dev-config\0");
  hash.update(String(bytes.byteLength));
  hash.update("\0");
  hash.update(bytes);
  return `sha256:${hash.digest("hex")}` as const;
}

export function hasProductionReleaseMarker(environment: NodeJS.ProcessEnv = process.env) {
  if (!/^[a-f0-9]{40}$/.test(environment.LODESTA_RELEASE_GIT_SHA?.trim() ?? "")) return false;
  const source = environment.LODESTA_APP_ORIGIN?.trim();
  if (!source) return false;
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function assertSeparateDevelopmentCredentials(url: string, token: string, environment: NodeJS.ProcessEnv) {
  const productionUrl = environment.LODESTA_SANDBOX_URL?.trim();
  const productionToken = environment.LODESTA_SANDBOX_TOKEN?.trim();
  if (productionUrl && normalizeUrl(productionUrl) === normalizeUrl(url)) {
    throw new Error("Development and production sandbox URLs must differ.");
  }
  if (productionToken && safeEqual(productionToken, token)) {
    throw new Error("Development and production sandbox tokens must differ.");
  }
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "").toLowerCase();
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function assertHttpsUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
}

function assertDevelopmentSandboxUrl(value: string) {
  assertHttpsUrl(value, "Development sandbox URL");
  const url = new URL(value);
  if (!url.hostname.startsWith(`${developmentSandboxWorkerName}.`)
    || !url.hostname.endsWith(".workers.dev")
    || url.pathname !== "/"
    || url.search
    || url.hash) {
    throw new Error("Development sandbox URL must be the dedicated workers.dev root URL.");
  }
}

function validManifest(value: unknown): value is SiteSandboxManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  return Object.keys(manifest).sort().join(",") === "artifactContractIdentity,kind,sourcePolicyIdentity,toolchainIdentity"
    && manifest.kind === "site-sandbox-manifest"
    && typeof manifest.artifactContractIdentity === "string"
    && typeof manifest.toolchainIdentity === "string"
    && typeof manifest.sourcePolicyIdentity === "string";
}

function sameManifest(left: SiteSandboxManifest, right: SiteSandboxManifest) {
  return left.kind === right.kind
    && left.artifactContractIdentity === right.artifactContractIdentity
    && left.toolchainIdentity === right.toolchainIdentity
    && left.sourcePolicyIdentity === right.sourcePolicyIdentity;
}

function isImageDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

export function isDevelopmentSandboxToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}
