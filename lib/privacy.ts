import type { AnalyticsEvent } from "./models";
import { hmacSha256Hex } from "./hash-secret";

export function ipHashForRequest(request: Request, input: { siteId: string; at?: Date }) {
  const ip = clientIpFromHeaders(request.headers);
  return ip ? hashIpAddress(ip, input) : undefined;
}

export function hashIpAddress(ipAddress: string, input: { siteId: string; at?: Date; salt?: string }) {
  const normalizedIp = ipAddress.trim().toLowerCase();
  if (!normalizedIp) return undefined;
  const digest = hmacSha256Hex(`stable-ip-v2\n${normalizedIp}`, { secret: input.salt }).slice(0, 32);
  return `v2:${digest}`;
}

export function clientIpFromHeaders(headers: Headers) {
  const candidates = [
    headers.get("cf-connecting-ip"),
    firstForwardedFor(headers.get("x-forwarded-for")),
    headers.get("x-real-ip"),
    forwardedHeaderIp(headers.get("forwarded"))
  ];
  return candidates.map((candidate) => candidate?.trim()).find(Boolean);
}

export function sanitizeAnalyticsMetadata(metadata: AnalyticsEvent["metadata"]) {
  if (!metadata) return undefined;
  const sanitized: NonNullable<AnalyticsEvent["metadata"]> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveMetadataKey(key)) continue;
    const cleanValue = sanitizeAnalyticsMetadataValue(value);
    if (cleanValue !== undefined) sanitized[key] = cleanValue;
  }
  return Object.keys(sanitized).length ? sanitized : undefined;
}

export function sanitizeAttributionUrl(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!isAttributionUrlCandidate(trimmed)) return undefined;
  const sanitized = sanitizeUrlValue(trimmed);
  return typeof sanitized === "string" && sanitized ? sanitized : undefined;
}

function sanitizeAnalyticsMetadataValue(value: string | number | boolean) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (looksLikeUrl(trimmed)) return sanitizeUrlValue(trimmed);
  if (looksLikeSensitiveValue(trimmed)) return undefined;
  return trimmed.slice(0, 500);
}

function sanitizeUrlValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(mailto|tel):/i.test(trimmed)) return undefined;

  try {
    const base = "https://lodesta.local";
    const url = new URL(trimmed, base);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (url.username || url.password || looksLikeSensitivePath(url.pathname)) return undefined;
    const keptParams = new URLSearchParams();
    for (const [key, paramValue] of url.searchParams.entries()) {
      if (isAllowedAttributionParam(key) && !looksLikeSensitiveValue(paramValue)) keptParams.append(key, paramValue.slice(0, 160));
    }
    const query = keptParams.toString();
    const path = `${url.pathname}${query ? `?${query}` : ""}`;
    return trimmed.startsWith("/") ? path : `${url.origin}${path}`;
  } catch {
    return undefined;
  }
}

function isAttributionUrlCandidate(value: string) {
  return /^https?:\/\//i.test(value) || (value.startsWith("/") && !value.startsWith("//"));
}

function looksLikeSensitivePath(value: string) {
  try {
    return looksLikeSensitiveValue(decodeURIComponent(value));
  } catch {
    return looksLikeSensitiveValue(value);
  }
}

function isAllowedAttributionParam(key: string) {
  return /^utm_(source|medium|campaign|term|content)$/i.test(key);
}

function isSensitiveMetadataKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return [
    "pass",
    "password",
    "passcode",
    "token",
    "secret",
    "auth",
    "credential",
    "email",
    "phone",
    "tel",
    "name",
    "firstname",
    "lastname",
    "message",
    "comment",
    "note",
    "address",
    "street",
    "zip",
    "postal",
    "ssn",
    "social",
    "card",
    "bank",
    "routing",
    "account",
    "dob",
    "birth"
  ].some((part) => normalized.includes(part));
}

function looksLikeUrl(value: string) {
  return /^(https?:)?\/\//i.test(value) || value.startsWith("/");
}

function looksLikeSensitiveValue(value: string) {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) return true;
  if (/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/.test(value)) return true;
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(value)) return true;
  if (/\b(?:\d[ -]*?){13,19}\b/.test(value)) return true;
  return false;
}

function firstForwardedFor(value: string | null) {
  return value?.split(",")[0]?.trim();
}

function forwardedHeaderIp(value: string | null) {
  if (!value) return undefined;
  const match = value.match(/(?:^|;)\s*for="?([^";,]+)"?/i);
  return match?.[1]?.replace(/^\[|\]$/g, "");
}
