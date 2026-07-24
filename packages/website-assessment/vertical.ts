import type { CrawlAssessment } from "@/lib/crawler";
import type { Vertical } from "@/packages/acquisition/presence-contracts";

type VerticalSignal = { vertical: Vertical; pattern: RegExp; label: string; weight: number };

const signals: VerticalSignal[] = [
  { vertical: "restaurant", pattern: /\b(restaurant|menu|dining|catering|reservation|takeout)\b/i, label: "restaurant language", weight: 0.4 },
  { vertical: "auto_body", pattern: /\b(auto body|collision|dent repair|paintless dent|body shop)\b/i, label: "collision repair language", weight: 0.45 },
  { vertical: "auto_services", pattern: /\b(auto repair|mechanic|oil change|brake repair|tire shop|transmission)\b/i, label: "automotive service language", weight: 0.42 },
  { vertical: "beauty_salon", pattern: /\b(salon|haircut|hair color|stylist|manicure|barber)\b/i, label: "salon language", weight: 0.42 },
  { vertical: "med_spa", pattern: /\b(med spa|medspa|botox|injectable|laser treatment|aesthetic medicine)\b/i, label: "medical aesthetics language", weight: 0.48 },
  { vertical: "law_firm", pattern: /\b(attorney|law firm|legal counsel|lawyer|litigation)\b/i, label: "legal service language", weight: 0.46 },
  { vertical: "dental", pattern: /\b(dentist|dental|orthodont|teeth|oral surgery)\b/i, label: "dental language", weight: 0.46 },
  { vertical: "home_services", pattern: /\b(plumber|plumbing|electrician|electrical|hvac|roofing|contractor|heating|cooling)\b/i, label: "home service language", weight: 0.42 },
  { vertical: "fitness", pattern: /\b(gym|fitness|personal training|pilates|yoga|strength training)\b/i, label: "fitness language", weight: 0.42 },
  { vertical: "real_estate", pattern: /\b(real estate|realtor|homes for sale|property management|brokerage)\b/i, label: "real estate language", weight: 0.45 },
  { vertical: "landscaping", pattern: /\b(landscap|lawn care|hardscape|tree service|irrigation)\b/i, label: "landscaping language", weight: 0.45 },
  { vertical: "veterinary", pattern: /\b(veterinar|animal hospital|pet clinic|pet wellness)\b/i, label: "veterinary language", weight: 0.46 },
  { vertical: "creative_studio", pattern: /\b(creative studio|photograph|videograph|design studio|branding studio)\b/i, label: "creative studio language", weight: 0.4 }
];

export function inferAssessmentVertical(input: {
  sourceUrl?: string;
  crawl?: CrawlAssessment;
  declaredVertical?: string;
}) {
  if (input.declaredVertical && input.declaredVertical !== "general_local") {
    return {
      vertical: input.declaredVertical,
      confidence: 1,
      evidence: ["Vertical supplied by the verified Lodesta business record."]
    };
  }
  const text = [
    input.sourceUrl,
    input.crawl?.title,
    input.crawl?.metaDescription,
    input.crawl?.extractedFacts.name,
    ...input.crawl?.extractedFacts.categories ?? [],
    ...input.crawl?.extractedFacts.services ?? [],
    ...input.crawl?.pageSummaries.flatMap((page) => [page.title, page.metaDescription, page.mainText?.slice(0, 1_500)]) ?? []
  ].filter(Boolean).join("\n");
  const scores = new Map<Vertical, { score: number; evidence: string[] }>();
  for (const signal of signals) {
    const matches = text.match(new RegExp(signal.pattern.source, `${signal.pattern.flags.replace("g", "")}g`))?.length ?? 0;
    if (!matches) continue;
    const current = scores.get(signal.vertical) ?? { score: 0, evidence: [] };
    current.score += Math.min(0.7, signal.weight + Math.max(0, matches - 1) * 0.08);
    current.evidence.push(`${signal.label} matched ${matches} time${matches === 1 ? "" : "s"}.`);
    scores.set(signal.vertical, current);
  }
  const ranked = [...scores.entries()].sort((left, right) => right[1].score - left[1].score);
  const winner = ranked[0];
  if (!winner) return { vertical: "general_local", confidence: 0.35, evidence: ["No category-specific evidence was strong enough to classify the business."] };
  const runnerUp = ranked[1]?.[1].score ?? 0;
  const separation = Math.max(0, winner[1].score - runnerUp);
  const confidence = Math.min(0.98, 0.5 + winner[1].score * 0.45 + separation * 0.25);
  return {
    vertical: winner[0],
    confidence: Math.round(confidence * 100) / 100,
    evidence: winner[1].evidence.slice(0, 6)
  };
}
