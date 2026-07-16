import { isDynamicHoursStatus } from "./business-understanding-v2";

const internalStatePatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgeneral[ _]local\b/i, reason: "Internal vertical slug is visible in customer copy." },
  { pattern: /\b(auto_services|auto_body|home_services|med_spa|law_firm|real_estate|beauty_salon|creative_studio)\b/, reason: "Internal vertical slug is visible in customer copy." },
  { pattern: /\bhours?[_\s]?\d\b/i, reason: "Raw scraped hours label is visible in customer copy." }
];

export function detectInternalStateCopy(text: string): string | undefined {
  for (const entry of internalStatePatterns) {
    if (entry.pattern.test(text)) return entry.reason;
  }
  if (isDynamicHoursStatus(text)) return "Live open/closed status string is stored as permanent copy.";
  return undefined;
}
