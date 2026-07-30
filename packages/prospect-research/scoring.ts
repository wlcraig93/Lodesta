export const PROSPECT_SCORING_MODEL = "lodesta-prospect-priority";

export type ProspectPriorityInput = {
  reviewRating?: number;
  reviewCount?: number;
  yearsInBusiness?: number;
  businessStrengthScore?: number;
  websiteOpportunityScore?: number;
  hasBusinessPhone?: boolean;
  hasPublicBusinessEmail?: boolean;
  hasPublicOwnerName?: boolean;
  hasPublicOwnerEmail?: boolean;
  evidenceCoverage?: number;
};

export type ProspectPriorityScore = {
  model: typeof PROSPECT_SCORING_MODEL;
  demand: number;
  durability: number;
  websiteOpportunity: number;
  reachability: number;
  evidenceConfidence: number;
  priority: number;
};

export function scoreProspectPriority(input: ProspectPriorityInput): ProspectPriorityScore {
  const rating = input.reviewRating === undefined
    ? 0
    : clamp(((input.reviewRating - 3.5) / 1.5) * 100);
  const reviewVolume = input.reviewCount === undefined
    ? 0
    : clamp(Math.log10(input.reviewCount + 1) / Math.log10(501) * 100);
  const demand = round(rating * 0.4 + reviewVolume * 0.6);

  const longevity = input.yearsInBusiness === undefined
    ? 0
    : clamp(input.yearsInBusiness / 10 * 100);
  const durability = round(
    input.businessStrengthScore === undefined
      ? longevity
      : input.yearsInBusiness === undefined
        ? clamp(input.businessStrengthScore)
        : clamp(input.businessStrengthScore) * 0.7 + longevity * 0.3
  );

  const websiteOpportunity = round(clamp(input.websiteOpportunityScore ?? 0));
  const reachability = round(
    (input.hasBusinessPhone ? 25 : 0)
    + (input.hasPublicBusinessEmail ? 30 : 0)
    + (input.hasPublicOwnerName ? 15 : 0)
    + (input.hasPublicOwnerEmail ? 30 : 0)
  );
  const evidenceConfidence = round(clamp((input.evidenceCoverage ?? 0) * 100));
  const priority = round(
    demand * 0.3
    + durability * 0.15
    + websiteOpportunity * 0.3
    + reachability * 0.15
    + evidenceConfidence * 0.1
  );

  return {
    model: PROSPECT_SCORING_MODEL,
    demand,
    durability,
    websiteOpportunity,
    reachability,
    evidenceConfidence,
    priority
  };
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
