import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { hashSecret } from "@/lib/hash-secret";
import type { SitePreviewGrant } from "./contracts";
import { platformOperationsRepository } from "./repository";

const previewPurpose = "lodesta-candidate-preview";
const previewSessionTtlSeconds = 12 * 60 * 60;
const previewGrantTtlMs = 90 * 24 * 60 * 60_000;

type PreviewSessionPayload = {
  schemaVersion: 1;
  previewId: string;
  secretVersion: number;
  expiresAt: number;
};

export async function createPreviewGrant(input: {
  previewId?: string;
  siteId: string;
  siteVersionId: string;
  expiresAt?: string;
}) {
  const grant = draftPreviewGrant(input);
  return platformOperationsRepository.createPreviewGrant(grant);
}

export function draftPreviewGrant(input: {
  previewId?: string;
  siteId: string;
  siteVersionId: string;
  expiresAt?: string;
}) {
  const previewId = input.previewId ?? `preview_${crypto.randomUUID().replaceAll("-", "")}`;
  const keyVersion = activePreviewKeyVersion();
  const secretVersion = 1;
  const secret = derivePreviewSecret({ previewId, siteVersionId: input.siteVersionId, keyVersion, secretVersion });
  return {
    id: previewId,
    siteId: input.siteId,
    siteVersionId: input.siteVersionId,
    secretHash: sha256(secret),
    keyVersion,
    secretVersion,
    expiresAt: input.expiresAt ?? new Date(Date.now() + previewGrantTtlMs).toISOString(),
    createdAt: new Date().toISOString()
  } satisfies SitePreviewGrant;
}

export function previewLink(grant: SitePreviewGrant, origin: string) {
  const secret = derivePreviewSecret({
    previewId: grant.id,
    siteVersionId: grant.siteVersionId,
    keyVersion: grant.keyVersion,
    secretVersion: grant.secretVersion
  });
  return `${origin.replace(/\/$/, "")}/preview/${encodeURIComponent(grant.id)}#${secret}`;
}

export function validatePreviewSecret(grant: SitePreviewGrant, providedSecret: string) {
  if (!isActivePreviewGrant(grant)) return false;
  const actual = Buffer.from(sha256(providedSecret));
  const expected = Buffer.from(grant.secretHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isActivePreviewGrant(grant: SitePreviewGrant) {
  return !grant.revokedAt && Date.parse(grant.expiresAt) > Date.now();
}

export function previewSessionCookieName(previewId: string) {
  return `lodesta_preview_${createHash("sha256").update(previewId).digest("hex").slice(0, 20)}`;
}

export function createPreviewSessionCookie(grant: SitePreviewGrant) {
  const payload: PreviewSessionPayload = {
    schemaVersion: 1,
    previewId: grant.id,
    secretVersion: grant.secretVersion,
    expiresAt: Math.floor(Date.now() / 1000) + previewSessionTtlSeconds
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signSession(encoded, grant.keyVersion)}`;
}

export function hasValidPreviewSession(request: Request, grant: SitePreviewGrant) {
  if (!isActivePreviewGrant(grant)) return false;
  const value = readCookie(request.headers.get("cookie"), previewSessionCookieName(grant.id));
  if (!value) return false;
  const [encoded, providedSignature, extra] = value.split(".");
  if (!encoded || !providedSignature || extra) return false;
  const expectedSignature = signSession(encoded, grant.keyVersion);
  const actual = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<PreviewSessionPayload>;
    return payload.schemaVersion === 1
      && payload.previewId === grant.id
      && payload.secretVersion === grant.secretVersion
      && typeof payload.expiresAt === "number"
      && payload.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export const previewSessionMaxAgeSeconds = previewSessionTtlSeconds;

function derivePreviewSecret(input: {
  previewId: string;
  siteVersionId: string;
  keyVersion: string;
  secretVersion: number;
}) {
  const message = JSON.stringify({
    schemaVersion: 1,
    purpose: previewPurpose,
    previewId: input.previewId,
    siteVersionId: input.siteVersionId,
    secretVersion: input.secretVersion
  });
  return createHmac("sha256", previewKey(input.keyVersion)).update(message).digest("base64url");
}

function signSession(encodedPayload: string, keyVersion: string) {
  return createHmac("sha256", previewKey(keyVersion))
    .update(`${previewPurpose}:session:${encodedPayload}`)
    .digest("base64url");
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function activePreviewKeyVersion() {
  return process.env.LODESTA_PREVIEW_HMAC_ACTIVE_KEY_VERSION?.trim() || "v1";
}

function previewKey(version: string) {
  const configured = process.env.LODESTA_PREVIEW_HMAC_KEYS?.trim();
  if (configured) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configured);
    } catch {
      throw new Error("LODESTA_PREVIEW_HMAC_KEYS must be a JSON object.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("LODESTA_PREVIEW_HMAC_KEYS must be a JSON object.");
    }
    const value = (parsed as Record<string, unknown>)[version];
    if (typeof value !== "string" || value.length < 32) {
      throw new Error(`Preview HMAC key ${version} is missing or too short.`);
    }
    return value;
  }
  if (version !== "v1") throw new Error(`Preview HMAC key ${version} is not configured.`);
  return hashSecret();
}

function readCookie(header: string | null, name: string) {
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return undefined;
}
