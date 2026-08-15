const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function orderedLocationHours(value: Record<string, string> | undefined) {
  return Object.entries(value ?? {}).map(([rawLabel, itemValue], sourceIndex) => {
    const [firstLabel, lastLabel = firstLabel] = rawLabel.split("-").map((part) => part.trim()) as [(typeof days)[number], (typeof days)[number]?];
    const order = days.indexOf(firstLabel);
    const endOrder = days.indexOf(lastLabel);
    return {
      key: `${rawLabel}:${sourceIndex}`,
      label: rawLabel,
      value: formatLocalHoursValue(itemValue),
      order,
      endOrder: endOrder >= order ? endOrder : order,
      sourceIndex
    };
  }).sort((left, right) => left.order - right.order || left.sourceIndex - right.sourceIndex);
}

export function formatLocalHoursValue(value: string) {
  const normalized = value.normalize("NFKC").replace(/[–—]/g, "-").trim();
  const match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return value;
  return `${formatClockTime(match[1]!, match[2]!)}–${formatClockTime(match[3]!, match[4]!)}`;
}

export function summarizedLocationHours(value: Record<string, string> | undefined) {
  const ordered = orderedLocationHours(value);
  if (!ordered.length) return "";
  if (ordered.every((item) => isContinuousAvailabilityValue(item.value))) return "Open 24 hours daily";
  const groups: Array<{ first: string; last: string; value: string; endOrder: number }> = [];
  for (const item of ordered) {
    const prior = groups.at(-1);
    if (prior?.value === item.value && item.order === prior.endOrder + 1) {
      prior.last = item.label;
      prior.endOrder = item.endOrder;
    } else {
      groups.push({ first: item.label, last: item.label, value: item.value, endOrder: item.endOrder });
    }
  }
  return groups
    .map((group) => `${group.first === group.last ? group.first : `${group.first}–${group.last}`}: ${group.value}`)
    .join("; ");
}

export function formatLocalAddress(location: {
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}) {
  assertUsCountry(location.country);
  const locality = [location.city, location.region].filter(Boolean).join(", ");
  const localityAndPostal = [locality, location.postalCode].filter(Boolean).join(" ");
  return [location.street, localityAndPostal].filter(Boolean).join(", ");
}

export function directionsHrefForLocation(location: {
  label: string;
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}) {
  const address = [location.street, location.city, location.region, location.postalCode, location.country].filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address || location.label)}`;
}

export function assertUsCountry(value: string | undefined) {
  if (!value || value.toUpperCase() === "US") return;
  throw new Error(`BusinessAddress.local supports US locations only; received ${value}.`);
}

export function formatPhoneForDisplay(value: string) {
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return value;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

export function isContinuousAvailabilityValue(value: string) {
  const normalized = value.normalize("NFKC").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!normalized
    || /\b(?:not|isn['’]?t|aren['’]?t|except|excluding|closed)\b/i.test(normalized)
    || /\b(?:emergency|phone|line|support|service|on[ -]?call|appointment|dispatch)\b/i.test(normalized)) {
    return false;
  }
  return /^(?:open\s+)?(?:24\s*hours?(?:\s+(?:a\s+day|daily))?|24\s*\/\s*7)$/i.test(normalized);
}

function formatClockTime(rawHour: string, minute: string) {
  const hour = Number(rawHour);
  const displayHour = hour % 12 || 12;
  return `${displayHour}${minute === "00" ? "" : `:${minute}`} ${hour < 12 ? "AM" : "PM"}`;
}
