import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { hmacSha256Hex } from "./hash-secret";

type RateLimitOptions = {
  bucket: string;
  limit: number;
  windowMs: number;
  keyParts?: Array<string | number | boolean | undefined | null>;
};

type RateLimitState = {
  hits: number;
  resetAt: number;
};

type RateLimitResult =
  | {
      ok: true;
      headers: Record<string, string>;
      remaining: number;
      resetAt: number;
    }
  | {
      ok: false;
      response: NextResponse;
      retryAfterSeconds: number;
      resetAt: number;
    };

const globalStore = globalThis as typeof globalThis & {
  __lodestaRateLimits?: Map<string, RateLimitState>;
};

export function rateLimit(request: Request, options: RateLimitOptions): RateLimitResult {
  const limit = Math.max(1, Math.floor(options.limit));
  const windowMs = Math.max(1000, Math.floor(options.windowMs));
  const now = Date.now();
  const store = rateLimitStore();
  const key = rateLimitKey(request, options);
  const existing = store.get(key);
  const state = existing && existing.resetAt > now ? existing : { hits: 0, resetAt: now + windowMs };

  state.hits += 1;
  store.set(key, state);
  pruneRateLimits(store, now);

  const remaining = Math.max(0, limit - state.hits);
  const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
  const headers = rateLimitHeaders(limit, remaining, state.resetAt, retryAfterSeconds);

  if (state.hits > limit) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many requests. Try again later." },
        {
          status: 429,
          headers
        }
      ),
      retryAfterSeconds,
      resetAt: state.resetAt
    };
  }

  return { ok: true, headers, remaining, resetAt: state.resetAt };
}

export function applyRateLimitHeaders(response: NextResponse, result: Extract<RateLimitResult, { ok: true }>) {
  for (const [name, value] of Object.entries(result.headers)) {
    response.headers.set(name, value);
  }
  return response;
}

export function rateLimitKey(request: Request, options: RateLimitOptions) {
  const parts = [
    options.bucket,
    clientFingerprint(request),
    ...((options.keyParts ?? []).map((part) => String(part ?? "") || "-"))
  ];
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function rateLimitStore() {
  globalStore.__lodestaRateLimits ??= new Map<string, RateLimitState>();
  return globalStore.__lodestaRateLimits;
}

function clientFingerprint(request: Request) {
  const ip = clientIp(request).trim().toLowerCase();
  const userAgent = request.headers.get("user-agent") ?? "";
  return hmacSha256Hex(`rate-limit-v1\n${ip}\n${userAgent}`);
}

function clientIp(request: Request) {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) return cfConnectingIp.trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() ?? "unknown";

  return "unknown";
}

function rateLimitHeaders(limit: number, remaining: number, resetAt: number, retryAfterSeconds: number) {
  return {
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(remaining),
    "RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
    "Retry-After": String(retryAfterSeconds)
  };
}

function pruneRateLimits(store: Map<string, RateLimitState>, now: number) {
  if (store.size < 10_000) return;
  for (const [key, state] of store.entries()) {
    if (state.resetAt <= now) store.delete(key);
  }
}
