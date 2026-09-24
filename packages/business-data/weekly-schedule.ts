/**
 * Canonical per-day weekly schedules shared by crawl consensus and source
 * suitability. "Mon-Fri 8am-5pm" and "Monday: 8:00 AM - 5:00 PM" produce the
 * same schedule, and split schedules (Mon-Fri 8-5, Sat 9-1) stay per day.
 */
export const canonicalWeekDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

/**
 * Expands extracted hour labels ("Monday-Friday", "Saturday") to single days
 * and each value to sorted 24-hour ranges. Returns undefined when any label or
 * value cannot be understood, so unknown formats never manufacture a conflict.
 */
export function canonicalWeeklySchedule(hours: Record<string, string>) {
  const schedule = new Map<string, string>();
  for (const [label, value] of Object.entries(hours)) {
    const days = expandHoursDayLabel(label);
    const canonical = canonicalHoursValue(value);
    if (!days || !canonical) return undefined;
    for (const day of days) {
      const existing = schedule.get(day);
      schedule.set(day, existing && existing !== canonical
        ? [...new Set([...existing.split(","), ...canonical.split(",")])].sort().join(",")
        : canonical);
    }
  }
  return schedule;
}

function expandHoursDayLabel(label: string) {
  const parts = label.toLowerCase().split(/\s*[-–—]\s*/).map((part) => part.trim());
  const indexOf = (part: string | undefined) => part
    ? canonicalWeekDays.findIndex((day) => day === part || (part.length >= 2 && day.startsWith(part)))
    : -1;
  const start = indexOf(parts[0]);
  if (start < 0 || parts.length > 2) return undefined;
  if (parts.length === 1) return [canonicalWeekDays[start]];
  const end = indexOf(parts[1]);
  if (end < 0) return undefined;
  const days: string[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const index = (start + offset) % 7;
    days.push(canonicalWeekDays[index]);
    if (index === end) break;
  }
  return days;
}

function canonicalHoursValue(value: string) {
  const compact = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^(?:closed)$/.test(compact)) return "closed";
  if (/^(?:open 24 hours?|24 hours?)$/.test(compact)) return "00:00-24:00";
  if (/^by appointment$/.test(compact)) return "appointment";
  const ranges = compact.split(/\s*[,;]\s*/).filter(Boolean).map((range) => {
    const match = range.match(/^(.+?)\s*(?:-|–|—|to)\s*(.+)$/);
    if (!match) return undefined;
    const start = canonicalClockTime(match[1]!, match[2]!);
    const end = canonicalClockTime(match[2]!);
    return start && end ? `${start}-${end}` : undefined;
  });
  if (!ranges.length || ranges.some((range) => !range)) return undefined;
  return [...new Set(ranges as string[])].sort().join(",");
}

/** Normalizes 8am, 8:00 AM, 8 a.m., and 08:00 to "08:00". An opening time
 * without a meridiem borrows the closing time's ("8-5pm" is 8:00-17:00 only
 * when that ordering is plausible). */
function canonicalClockTime(value: string, pairedClosing?: string): string | undefined {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  let meridiem: string | undefined = match[3]?.replace(/\./g, "");
  if (!meridiem && pairedClosing) {
    const closing = pairedClosing.trim().match(/(a\.?m\.?|p\.?m\.?)$/)?.[1]?.replace(/\./g, "");
    // "8-5pm": an unlabeled opening hour greater than the closing hour is AM.
    const closingHour = Number(pairedClosing.trim().match(/^(\d{1,2})/)?.[1] ?? NaN);
    if (closing === "pm" && hour > closingHour && hour <= 12) meridiem = "am";
    else meridiem = closing;
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (meridiem === "pm" && hour !== 12) hour += 12;
  } else if (!match[2]) {
    return undefined;
  }
  if (hour > 24 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

