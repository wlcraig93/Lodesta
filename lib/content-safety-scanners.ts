export type PlaceholderTextMatch = {
  pattern: RegExp;
  reason: string;
};

export type SensitiveClaimEvidenceKind = "proof" | "reviews" | "insurance" | "pricing" | "emergency";

export type SensitiveClaimMatch = {
  category: "credential" | "insurance" | "pricing" | "warranty" | "reviews" | "guarantee" | "emergency" | "regulated" | "marketing" | "longevity";
  label: string;
  severity: "block" | "warning";
  requiredEvidence: SensitiveClaimEvidenceKind;
  matchedText: string;
  start: number;
  end: number;
};

const placeholderPatterns: PlaceholderTextMatch[] = [
  { pattern: /\bLocal area\b/i, reason: "Generic local-area fallback is visible." },
  { pattern: /\bCore service\b/i, reason: "Generic service fallback is visible." },
  { pattern: /\bLocal support\b/i, reason: "Generic support fallback is visible." },
  { pattern: /\bSample Local Business\b/i, reason: "Sample business fallback is visible." },
  { pattern: /\bVisual proof slot ready\b/i, reason: "Internal proof placeholder is visible." },
  { pattern: /\bCredential details can be verified\b/i, reason: "Internal credential placeholder is visible." },
  { pattern: /\bowner-approved\b/i, reason: "Internal owner-review language is visible." },
  { pattern: /\bowner-truth\b/i, reason: "Internal owner-truth language is visible." },
  { pattern: /\bcan be verified\b/i, reason: "Internal verification language is visible." },
  { pattern: /\bready to request more information\b/i, reason: "Internal request placeholder is visible." },
  { pattern: /\b(claimed and published|after claim|owner verification needed)\b/i, reason: "Internal claim-state language is visible." },
  { pattern: /\b(nearby customers\?|do you help customers in nearby customers)\b/i, reason: "Broken generic service-area copy is visible." },
  { pattern: /\b(this page|service page|search engines?|local search intent)\b/i, reason: "Website-production planning language is visible." },
  { pattern: /\b(primary action|conversion path|conversion actions?|ready visitors|proof sections?|trust proof)\b/i, reason: "Internal conversion-planning language is visible." },
  { pattern: /\bhelp visitors\b/i, reason: "Generic visitor-planning copy is visible instead of customer-facing copy." },
  { pattern: /\bEasy next step\b/i, reason: "Generic trust-bar filler is visible instead of a specific business signal." },
  { pattern: /\b(Customer decision path|Conversion standard|Review summary detected)\b/i, reason: "Internal quality-calibration copy is visible." },
  { pattern: /\b(visual context|source-backed next steps?|site source|extracted service list|profile details)\b/i, reason: "Internal source/template language is visible." },
  { pattern: /\b(?:according to )?(?:our|the|provided|available) source (?:information|data|material|details?)\b/i, reason: "Internal provenance language is visible." },
  { pattern: /\b(customers should describe|specific without assuming|not a photo of this specific shop)\b/i, reason: "Meta commentary about generated-site safety is visible." },
  { pattern: /\b(Call-first|listed repair service available|listed service customers can ask)\b/i, reason: "Filler proof or service copy is visible." }
];

const sensitiveClaimPatterns: Array<Omit<SensitiveClaimMatch, "matchedText" | "start" | "end"> & { pattern: RegExp }> = [
  { category: "credential", label: "licensed/certified credential", severity: "block", pattern: /\b(licensed|certified|board[-\s]?certified|accredited)\b/i, requiredEvidence: "proof" },
  { category: "insurance", label: "insurance or bonding claim", severity: "block", pattern: /\b(insured|bonded|insurance|insurer|deductible|rental cars?)\b/i, requiredEvidence: "insurance" },
  { category: "warranty", label: "warranty claim", severity: "block", pattern: /\b(?:lifetime|limited|written|\d+[-\s]?(?:year|month))?\s*warrant(?:y|ies)\b/i, requiredEvidence: "proof" },
  { category: "guarantee", label: "guarantee", severity: "block", pattern: /\b(guaranteed|guarantee|risk[-\s]?free)\b/i, requiredEvidence: "proof" },
  { category: "regulated", label: "regulated approval", severity: "block", pattern: /\b(fda[-\s]?approved|hipaa[-\s]?compliant|irs[-\s]?certified)\b/i, requiredEvidence: "proof" },
  { category: "regulated", label: "regulated advice", severity: "block", pattern: /\b(medical advice|legal advice|financial advice|tax advice|case results?)\b/i, requiredEvidence: "proof" },
  { category: "regulated", label: "medical outcome", severity: "block", pattern: /\b(medical diagnos(?:e|is)|diagnos(?:e|is) (?:a |the )?(?:disease|condition|symptoms?|illness)|medical treatment|(?:cures?|treats?) (?:a |the )?(?:disease|condition|symptoms?|illness|pain)|pain[-\s]?free)\b/i, requiredEvidence: "proof" },
  { category: "pricing", label: "pricing claim", severity: "warning", pattern: /(?:\bbest prices?\b|\bfree\b.{0,24}\b(?:estimates?|quotes?)\b|\bno out of pocket\b|\baffordable\b)/i, requiredEvidence: "pricing" },
  { category: "reviews", label: "top-rated review claim", severity: "warning", pattern: /\b(top[-\s]?rated|highest[-\s]?rated|5[-\s]?star|five[-\s]?star|great reviews?|loved by customers)\b/i, requiredEvidence: "reviews" },
  { category: "marketing", label: "best or #1 claim", severity: "warning", pattern: /(?:\bbest\b(?!\s+(?:way|time|place)\b)|#\s?1\b|\bnumber\s?one\b)/i, requiredEvidence: "proof" },
  { category: "marketing", label: "award claim", severity: "warning", pattern: /\b(award[-\s]?winning|voted)\b/i, requiredEvidence: "proof" },
  { category: "marketing", label: "market leadership claim", severity: "warning", pattern: /\b(leading|most trusted|premier)\b/i, requiredEvidence: "proof" },
  { category: "longevity", label: "business longevity claim", severity: "block", pattern: /\b(?:serving\s+(?:the\s+)?(?:[a-z][a-z .'-]+\s+)?for\s+)?\d{1,3}\+?\s+years?(?:\s+in\s+business)?\b/i, requiredEvidence: "proof" },
  { category: "emergency", label: "emergency availability claim", severity: "warning", pattern: /\b(24\/7|same day|emergency|after hours)\b/i, requiredEvidence: "emergency" }
];

export function scanPlaceholderText(text: string): PlaceholderTextMatch[] {
  return placeholderPatterns.filter((entry) => entry.pattern.test(text));
}

export function scanSensitiveClaimText(text: string): SensitiveClaimMatch[] {
  if (!text.trim()) return [];
  return sensitiveClaimPatterns.flatMap(({ pattern, ...entry }) => {
    const matcher = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    return [...text.matchAll(matcher)].map((match) => ({
      ...entry,
      matchedText: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length
    }));
  }).sort((left, right) => left.start - right.start || left.end - right.end || left.category.localeCompare(right.category));
}

export function gatedSensitiveClaims(text: string) {
  return scanSensitiveClaimText(text).filter(
    (claim) => claim.severity === "block" || claim.category === "pricing" || claim.category === "reviews" || claim.category === "marketing"
  );
}

export function containsGatedSensitiveClaim(text: string) {
  return gatedSensitiveClaims(text).length > 0;
}
