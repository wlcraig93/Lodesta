import { z } from "zod";
import type {
  AnalyticsActionType,
  AnalyticsChannel,
  AnalyticsDeviceCategory,
  AnalyticsReportInterval,
  AnalyticsReportQuery,
  AnalyticsReportView
} from "@/packages/site-capabilities/contracts";

export type AnalyticsRange = "today" | "yesterday" | "7d" | "30d" | "90d" | "mtd" | "ytd" | "since_launch" | "custom";
export type AnalyticsComparison = "off" | "previous_period" | "previous_year" | "custom";

export type AnalyticsUrlQuery = AnalyticsReportQuery & {
  range: AnalyticsRange;
  compare: AnalyticsComparison;
  requestedInterval: "auto" | AnalyticsReportInterval;
};

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const viewSchema = z.enum(["overview", "traffic", "content", "actions"]);
const rangeSchema = z.enum(["today", "yesterday", "7d", "30d", "90d", "mtd", "ytd", "since_launch", "custom"]);
const comparisonSchema = z.enum(["off", "previous_period", "previous_year", "custom"]);
const intervalSchema = z.enum(["auto", "day", "week", "month"]);
const channelSchema = z.enum(["campaign", "organic_search", "social", "referral", "direct"]);
const actionSchema = z.enum(["form_submit", "call_click", "email_click", "directions_click", "booking_click", "ordering_click"]);
const deviceSchema = z.enum(["mobile", "tablet", "desktop"]);

export function parseAnalyticsQuery(
  searchParams: Record<string, string | string[] | undefined>,
  input: { timezone: string; siteCreatedAt: string; now?: Date }
): AnalyticsUrlQuery {
  const now = input.now ?? new Date();
  const today = dateInTimezone(now, input.timezone);
  const range = value(rangeSchema, searchParams.range) ?? "30d";
  const customFrom = value(dateSchema, searchParams.from);
  const customTo = value(dateSchema, searchParams.to);
  const bounds = rangeBounds(range, today, dateInTimezone(new Date(input.siteCreatedAt), input.timezone), customFrom, customTo);
  const compare = value(comparisonSchema, searchParams.compare) ?? "off";
  const customCompareFrom = value(dateSchema, searchParams.compareFrom);
  const customCompareTo = value(dateSchema, searchParams.compareTo);
  const comparison = comparisonBounds(compare, bounds, customCompareFrom, customCompareTo);
  const requestedInterval = value(intervalSchema, searchParams.interval) ?? "auto";
  return {
    view: value(viewSchema, searchParams.view) ?? "overview",
    range,
    compare,
    from: bounds.from,
    to: bounds.to,
    compareFrom: comparison?.from,
    compareTo: comparison?.to,
    requestedInterval,
    interval: requestedInterval === "auto" ? automaticInterval(bounds.from, bounds.to) : requestedInterval,
    timezone: validTimezone(input.timezone) ? input.timezone : "UTC",
    filters: {
      channel: value(channelSchema, searchParams.channel) as AnalyticsChannel | undefined,
      source: cleanFilter(single(searchParams.source)),
      page: cleanPage(single(searchParams.page)),
      action: value(actionSchema, searchParams.action) as AnalyticsActionType | undefined,
      device: value(deviceSchema, searchParams.device) as AnalyticsDeviceCategory | undefined
    }
  };
}

export function analyticsQuerySearchParams(query: AnalyticsUrlQuery, overrides: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams({
    view: query.view,
    range: query.range,
    from: query.from,
    to: query.to,
    compare: query.compare,
    interval: query.requestedInterval
  });
  if (query.compareFrom) params.set("compareFrom", query.compareFrom);
  if (query.compareTo) params.set("compareTo", query.compareTo);
  if (query.filters.channel) params.set("channel", query.filters.channel);
  if (query.filters.source) params.set("source", query.filters.source);
  if (query.filters.page) params.set("page", query.filters.page);
  if (query.filters.action) params.set("action", query.filters.action);
  if (query.filters.device) params.set("device", query.filters.device);
  for (const [key, value] of Object.entries(overrides)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params;
}

export function formatAnalyticsRange(query: AnalyticsUrlQuery) {
  const format = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${format.format(new Date(`${query.from}T12:00:00Z`))} – ${format.format(new Date(`${query.to}T12:00:00Z`))}`;
}

export function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function analyticsViewLabel(view: AnalyticsReportView) {
  return view === "actions" ? "Customer actions" : view[0].toUpperCase() + view.slice(1);
}

function rangeBounds(range: AnalyticsRange, today: string, launch: string, from?: string, to?: string) {
  if (range === "custom" && from && to && from <= to) return { from, to };
  if (range === "today") return { from: today, to: today };
  if (range === "yesterday") {
    const yesterday = addDays(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (range === "mtd") return { from: `${today.slice(0, 8)}01`, to: today };
  if (range === "ytd") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (range === "since_launch") return { from: launch, to: today };
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  return { from: addDays(today, -(days - 1)), to: today };
}

function comparisonBounds(compare: AnalyticsComparison, current: { from: string; to: string }, from?: string, to?: string) {
  if (compare === "off") return undefined;
  if (compare === "custom") return from && to && from <= to ? { from, to } : undefined;
  if (compare === "previous_year") return { from: shiftYear(current.from, -1), to: shiftYear(current.to, -1) };
  const days = dayDifference(current.from, current.to) + 1;
  return { from: addDays(current.from, -days), to: addDays(current.from, -1) };
}

function automaticInterval(from: string, to: string): AnalyticsReportInterval {
  const days = dayDifference(from, to) + 1;
  return days <= 45 ? "day" : days <= 180 ? "week" : "month";
}

function dateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimezone(timezone) ? timezone : "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function shiftYear(date: string, years: number) {
  const value = new Date(`${date}T12:00:00Z`);
  const month = value.getUTCMonth();
  value.setUTCFullYear(value.getUTCFullYear() + years);
  if (value.getUTCMonth() !== month) value.setUTCDate(0);
  return value.toISOString().slice(0, 10);
}

function dayDifference(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function cleanPage(value: string | undefined) {
  if (!value) return undefined;
  const path = value.trim().slice(0, 500);
  return path.startsWith("/") && !path.includes("?") && !path.includes("#") ? path : undefined;
}

function cleanFilter(value: string | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length <= 160 ? normalized : undefined;
}

function value<T extends z.ZodTypeAny>(schema: T, source: string | string[] | undefined): z.infer<T> | undefined {
  const parsed = schema.safeParse(single(source));
  return parsed.success ? parsed.data : undefined;
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
