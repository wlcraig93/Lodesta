import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  classifyAnalyticsChannel,
  classifyAnalyticsTraffic,
  normalizeAnalyticsPath,
  normalizeAnalyticsVisitor,
  normalizeCampaignValue,
  normalizeReferrerHost
} from "./analytics";
import { hmacSha256Hex } from "./hash-secret";
import { isCustomDomainRequest, isPlatformHost, requestHostname } from "./host-routing";
import { sanitizeAnalyticsMetadata } from "./privacy";
import { getCurrentUser } from "./supabase/server";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";
import { analyticsEventTypes, type AnalyticsEvent, type AnalyticsEventType, type AnalyticsTrafficClass } from "@/packages/site-capabilities/contracts";
import type { PlatformSiteRecord, SitePublicBuildInput, SiteVersion } from "@/packages/site-contracts";

const publicEventTypes = analyticsEventTypes.filter((event) => event !== "form_submit");
const clientEventSchema = z.object({
  siteId: z.string().min(1).max(120),
  versionId: z.string().min(1).max(120).optional(),
  eventId: z.string().min(8).max(120),
  visitorId: z.string().min(8).max(120),
  visitId: z.string().min(8).max(120),
  eventType: z.enum(publicEventTypes as [typeof publicEventTypes[number], ...typeof publicEventTypes[number][]]),
  pagePath: z.string().min(1).max(500),
  landingPath: z.string().min(1).max(500).optional(),
  referrerHost: z.string().max(500).optional(),
  utmSource: z.string().max(160).optional(),
  utmMedium: z.string().max(160).optional(),
  utmCampaign: z.string().max(160).optional(),
  deviceCategory: z.enum(["mobile", "tablet", "desktop"]),
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
  properties: z.record(z.union([z.string().max(500), z.number().finite(), z.boolean()])).optional()
}).strict();

export type AnalyticsClientEvent = z.infer<typeof clientEventSchema>;

export type AnalyticsServingContext =
  | { ok: false; status: number; reason: "invalid" | "preview" | "inactive" | "disabled" | "internal" | "bot"; site?: PlatformSiteRecord }
  | {
      ok: true;
      site: PlatformSiteRecord;
      version: SiteVersion;
      buildInput: SitePublicBuildInput;
      trafficClass: AnalyticsTrafficClass;
    };

export async function parseAnalyticsClientEvent(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 12_000) return { ok: false as const, error: "Analytics event is too large." };
  const text = await request.text();
  if (text.length > 12_000) return { ok: false as const, error: "Analytics event is too large." };
  const parsed = clientEventSchema.safeParse(safeJson(text));
  return parsed.success
    ? { ok: true as const, event: parsed.data }
    : { ok: false as const, error: "Invalid analytics event.", issues: parsed.error.issues };
}

export async function resolveAnalyticsServingContext(
  request: Request,
  claimedSiteId: string,
  claimedVersionId?: string,
  options: { requireAnalytics?: boolean } = {}
): Promise<AnalyticsServingContext> {
  const userAgent = request.headers.get("user-agent");
  const trafficClass = hasValidInternalTrafficHeader(request)
    ? "lodesta_internal"
    : classifyAnalyticsTraffic(userAgent);
  const site = await resolveServingSite(request, claimedSiteId);
  if (!site) return { ok: false, status: 404, reason: "invalid" };
  if (trafficClass === "lodesta_internal") return { ok: false, status: 202, reason: "internal", site };
  if (trafficClass === "known_bot") return { ok: false, status: 202, reason: "bot", site };
  if (isPreviewRequest(request)) return { ok: false, status: 202, reason: "preview", site };
  if (site.status !== "active" || !site.publishedVersionId) return { ok: false, status: 202, reason: "inactive", site };
  if (claimedVersionId && claimedVersionId !== site.publishedVersionId) return { ok: false, status: 409, reason: "invalid", site };

  const version = await sitePlatformRepository.getSiteVersion(site.publishedVersionId);
  if (!version || version.siteId !== site.id || version.status !== "published") {
    return { ok: false, status: 409, reason: "invalid", site };
  }
  const buildInput = await sitePlatformRepository.getPublicBuildInput(version.publicBuildInputId);
  if (!buildInput || buildInput.siteId !== site.id) return { ok: false, status: 409, reason: "invalid", site };
  if (options.requireAnalytics !== false && !buildInput.intent.enabledCapabilities.includes("analytics")) {
    return { ok: false, status: 202, reason: "disabled", site };
  }

  const auth = await getCurrentUser();
  if (auth.user?.id && (site.ownerUserId === auth.user.id || auth.user.app_metadata?.role === "platform_admin")) {
    return { ok: false, status: 202, reason: "internal", site };
  }
  return { ok: true, site, version, buildInput, trafficClass };
}

export function canonicalAnalyticsEvent(
  context: Extract<AnalyticsServingContext, { ok: true }>,
  input: AnalyticsClientEvent,
  eventType: AnalyticsEventType = input.eventType,
  properties: Record<string, string | number | boolean> = input.properties ?? {},
  now = new Date()
): AnalyticsEvent {
  const source = normalizeCampaignValue(input.utmSource);
  const medium = normalizeCampaignValue(input.utmMedium);
  const campaign = normalizeCampaignValue(input.utmCampaign);
  const referrerHost = normalizeReferrerHost(input.referrerHost);
  return {
    schemaVersion: 1,
    eventId: input.eventId,
    siteId: context.site.id,
    siteVersionId: context.version.id,
    eventType,
    visitorKey: normalizeAnalyticsVisitor(context.site.id, input.visitorId),
    visitId: scopedVisitId(context.site.id, input.visitId),
    pagePath: normalizeAnalyticsPath(input.pagePath),
    landingPath: normalizeAnalyticsPath(input.landingPath ?? input.pagePath),
    channel: classifyAnalyticsChannel({ utmSource: source, utmMedium: medium, referrerHost }),
    source,
    medium,
    campaign,
    referrerHost,
    deviceCategory: input.deviceCategory,
    properties: boundedProperties(eventType, { ...(properties ?? {}), elapsedMs: input.elapsedMs ?? 0 }),
    occurredAt: now.toISOString(),
    createdAt: now.toISOString()
  };
}

export function analyticsClientContextFromForm(input: {
  siteId: string;
  eventId?: string;
  visitorId?: string;
  visitId?: string;
  pagePath: string;
  landingPath?: string;
  referrerHost?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  deviceCategory?: string;
  elapsedMs?: number;
}): AnalyticsClientEvent | undefined {
  const parsed = clientEventSchema.safeParse({
    siteId: input.siteId,
    eventId: input.eventId,
    visitorId: input.visitorId,
    visitId: input.visitId,
    eventType: "form_start",
    pagePath: input.pagePath || "/",
    landingPath: input.landingPath,
    referrerHost: input.referrerHost,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    deviceCategory: input.deviceCategory,
    elapsedMs: input.elapsedMs
  });
  return parsed.success ? parsed.data : undefined;
}

export function internalTrafficHeader(at = Date.now()) {
  const timestamp = String(at);
  return `${timestamp}.${hmacSha256Hex(`lodesta-internal-traffic-v1\n${timestamp}`)}`;
}

function hasValidInternalTrafficHeader(request: Request) {
  const [timestamp, signature] = (request.headers.get("x-lodesta-internal-traffic") ?? "").split(".");
  const at = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(at) || Math.abs(Date.now() - at) > 5 * 60_000) return false;
  const expected = hmacSha256Hex(`lodesta-internal-traffic-v1\n${timestamp}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function resolveServingSite(request: Request, claimedSiteId: string) {
  const hostname = requestHostname(request.headers);
  if (!hostname) return undefined;
  if (isCustomDomainRequest(request.headers) || !isPlatformHost(hostname)) {
    const domain = await platformOperationsRepository.getDomainByHostname(hostname);
    if (!domain || domain.siteId !== claimedSiteId) return undefined;
    return sitePlatformRepository.getSite(domain.siteId);
  }
  const referrer = parseUrl(request.headers.get("referer"));
  if (!referrer || referrer.hostname !== hostname) return undefined;
  const slug = /^\/sites\/([^/]+)(?:\/|$)/.exec(referrer.pathname)?.[1];
  if (!slug) return undefined;
  const site = await sitePlatformRepository.getSiteBySlug(decodeURIComponent(slug));
  return site?.id === claimedSiteId ? site : undefined;
}

function isPreviewRequest(request: Request) {
  const referrer = parseUrl(request.headers.get("referer"));
  return Boolean(referrer && (
    referrer.pathname.startsWith("/preview/")
    || referrer.pathname.startsWith("/api/site-versions/")
    || referrer.pathname.startsWith("/api/site-agent/")
  ));
}

function parseUrl(value: string | null) {
  try {
    return value ? new URL(value) : undefined;
  } catch {
    return undefined;
  }
}

function scopedVisitId(siteId: string, visitId: string) {
  return `visit:${hmacSha256Hex(`analytics-visit-v1\n${siteId}\n${visitId}`).slice(0, 40)}`;
}

function boundedProperties(eventType: string, value: Record<string, string | number | boolean>) {
  const allowed: Record<string, Set<string>> = {
    page_view: new Set(["elapsedMs", "returning"]),
    engagement: new Set(["elapsedMs", "engagedMs", "maxScrollDepth"]),
    form_start: new Set(["elapsedMs", "formId"]),
    form_submit: new Set(["elapsedMs", "formId", "inquiryId"]),
    call_click: new Set(["elapsedMs", "role"]),
    email_click: new Set(["elapsedMs", "role"]),
    directions_click: new Set(["elapsedMs", "role"]),
    booking_click: new Set(["elapsedMs", "role"]),
    ordering_click: new Set(["elapsedMs", "role"]),
    outbound_click: new Set(["elapsedMs", "role", "destinationHost"]),
    web_vital: new Set(["elapsedMs", "metric", "value"])
  };
  const sanitized = sanitizeAnalyticsMetadata(value) ?? {};
  return Object.fromEntries(Object.entries(sanitized).filter(([key]) => allowed[eventType]?.has(key)).slice(0, 8)) as Record<string, string | number | boolean>;
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
