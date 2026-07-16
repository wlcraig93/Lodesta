const dayPattern = "(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const dayRangePattern = new RegExp(`^(${dayPattern}(?:\\s*(?:[\\u2013\\u2014-]|to)\\s*${dayPattern})?)\\b[\\s:\\u2013\\u2014-]*`, "i");
const dayRangeScanPattern = new RegExp(`(${dayPattern}(?:\\s*(?:[\\u2013\\u2014-]|to)\\s*${dayPattern})?)\\b[\\s:\\u2013\\u2014-]*`, "gi");

export function canonicalBusinessServices(services: string[]) {
  const seen = new Set<string>();
  return services.flatMap((raw) => {
    const value = raw.replace(/\s+/g, " ").replace(/^[|,:;\-\s]+|[|,:;\-\s]+$/g, "").trim();
    if (!value || value.length > 80) return [];
    if (/^(?:request|get|book|schedule|call|contact|view|learn|see)\b.*\b(?:estimate|quote|appointment|service|services|repair|repairs|more|us|now|today)$/i.test(value)) return [];
    if (/^(?:request|get)\s+(?:a\s+)?(?:repair\s+)?(?:estimate|quote)$/i.test(value)) return [];
    const key = value.toLocaleLowerCase("en-US");
    if (seen.has(key)) return [];
    seen.add(key);
    return [value];
  }).slice(0, 20);
}

export function canonicalBusinessHours(hours: Record<string, string> | undefined) {
  if (!hours) return [];
  const entries: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const [rawKey, rawValue] of Object.entries(hours)) {
    const value = rawValue?.replace(/\s+/g, " ").trim();
    if (!value || isDynamicHoursStatus(value)) continue;
    const junkKey = /^hours?[_\s-]*\d*$/i.test(rawKey) || /^\d+$/.test(rawKey);
    const segments = junkKey ? splitHoursSegments(value) : [value];
    for (const segment of segments) {
      const match = segment.match(dayRangePattern);
      const label = match ? titleCaseDays(match[1]) : junkKey ? "" : titleCaseDays(rawKey.replace(/_/g, " ").trim());
      const times = match ? segment.slice(match[0].length).replace(/^[,:;|]\s*/, "").trim() : segment;
      if (!label || !times || isDynamicHoursStatus(times)) continue;
      const key = label.toLocaleLowerCase("en-US");
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ label, value: normalizeHoursValue(times) });
    }
  }
  return entries;
}

function splitHoursSegments(value: string) {
  const matches = [...value.matchAll(dayRangeScanPattern)];
  if (matches.length <= 1) return [value];
  return matches.flatMap((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? value.length;
    const segment = value.slice(start, end).replace(/^[,:;|]\s*/, "").replace(/[,:;|]\s*$/, "").trim();
    return segment ? [segment] : [];
  });
}

function isDynamicHoursStatus(value: string) {
  return /\b(currently|right now|at the moment|open again|opens? at|closing soon|closed now|back open)\b/i.test(value);
}

function normalizeHoursValue(value: string) {
  return value
    .replace(/\b(a\.m\.|am)\b/gi, "AM")
    .replace(/\b(p\.m\.|pm)\b/gi, "PM")
    .replace(/\s*([\u2013\u2014-])\s*/g, " $1 ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function titleCaseDays(value: string) {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/\s*[\u2013\u2014-]\s*/g, " - ")
    .replace(/(^|\s)\S/g, (match) => match.toUpperCase());
}
