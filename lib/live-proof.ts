/**
 * Live-resolved Google rating for generated sites. See docs/live-proof-design.md.
 *
 * Policy: rating values are never persisted — they live only in this module's
 * in-memory cache. Any failure resolves to undefined and the page renders
 * without proof (silent omission, never an error or placeholder).
 */

export type LiveRating = {
  rating: number;
  count: number;
};

type CacheEntry = {
  value: LiveRating | undefined;
  expiresAt: number;
};

const cacheTtlMs = 10 * 60 * 1000;
const circuitOpenMs = 5 * 60 * 1000;
const requestTimeoutMs = 1500;
const failureThreshold = 3;
/** Rating below this, or too few reviews, renders no badge at all. */
const minDisplayRating = 4.0;
const minDisplayCount = 5;

const cache = new Map<string, CacheEntry>();
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
let quotaDay = "";
let quotaUsed = 0;

export function liveProofEnabled() {
  return process.env.LODESTA_LIVE_PROOF_MODE === "google_places" && Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

function dailyQuota() {
  const parsed = Number.parseInt(process.env.LODESTA_LIVE_PROOF_DAILY_QUOTA ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
}

function underQuota() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== quotaDay) {
    quotaDay = today;
    quotaUsed = 0;
  }
  return quotaUsed < dailyQuota();
}

export async function resolveLiveRating(placeId: string | undefined): Promise<LiveRating | undefined> {
  if (!placeId || !liveProofEnabled()) return undefined;

  const cached = cache.get(placeId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (Date.now() < circuitOpenUntil) return undefined;
  if (!underQuota()) return undefined;

  quotaUsed += 1;
  try {
    const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY ?? "",
        "X-Goog-FieldMask": "rating,userRatingCount"
      },
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    if (!response.ok) throw new Error(`Places details returned ${response.status}`);
    const payload = (await response.json()) as { rating?: number; userRatingCount?: number };
    consecutiveFailures = 0;
    const value =
      typeof payload.rating === "number" &&
      typeof payload.userRatingCount === "number" &&
      payload.rating >= minDisplayRating &&
      payload.userRatingCount >= minDisplayCount
        ? { rating: Math.round(payload.rating * 10) / 10, count: payload.userRatingCount }
        : undefined;
    cache.set(placeId, { value, expiresAt: Date.now() + cacheTtlMs });
    return value;
  } catch {
    consecutiveFailures += 1;
    if (consecutiveFailures >= failureThreshold) {
      circuitOpenUntil = Date.now() + circuitOpenMs;
      consecutiveFailures = 0;
    }
    // Cache the miss briefly so a hard-down API does not get hammered per request.
    cache.set(placeId, { value: undefined, expiresAt: Date.now() + cacheTtlMs / 5 });
    return undefined;
  }
}

/**
 * COGS cap for the Places UI Kit trust module on tokenized previews. Each
 * preview render that includes the module consumes one slot; over the daily
 * cap, previews fall back to the link-only CTA. Claimed-site renders are not
 * capped (they are the product).
 */
let previewProofDay = "";
let previewProofUsed = 0;

function previewProofDailyCap() {
  const parsed = Number.parseInt(process.env.LODESTA_PREVIEW_PROOF_DAILY_CAP ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
}

export function consumePreviewProofSlot(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== previewProofDay) {
    previewProofDay = today;
    previewProofUsed = 0;
  }
  if (previewProofUsed >= previewProofDailyCap()) return false;
  previewProofUsed += 1;
  return true;
}

/** Test hook: resets module state so unit checks are order-independent. */
export function resetLiveProofStateForTests() {
  cache.clear();
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
  quotaDay = "";
  quotaUsed = 0;
  previewProofDay = "";
  previewProofUsed = 0;
}
