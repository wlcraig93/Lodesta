/**
 * Retained-source lines that state a sensitive commercial claim about the
 * business (credentials, ratings, guarantees, safety, availability, cadence,
 * return-service promises, or offers). Author-facing evidence withholds these
 * lines; such claims reach published copy only through exact publicFacts.
 */
export function containsGatedBusinessClaim(line: string) {
  const describesBusiness = /\b(?:we|our|us|company|team|technicians?|services?|methods?|treatments?|plans?|programs?)\b/i.test(line);
  const gatedQuality = /\b(?:licensed|insured|certified|award(?:ed|s)?|ratings?|reviews?|guarantee(?:d|s)?|warrant(?:y|ies)|safe(?:ty|r|st)?|eco[- ]?friendly|environmentally friendly|non[- ]?toxic|pet[- ]?safe|child[- ]?safe|organic|free (?:estimates?|inspections?|consultations?|quotes?)|same[- ]?day|24\s*\/\s*7|emergency|permanent(?:ly)?|years? of experience)\b/i.test(line);
  const directSafetyClaim = /\b(?:eco[- ]?friendly|environmentally friendly|non[- ]?toxic|pet[- ]?safe|child[- ]?safe|safe for (?:people|pets|children|famil(?:y|ies)|the environment)|gentle on (?:your )?home|kind to the earth)\b/i.test(line);
  const gatedCadence = /\b(?:every (?:\d+|one|two|three|other) months?|every month|other month|quarterly|bi[- ]?monthly|recurring visits?|more frequent service|respond within)\b/i.test(line);
  const directReturnPromise = /\b(?:at no (?:additional|extra) cost|free of charge|free re[- ]?treat|free re[- ]?service|come back (?:and )?re[- ]?treat)\b/i.test(line);
  const directOffer = /\b(?:\d+% off|save \d+%|discount|limited[- ]time offer)\b/i.test(line);
  return (describesBusiness && gatedQuality) || directSafetyClaim || gatedCadence || directReturnPromise || directOffer;
}
