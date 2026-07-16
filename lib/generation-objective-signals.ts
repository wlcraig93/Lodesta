import { isDynamicHoursStatus } from "./business-understanding-v2";
import { defaultServicesForVertical } from "./recipes";
import type { Vertical } from "./models";

const internalStatePatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgeneral[ _]local\b/i, reason: "Internal vertical slug is visible in customer copy." },
  { pattern: /\b(auto_services|auto_body|home_services|med_spa|law_firm|real_estate|beauty_salon|creative_studio)\b/, reason: "Internal vertical slug is visible in customer copy." },
  { pattern: /\bhours?[_\s]?\d\b/i, reason: "Raw scraped hours label is visible in customer copy." }
];

/**
 * Filler facts pretend to be business proof without carrying information
 * ("Services: 3", "Start: Call directly"). Real values under the same label
 * (e.g. "Services: Flat repair, brakes") are fine.
 */
export function isFillerFact(label: string, value: string) {
  const key = label.toLowerCase().trim();
  if (key === "services") return /^\d+$/.test(value.trim());
  if (key === "start") return /^(call directly|send details|call or send details)$/i.test(value.trim());
  if (key === "fit") return /confirmed by the team/i.test(value);
  if (key === "area") return /^local$/i.test(value.trim());
  return false;
}

export function detectMalformedServiceTitle(title: string) {
  const text = title.trim();
  if (!text) return true;
  if (/\s\d{1,3}(?:\s\d{1,3})+$/.test(text)) return true;
  if (/\$\s*\d/.test(text)) return true;
  if (text.length > 70) return true;
  if (!/[a-z]/i.test(text)) return true;
  return false;
}

export function detectInternalStateCopy(text: string): string | undefined {
  for (const entry of internalStatePatterns) {
    if (entry.pattern.test(text)) return entry.reason;
  }
  if (isDynamicHoursStatus(text)) return "Live open/closed status string is stored as permanent copy.";
  return undefined;
}

/** True when the profile's services are exactly the synthesized vertical defaults. */
export function areServicesVerticalDefaults(services: string[], vertical: Vertical) {
  const defaults = defaultServicesForVertical(vertical);
  if (!services.length || !defaults.length) return false;
  if (services.length !== defaults.length) return false;
  return services.every((service, index) => service === defaults[index]);
}

/**
 * Deterministic anti-doorway measure: the share of `left` sentences that also
 * appear in `right` (normalized). Service pages must stay under 0.4 against
 * the homepage and against sibling pages.
 */
export const servicePageMaxOverlapRatio = 0.4;

export function sentenceOverlapRatio(left: string[], right: string[]): number {
  const sentences = (texts: string[]) =>
    texts
      .flatMap((text) => text.split(/(?<=[.!?])\s+/))
      .map((sentence) => sentence.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim())
      .filter((sentence) => sentence.split(" ").length >= 4);
  const leftSentences = sentences(left);
  if (!leftSentences.length) return 0;
  const rightSet = new Set(sentences(right));
  const overlapping = leftSentences.filter((sentence) => rightSet.has(sentence)).length;
  return overlapping / leftSentences.length;
}

export function findDuplicateTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const title of titles) {
    const key = title.toLowerCase().trim();
    if (!key) continue;
    if (seen.has(key)) duplicates.add(title);
    seen.add(key);
  }
  return [...duplicates];
}
