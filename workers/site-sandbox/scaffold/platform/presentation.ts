const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const dayAliases = new Map(days.flatMap((day, index) => [
  [day.toLowerCase(), { day, index }],
  [day.slice(0, 3).toLowerCase(), { day, index }]
] as const));

export function orderedLocationHours(value: Record<string, string> | undefined) {
  return Object.entries(value ?? {}).map(([rawLabel, itemValue], sourceIndex) => {
    const normalized = normalizeLegacyHoursEntry(rawLabel, itemValue);
    const parts = normalized.label.trim().split(/\s*[-\u2013\u2014]\s*/).filter(Boolean);
    const start = dayAliases.get(parts[0]?.toLowerCase() ?? "");
    const end = parts.length === 2 ? dayAliases.get(parts[1]?.toLowerCase() ?? "") : undefined;
    const label = start ? (end ? `${start.day}-${end.day}` : start.day) : normalized.label.trim();
    return { key: `${rawLabel}:${sourceIndex}`, label, value: normalized.value, order: start?.index ?? days.length, sourceIndex };
  }).sort((left, right) => left.order - right.order || (left.order === days.length ? left.label.localeCompare(right.label) : left.sourceIndex - right.sourceIndex));
}

function normalizeLegacyHoursEntry(label: string, value: string) {
  if (!/^(?:hours|weekday)_\d+$/i.test(label.trim())) return { label, value };
  const match = value.trim().match(/^((?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?:\s*[-\u2013\u2014]\s*(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?))?)\s*:?\s*(.+)$/i);
  return match ? { label: match[1], value: match[2] } : { label: "Hours", value };
}

export function formatPhoneForDisplay(value: string) {
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return value;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}
