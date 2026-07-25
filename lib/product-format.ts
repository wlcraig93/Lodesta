import type { ProductStatusTone } from "@/components/ProductUI";

/**
 * Client-side shape check used to replace the browser's native email
 * validation bubble. Deliberately permissive — the server and the auth
 * provider remain the authority on whether an address is real.
 */
export function isLikelyEmail(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  const at = trimmed.indexOf("@");
  if (at < 1 || at !== trimmed.lastIndexOf("@")) return false;
  const domain = trimmed.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

export function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatProductDate(value: string, includeTime = true) {
  return new Intl.DateTimeFormat("en", includeTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" }
  ).format(new Date(value));
}

const successStates = new Set([
  "completed", "active", "published", "ready", "adopted", "succeeded", "owned",
  "verified", "confirmed", "ready_for_review", "resolved"
]);

const attentionStates = new Set([
  "needs_attention", "needs_input", "attention_required", "warning",
  "pending_verification", "observed", "major"
]);

const dangerStates = new Set([
  "failed", "blocked", "canceled", "cancelled", "disqualified", "error",
  "critical", "rejected", "tombstoned"
]);

const infoStates = new Set([
  "running", "queued", "generating", "provisioning", "in_review", "in_progress", "candidate"
]);

/**
 * Canonical status -> tone mapping for Lodesta product and admin surfaces.
 *
 * Amber (`attention`) is reserved for states a person must act on, per
 * `docs/design/lodesta-product-design-language.md`. Ordinary in-progress
 * activity uses `info`, and inert lifecycle states stay `neutral`.
 */
export function statusTone(status: string): ProductStatusTone {
  const key = status.toLowerCase();
  if (successStates.has(key)) return "success";
  if (attentionStates.has(key)) return "attention";
  if (dangerStates.has(key)) return "danger";
  if (infoStates.has(key)) return "info";
  return "neutral";
}
