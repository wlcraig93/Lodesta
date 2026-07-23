const dayAliases: Record<string, string> = {
  mo: "Monday",
  mon: "Monday",
  monday: "Monday",
  tu: "Tuesday",
  tue: "Tuesday",
  tues: "Tuesday",
  tuesday: "Tuesday",
  we: "Wednesday",
  wed: "Wednesday",
  weds: "Wednesday",
  wednesday: "Wednesday",
  th: "Thursday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  thursday: "Thursday",
  fr: "Friday",
  fri: "Friday",
  friday: "Friday",
  sa: "Saturday",
  sat: "Saturday",
  saturday: "Saturday",
  su: "Sunday",
  sun: "Sunday",
  sunday: "Sunday"
};

const dayToken = "(?:monday|mon|mo|tuesday|tues|tue|tu|wednesday|weds|wed|we|thursday|thurs|thur|thu|th|friday|fri|fr|saturday|sat|sa|sunday|sun|su)";
const dayPrefixPattern = new RegExp(`^(${dayToken})(?:\\s*(?:[-\\u2013\\u2014]|to|through)\\s*(${dayToken}))?\\s*:?[\\s-]*(.+)$`, "i");

export function normalizeObservedBusinessHours(values: Iterable<string>): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const rawValue of values) {
    const compact = rawValue.replace(/\s+/g, " ").trim();
    if (!compact) continue;
    const parsed = parseObservedBusinessHoursLine(compact);
    if (!parsed) continue;
    const label = parsed.label;
    const value = parsed.value;
    if (!value) continue;
    if (!result[label]) result[label] = value;
    else if (!result[label].split(/\s*;\s*/).includes(value)) result[label] = `${result[label]}; ${value}`;
  }
  return Object.keys(result).length ? result : undefined;
}

export function parseObservedBusinessHoursLine(input: string): { label: string; value: string } | undefined {
  const compact = input.replace(/\s+/g, " ").trim().replace(/^hours?\s*:\s*/i, "");
  const match = compact.match(dayPrefixPattern);
  if (!match) return undefined;
  const start = canonicalDay(match[1]);
  const end = canonicalDay(match[2]);
  const value = match[3]?.replace(/^[:\s-]+/, "").trim();
  if (!start || !value) return undefined;
  return { label: end ? `${start}-${end}` : start, value };
}

export function preferBusinessNameCandidate(current: string | undefined, candidate: string | undefined, hostname: string) {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentScore = businessNameCandidateScore(current, hostname);
  const candidateScore = businessNameCandidateScore(candidate, hostname);
  return candidateScore > currentScore ? candidate : current;
}

export function businessNameCandidateScore(candidate: string, hostname: string) {
  const normalizedCandidate = normalizedId(candidate);
  const normalizedHost = normalizedId(hostname.replace(/^www\./, "").split(".")[0] ?? "");
  let score = 0;
  if (normalizedCandidate && normalizedHost && (normalizedHost.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedHost))) score += 6;
  if (/\b(auto|automotive|body|paint|collision|repair|restaurant|cafe|dental|law|salon|spa|clinic|plumbing|hvac|landscap|studio|shop|company|co\.?|llc|inc\.?)\b/i.test(candidate)) score += 2;
  if (/\b(you can trust|count on|welcome|done right|best|affordable|professional)\b/i.test(candidate)) score -= 4;
  if (/\b(experts?|quality service|trusted choice)\b/i.test(candidate)) score -= 2;
  if (/[!?]/.test(candidate)) score -= 2;
  const words = candidate.trim().split(/\s+/).length;
  if (words < 2) score -= 1;
  if (words > 7) score -= 2;
  return score;
}

function canonicalDay(input: string | undefined) {
  return input ? dayAliases[input.toLowerCase()] : undefined;
}

function normalizedId(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
