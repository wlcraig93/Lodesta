import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeWebhookEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: unknown;
  };
};

export type StripeCheckoutSession = {
  id?: string;
  client_reference_id?: string;
  customer?: unknown;
  subscription?: unknown;
  metadata?: {
    claim_id?: string;
    site_id?: string;
  };
};

export function verifyStripeWebhookSignature(input: {
  payload: string;
  signatureHeader: string | null;
  secret: string;
  toleranceSeconds?: number;
  nowMs?: number;
}) {
  if (!input.signatureHeader) return false;

  const parsed = parseStripeSignature(input.signatureHeader);
  if (!parsed.timestamp || parsed.signatures.length === 0) return false;

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const toleranceSeconds = input.toleranceSeconds ?? 300;
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", input.secret)
    .update(`${parsed.timestamp}.${input.payload}`, "utf8")
    .digest("hex");

  return parsed.signatures.some((signature) => safeEqualHex(signature, expected));
}

export function parseStripeWebhookEvent(payload: string): StripeWebhookEvent {
  return JSON.parse(payload) as StripeWebhookEvent;
}

export function stripeStringId(value: unknown) {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.id === "string") return value.id;
  return undefined;
}

export function asStripeCheckoutSession(value: unknown): StripeCheckoutSession {
  return isRecord(value) ? (value as StripeCheckoutSession) : {};
}

function parseStripeSignature(header: string) {
  const parts = header.split(",");
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const timestamp = timestampPart ? Number(timestampPart.slice(2)) : 0;
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter((signature) => /^[a-f0-9]+$/i.test(signature));

  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    signatures
  };
}

function safeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
