import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  expectedSiteSandboxManifest,
  siteSandboxSlotSchema,
  type SiteSandboxDeployment,
  type SiteSandboxManifest,
  type SiteSandboxSlot
} from "@/packages/site-contracts";
import { computeSiteToolchainIdentity } from "@/scripts/site-sandbox-manifest";
import { hasHostedReleaseIdentity } from "@/packages/execution-environment";
export type { SiteSandboxManifest } from "@/packages/site-contracts";

const developmentWorkerNames = {
  blue: "lodesta-site-sandbox-dev-blue",
  green: "lodesta-site-sandbox-dev-green"
} as const;

export function developmentSandboxWorkerName(slotInput: SiteSandboxSlot) {
  return developmentWorkerNames[siteSandboxSlotSchema.parse(slotInput)];
}

export function developmentSandboxReceiptPath(slotInput: SiteSandboxSlot) {
  const slot = siteSandboxSlotSchema.parse(slotInput);
  return `.data/site-sandbox-dev-${slot}.json`;
}

export function developmentSandboxTokenPath(slotInput: SiteSandboxSlot) {
  const slot = siteSandboxSlotSchema.parse(slotInput);
  return `.data/site-sandbox-dev-${slot}-token`;
}

export function developmentSandboxConfigPath(slotInput: SiteSandboxSlot) {
  const slot = siteSandboxSlotSchema.parse(slotInput);
  return `workers/site-sandbox/wrangler.dev.${slot}.jsonc`;
}

export type DevelopmentSandboxReceipt = {
  schemaVersion: 1;
  slot: SiteSandboxSlot;
  workerName: string;
  workerVersionId: string;
  releaseSha: string;
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

export function configuredSiteSandboxRuntimeForDeployment(
  deployment: SiteSandboxDeployment,
  environment: NodeJS.ProcessEnv = process.env,
  root = process.cwd()
): SiteSandboxRuntime {
  const slot = siteSandboxSlotSchema.parse(deployment.credentialSlot);
  if (environment.LODESTA_DEV_SANDBOX === "1") {
    const receipt = readDevelopmentSandboxReceipt(slot, root);
    const token = readDevelopmentSandboxToken(slot, environment, root);
    assertDevelopmentReceiptBindsDeployment(receipt, deployment);
    assertSeparateDevelopmentSlots(slot, receipt.url, token, environment, root);
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
  const runtime = configuredSiteSandboxRuntimeForSlot(slot, environment);
  if (!compatibleManifest(deployment.manifest, expectedSiteSandboxManifest)) {
    throw new Error(`Registered ${slot} sandbox deployment is incompatible with this controller.`);
  }
  return {
    mode: "production",
    ...runtime,
    imageDigest: asImageDigest(deployment.imageDigest),
    sandboxManifest: deployment.manifest
  };
}

export function configuredSiteSandboxRuntimeForSlot(
  slotInput: SiteSandboxSlot,
  environment: NodeJS.ProcessEnv = process.env
) {
  const slot = siteSandboxSlotSchema.parse(slotInput);
  const prefix = slot === "blue" ? "LODESTA_SANDBOX_BLUE" : "LODESTA_SANDBOX_GREEN";
  const url = environment[`${prefix}_URL`]?.trim();
  const token = environment[`${prefix}_TOKEN`]?.trim();
  if (!url || !token) throw new Error(`${prefix}_URL and ${prefix}_TOKEN are required.`);
  assertHttpsUrl(url, `${slot} sandbox URL`);
  assertSeparateProductionSlots(slot, url, token, environment);
  return { url, token };
}

export async function developmentSandboxDeploymentMatchesCheckout(
  deployment: SiteSandboxDeployment,
  root = process.cwd()
) {
  const receipt = readDevelopmentSandboxReceipt(deployment.slot, root);
  const identity = await computeSiteToolchainIdentity(root);
  return deployment.manifest.toolchainIdentity === identity
    && receipt.workerVersionId === deployment.workerVersionId
    && receipt.releaseSha === deployment.releaseSha
    && receipt.imageDigest === deployment.imageDigest
    && receipt.devConfigHash === computeDevelopmentSandboxConfigHash(deployment.slot, root)
    && sameManifest(receipt.sandboxManifest, deployment.manifest);
}

export function readDevelopmentSandboxReceipt(
  slotInput: SiteSandboxSlot,
  root = process.cwd()
): DevelopmentSandboxReceipt {
  const slot = siteSandboxSlotSchema.parse(slotInput);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolve(root, developmentSandboxReceiptPath(slot)), "utf8"));
  } catch {
    throw new Error(`Development ${slot} sandbox is not deployed. Run npm run dev.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Development ${slot} sandbox receipt is malformed. Run npm run dev.`);
  }
  const receipt = value as Record<string, unknown>;
  const keys = Object.keys(receipt).sort().join(",");
  if (keys !== "deployedAt,devConfigHash,imageDigest,releaseSha,sandboxManifest,schemaVersion,slot,url,workerName,workerVersionId"
    || receipt.schemaVersion !== 1
    || receipt.slot !== slot
    || receipt.workerName !== developmentSandboxWorkerName(slot)
    || typeof receipt.workerVersionId !== "string"
    || !/^[a-f0-9-]{36}$/i.test(receipt.workerVersionId)
    || typeof receipt.releaseSha !== "string"
    || !/^[a-f0-9]{40}$/.test(receipt.releaseSha)
    || typeof receipt.url !== "string"
    || !isImageDigest(receipt.imageDigest)
    || !isSha256(receipt.devConfigHash)
    || typeof receipt.deployedAt !== "string"
    || !Number.isFinite(Date.parse(receipt.deployedAt))
    || !validManifest(receipt.sandboxManifest)) {
    throw new Error(`Development ${slot} sandbox receipt is malformed. Run npm run dev.`);
  }
  assertDevelopmentSandboxUrl(slot, receipt.url);
  return receipt as DevelopmentSandboxReceipt;
}

export function readDevelopmentSandboxToken(
  slotInput: SiteSandboxSlot,
  environment: NodeJS.ProcessEnv = process.env,
  root = process.cwd()
) {
  const slot = siteSandboxSlotSchema.parse(slotInput);
  const configured = environment[`LODESTA_DEV_SANDBOX_${slot.toUpperCase()}_TOKEN`]?.trim();
  if (configured) {
    if (!isDevelopmentSandboxToken(configured)) {
      throw new Error(`LODESTA_DEV_SANDBOX_${slot.toUpperCase()}_TOKEN is malformed.`);
    }
    return configured;
  }
  let token: string;
  try {
    token = readFileSync(resolve(root, developmentSandboxTokenPath(slot)), "utf8").trim();
  } catch {
    throw new Error(`Development ${slot} sandbox credentials are missing. Run npm run dev.`);
  }
  if (!isDevelopmentSandboxToken(token)) {
    throw new Error(`Development ${slot} sandbox credentials are malformed. Run npm run dev.`);
  }
  return token;
}

export function computeDevelopmentSandboxConfigHash(
  slotInput: SiteSandboxSlot,
  root = process.cwd()
) {
  const slot = siteSandboxSlotSchema.parse(slotInput);
  const bytes = readFileSync(resolve(root, developmentSandboxConfigPath(slot)));
  const hash = createHash("sha256");
  hash.update(`lodesta-site-sandbox-dev-${slot}-config\0`);
  hash.update(String(bytes.byteLength));
  hash.update("\0");
  hash.update(bytes);
  return `sha256:${hash.digest("hex")}` as const;
}

export function hasProductionReleaseMarker(environment: NodeJS.ProcessEnv = process.env) {
  return hasHostedReleaseIdentity(environment);
}

function assertDevelopmentReceiptBindsDeployment(
  receipt: DevelopmentSandboxReceipt,
  deployment: SiteSandboxDeployment
) {
  if (receipt.slot !== deployment.slot
    || receipt.workerVersionId !== deployment.workerVersionId
    || receipt.releaseSha !== deployment.releaseSha
    || receipt.imageDigest !== deployment.imageDigest
    || !sameManifest(receipt.sandboxManifest, deployment.manifest)) {
    throw new Error(`Development ${receipt.slot} sandbox receipt does not match its immutable deployment record. Restart npm run dev.`);
  }
  if (!compatibleManifest(deployment.manifest, expectedSiteSandboxManifest)) {
    throw new Error(`Registered ${receipt.slot} sandbox deployment is incompatible with this controller.`);
  }
}

function assertSeparateDevelopmentSlots(
  slot: SiteSandboxSlot,
  url: string,
  token: string,
  environment: NodeJS.ProcessEnv,
  root: string
) {
  const other = slot === "blue" ? "green" : "blue";
  try {
    const otherReceipt = readDevelopmentSandboxReceipt(other, root);
    const otherToken = readDevelopmentSandboxToken(other, environment, root);
    if (normalizeUrl(otherReceipt.url) === normalizeUrl(url)) {
      throw new Error("Development blue and green sandbox URLs must differ.");
    }
    if (safeEqual(otherToken, token)) {
      throw new Error("Development blue and green sandbox tokens must differ.");
    }
  } catch (error) {
    if (!/is not deployed|credentials are missing/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }
  for (const productionSlot of ["BLUE", "GREEN"] as const) {
    const productionUrl = environment[`LODESTA_SANDBOX_${productionSlot}_URL`]?.trim();
    const productionToken = environment[`LODESTA_SANDBOX_${productionSlot}_TOKEN`]?.trim();
    if (productionUrl && normalizeUrl(productionUrl) === normalizeUrl(url)) {
      throw new Error("Development and production sandbox URLs must differ.");
    }
    if (productionToken && safeEqual(productionToken, token)) {
      throw new Error("Development and production sandbox tokens must differ.");
    }
  }
}

function assertSeparateProductionSlots(slot: SiteSandboxSlot, url: string, token: string, environment: NodeJS.ProcessEnv) {
  const other = slot === "blue" ? "GREEN" : "BLUE";
  const otherUrl = environment[`LODESTA_SANDBOX_${other}_URL`]?.trim();
  const otherToken = environment[`LODESTA_SANDBOX_${other}_TOKEN`]?.trim();
  if (otherUrl && normalizeUrl(otherUrl) === normalizeUrl(url)) {
    throw new Error("Blue and green sandbox URLs must differ.");
  }
  if (otherToken && safeEqual(otherToken, token)) {
    throw new Error("Blue and green sandbox tokens must differ.");
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

function assertDevelopmentSandboxUrl(slot: SiteSandboxSlot, value: string) {
  assertHttpsUrl(value, `Development ${slot} sandbox URL`);
  const url = new URL(value);
  if (!url.hostname.startsWith(`${developmentSandboxWorkerName(slot)}.`)
    || !url.hostname.endsWith(".workers.dev")
    || url.pathname !== "/"
    || url.search
    || url.hash) {
    throw new Error(`Development ${slot} sandbox URL must be its dedicated workers.dev root URL.`);
  }
}

function validManifest(value: unknown): value is SiteSandboxManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  return Object.keys(manifest).sort().join(",") === "apiIdentity,artifactContractIdentity,durableObjectIdentity,kind,sourcePolicyIdentity,storageIdentity,toolchainIdentity"
    && manifest.kind === "site-sandbox-manifest"
    && typeof manifest.apiIdentity === "string"
    && typeof manifest.storageIdentity === "string"
    && typeof manifest.durableObjectIdentity === "string"
    && typeof manifest.artifactContractIdentity === "string"
    && typeof manifest.toolchainIdentity === "string"
    && typeof manifest.sourcePolicyIdentity === "string";
}

function sameManifest(left: SiteSandboxManifest, right: SiteSandboxManifest) {
  return left.kind === right.kind
    && left.apiIdentity === right.apiIdentity
    && left.storageIdentity === right.storageIdentity
    && left.durableObjectIdentity === right.durableObjectIdentity
    && left.artifactContractIdentity === right.artifactContractIdentity
    && left.toolchainIdentity === right.toolchainIdentity
    && left.sourcePolicyIdentity === right.sourcePolicyIdentity;
}

function compatibleManifest(left: SiteSandboxManifest, right: SiteSandboxManifest) {
  return left.kind === right.kind
    && left.apiIdentity === right.apiIdentity
    && left.storageIdentity === right.storageIdentity
    && left.durableObjectIdentity === right.durableObjectIdentity
    && left.artifactContractIdentity === right.artifactContractIdentity
    && left.sourcePolicyIdentity === right.sourcePolicyIdentity;
}

function isImageDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function asImageDigest(value: string) {
  if (!isImageDigest(value)) throw new Error("Sandbox deployment image digest is malformed.");
  return value;
}

function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

export function isDevelopmentSandboxToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}
