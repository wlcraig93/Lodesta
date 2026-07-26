const negativeAvailability = /\b(?:not|isn['’]?t|aren['’]?t|except|excluding|closed)\b/i;
const qualifiedAvailability = /\b(?:emergency|phone|line|support|service|on[ -]?call|appointment|dispatch)\b/i;

/**
 * Returns true only for an unqualified statement that the location itself is
 * continuously open. Emergency-service and contact-line availability are
 * deliberately separate evidence.
 */
export function isContinuousAvailabilityValue(value: string) {
  const normalized = value.normalize("NFKC").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!normalized || negativeAvailability.test(normalized) || qualifiedAvailability.test(normalized)) return false;
  return /^(?:open\s+)?(?:24\s*hours?(?:\s+(?:a\s+day|daily))?|24\s*\/\s*7)$/i.test(normalized);
}

export function continuousAvailabilitySummary(hours: Record<string, string> | undefined) {
  const values = Object.values(hours ?? {}).filter((value) => value.trim().length > 0);
  return values.length > 0 && values.every(isContinuousAvailabilityValue)
    ? "Open 24 hours daily"
    : undefined;
}
