import type { BusinessProfile, GeneratedCopyDeckV2 } from "./models";

export type CopyPhrasePolicyV1 = {
  version: "copy-phrase-policy-v1";
  id: "auto_body_v1";
  vertical: "auto_body";
  maxPolicyPhraseHits: number;
  constrainedPhrases: readonly string[];
  constrainedPatterns: readonly RegExp[];
};

export const autoBodyCopyPhrasePolicyV1: CopyPhrasePolicyV1 = {
  version: "copy-phrase-policy-v1",
  id: "auto_body_v1",
  vertical: "auto_body",
  maxPolicyPhraseHits: 2,
  constrainedPhrases: [
    "clear next steps",
    "focused help",
    "focused option",
    "practical support",
    "repair conversation",
    "estimate conversation",
    "repair path",
    "call first path",
    "agreed next step",
    "source backed next steps",
    "listed repair service"
  ],
  constrainedPatterns: [
    /\bneed a shop to look at the damage\b/i,
    /\bcan talk through\b/i,
    /\bcan discuss\b/i,
    /\bhelp after damage\b/i,
    /\bcustomers should describe\b/i,
    /\bspecific without assuming\b/i
  ]
};

export function copyPhrasePolicyForBusinessV1(business: Pick<BusinessProfile, "vertical">): CopyPhrasePolicyV1 | undefined {
  return business.vertical === "auto_body" ? autoBodyCopyPhrasePolicyV1 : undefined;
}

export function copyPhrasePolicyPromptV1(policy: CopyPhrasePolicyV1 | undefined): Record<string, unknown> | undefined {
  if (!policy) return undefined;
  return {
    version: policy.version,
    id: policy.id,
    instruction:
      "Avoid these overused same-vertical constructions. Use shop-specific service facts and different sentence structures instead.",
    constrainedPhrases: policy.constrainedPhrases
  };
}

export function copyPhrasePolicyViolationsV1(
  deck: GeneratedCopyDeckV2,
  business: Pick<BusinessProfile, "vertical">
): string[] {
  const policy = copyPhrasePolicyForBusinessV1(business);
  if (!policy) return [];
  const text = collectStrings(deck).join(" ").replace(/\s+/g, " ").trim();
  const normalized = normalizeText(text);
  const hits: string[] = [];
  for (const phrase of policy.constrainedPhrases) {
    if (normalized.includes(normalizeText(phrase))) hits.push(phrase);
  }
  for (const pattern of policy.constrainedPatterns) {
    const match = text.match(pattern);
    if (match) hits.push(match[0]);
  }
  if (hits.length <= policy.maxPolicyPhraseHits) return [];
  return [`Copy phrase policy ${policy.id} hit ${hits.length} constrained phrases (max ${policy.maxPolicyPhraseHits}): ${hits.slice(0, 8).join(", ")}.`];
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
}
