import type { BusinessStrengthAssessment, BusinessStrengthSignal } from "@/packages/platform-operations";

export function assessBusinessStrength(input: {
  reviewRating?: number;
  reviewCount?: number;
  yearsInBusiness?: number;
  confirmedProofCount?: number;
  confirmedServiceCount?: number;
  confirmedLocationCount?: number;
  source: "web_research" | "verified_business_state";
}): BusinessStrengthAssessment {
  const signals: BusinessStrengthSignal[] = [
    numericSignal("reputation_rating", "Customer rating", input.reviewRating, 4.5, 4, 25, input.source, "A strong public rating can indicate customer satisfaction."),
    numericSignal("reputation_volume", "Review volume", input.reviewCount, 50, 15, 25, input.source, "A meaningful review volume can indicate an established operating business."),
    numericSignal("longevity", "Years in business", input.yearsInBusiness, 5, 2, 15, input.source, "Operating history can indicate business durability."),
    numericSignal("verified_proof", "Verified credibility proof", input.confirmedProofCount, 3, 1, 15, input.source, "Credentials, awards, warranties, and confirmed testimonials strengthen credibility."),
    numericSignal("service_breadth", "Confirmed services", input.confirmedServiceCount, 3, 1, 10, input.source, "A clear confirmed offering set supports a viable customer proposition."),
    numericSignal("local_footprint", "Confirmed locations", input.confirmedLocationCount, 1, 1, 10, input.source, "A verified local footprint supports market relevance.")
  ];
  const known = signals.filter((signal) => signal.status !== "unknown");
  const possible = signals.reduce((total, signal) => total + signal.weight, 0);
  const knownWeight = known.reduce((total, signal) => total + signal.weight, 0);
  const coverage = possible ? knownWeight / possible : 0;
  const score = coverage >= 0.6 && knownWeight
    ? Math.round(known.reduce((total, signal) => total + signal.score * signal.weight, 0) / knownWeight)
    : undefined;
  return {
    schemaVersion: 1,
    kind: "business-strength",
    generatedAt: new Date().toISOString(),
    source: input.source,
    coverage: Math.round(coverage * 100) / 100,
    score,
    tier: score === undefined ? undefined : score >= 80 ? "high" : score >= 55 ? "moderate" : "limited",
    signals,
    limitations: [
      input.source === "web_research"
        ? "Web-research signals are inferred and must be confirmed before use in customer-facing claims."
        : "Signals reflect only the verified business facts currently stored by Lodesta.",
      "Business strength is an internal GTM signal and is never included in the website-quality score or public website report."
    ]
  };
}

function numericSignal(
  id: string,
  label: string,
  value: number | undefined,
  strongAt: number,
  moderateAt: number,
  weight: number,
  source: BusinessStrengthAssessment["source"],
  explanation: string
): BusinessStrengthSignal {
  if (value === undefined || !Number.isFinite(value)) {
    return { id, label, status: "unknown", score: 0, weight, explanation: `${explanation} No reliable value was available.`, source };
  }
  const score = value >= strongAt ? 100 : value >= moderateAt ? 65 : Math.max(0, Math.round((value / Math.max(moderateAt, 1)) * 50));
  return {
    id,
    label,
    status: score >= 80 ? "strong" : score >= 50 ? "moderate" : "limited",
    score,
    weight,
    value,
    explanation,
    source
  };
}
