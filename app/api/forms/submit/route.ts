import { NextResponse } from "next/server";
import {
  analyticsClientContextFromForm,
  canonicalAnalyticsEvent,
  resolveAnalyticsServingContext
} from "@/lib/analytics-ingestion";
import { ipHashForRequest, sanitizeAnalyticsMetadata, sanitizeAttributionUrl } from "@/lib/privacy";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { validateFormSubmission } from "@/lib/form-validation";
import { siteCapabilityRepository } from "@/packages/site-capabilities";
import { sitePlatformRepository } from "@/packages/platform-data";

export async function POST(request: Request) {
  const limit = rateLimit(request, {
    bucket: "form_submit",
    limit: 12,
    windowMs: 10 * 60_000
  });
  if (!limit.ok) return limit.response;

  const parsedSubmission = await parseSubmissionRequest(request);
  if (!parsedSubmission.ok) {
    return applyRateLimitHeaders(NextResponse.json({ error: parsedSubmission.error }, { status: 400 }), limit);
  }

  const { siteId, formId, honeypot, renderedAt, payload } = parsedSubmission;

  if (!siteId || !formId) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Missing siteId or formId" }, { status: 400 }), limit);
  }
  if (parsedSubmission.pageId.startsWith("/preview/")) {
    return applyRateLimitHeaders(NextResponse.json({ accepted: false, status: "preview_disabled", reason: "Preview forms do not accept submissions." }, { status: 403 }), limit);
  }

  const serving = await resolveAnalyticsServingContext(request, siteId, parsedSubmission.versionId, { requireAnalytics: false });
  if (!serving.ok) {
    return applyRateLimitHeaders(
      NextResponse.json({
        accepted: false,
        status: serving.reason,
        reason: "Lead capture is available only on the active published website."
      }, { status: serving.status >= 400 ? serving.status : 403 }),
      limit
    );
  }

  const form = await sitePlatformRepository.getPublishedFormDefinition(siteId, formId);
  if (!form) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Form is not referenced by a retained published version" }, { status: 404 }),
      limit
    );
  }

  const tooFast = renderedAt > 0 && Date.now() - renderedAt < 800;
  if (honeypot || tooFast) {
    return applyRateLimitHeaders(NextResponse.json({ accepted: true, status: "ignored" }), limit);
  }

  const validation = validateFormSubmission(form, payload);
  if (!validation.ok) {
    return applyRateLimitHeaders(
      NextResponse.json(
        {
          error: validation.error,
          missingFields: validation.missingFields,
          invalidFields: validation.invalidFields,
          ignoredFields: validation.ignoredFields
        },
        { status: 400 }
      ),
      limit
    );
  }

  const submittedAt = new Date();
  const analyticsClientContext = analyticsClientContextFromForm({
    siteId,
    eventId: parsedSubmission.eventId,
    visitorId: parsedSubmission.visitorId,
    visitId: parsedSubmission.visitId,
    pagePath: parsedSubmission.pageId,
    landingPath: stringMetadata(parsedSubmission.metadata, "landingPath"),
    referrerHost: stringMetadata(parsedSubmission.metadata, "referrerHost"),
    utmSource: stringMetadata(parsedSubmission.metadata, "utmSource"),
    utmMedium: stringMetadata(parsedSubmission.metadata, "utmMedium"),
    utmCampaign: stringMetadata(parsedSubmission.metadata, "utmCampaign"),
    deviceCategory: parsedSubmission.deviceCategory,
    elapsedMs: parsedSubmission.elapsedMs
  });
  const analyticsEvent = analyticsClientContext && serving.buildInput.intent.enabledCapabilities.includes("analytics")
    ? canonicalAnalyticsEvent(serving, analyticsClientContext, "form_submit", { formId }, submittedAt)
    : undefined;
  const inquiryResult = await siteCapabilityRepository.createInquiryFromForm({
    siteId,
    form,
    pageId: parsedSubmission.pageId || "unknown",
    visitorId: parsedSubmission.visitorId,
    payload: validation.payload,
    metadata: parsedSubmission.metadata,
    sourceUrl: sanitizeAttributionUrl(parsedSubmission.sourceUrl || request.headers.get("referer") || undefined),
    userAgent: request.headers.get("user-agent") ?? undefined,
    ipHash: ipHashForRequest(request, { siteId, at: submittedAt }),
    analyticsEvent
  });

  return applyRateLimitHeaders(NextResponse.json({ accepted: true, status: "received" }), limit);
}

type ParsedSubmission =
  | { ok: false; error: string }
  | {
      ok: true;
      siteId: string;
      versionId?: string;
      formId: string;
      pageId: string;
      sectionId?: string;
      sessionId?: string;
      visitorId?: string;
      visitId?: string;
      eventId?: string;
      deviceCategory?: string;
      elapsedMs?: number;
      honeypot: string;
      renderedAt: number;
      payload: Record<string, unknown>;
      metadata: Record<string, string | number | boolean>;
      sourceUrl?: string;
    };

async function parseSubmissionRequest(request: Request): Promise<ParsedSubmission> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (!isRecord(body)) return { ok: false, error: "Invalid JSON form submission" };

    const payload = isRecord(body.payload)
      ? body.payload
      : Object.fromEntries(Object.entries(body).filter(([key]) => !systemFormFields.has(key)));

    return {
      ok: true,
      siteId: stringValue(body.siteId),
      versionId: identifierValue(body.versionId),
      formId: stringValue(body.formId),
      pageId: stringValue(body.pageId),
      sectionId: stringValue(body.sectionId) || undefined,
      sessionId: stringValue(body.sessionId) || undefined,
      visitorId: identifierValue(body.visitorId),
      visitId: identifierValue(body.visitId ?? body.sessionId),
      eventId: identifierValue(body.eventId),
      deviceCategory: stringValue(body.deviceCategory) || undefined,
      elapsedMs: numberValue(body.elapsedMs),
      honeypot: stringValue(body.companyWebsite),
      renderedAt: numberValue(body.formRenderedAt ?? body.renderedAt ?? body.startedAt),
      payload,
      metadata: attributionMetadata(body),
      sourceUrl: stringValue(body.sourceUrl) || undefined
    };
  }

  try {
    const formData = await request.formData();
    const payload: Record<string, unknown> = {};

    for (const [key, value] of formData.entries()) {
      if (!systemFormFields.has(key)) {
        payload[key] = formEntryValue(value);
      }
    }

    return {
      ok: true,
      siteId: stringValue(formData.get("siteId")),
      versionId: identifierValue(formData.get("versionId")),
      formId: stringValue(formData.get("formId")),
      pageId: stringValue(formData.get("pageId")),
      sectionId: stringValue(formData.get("sectionId")) || undefined,
      sessionId: stringValue(formData.get("sessionId")) || undefined,
      visitorId: identifierValue(formData.get("visitorId")),
      visitId: identifierValue(formData.get("visitId") ?? formData.get("sessionId")),
      eventId: identifierValue(formData.get("eventId")),
      deviceCategory: stringValue(formData.get("deviceCategory")) || undefined,
      elapsedMs: numberValue(formData.get("elapsedMs")),
      honeypot: stringValue(formData.get("companyWebsite")),
      renderedAt: numberValue(formData.get("formRenderedAt") ?? formData.get("renderedAt") ?? formData.get("startedAt")),
      payload,
      metadata: attributionMetadata(formData),
      sourceUrl: stringValue(formData.get("sourceUrl")) || undefined
    };
  } catch {
    return { ok: false, error: "Unsupported form submission body" };
  }
}

const systemFormFields = new Set([
  "siteId",
  "versionId",
  "formId",
  "pageId",
  "sectionId",
  "sessionId",
  "visitorId",
  "visitId",
  "eventId",
  "deviceCategory",
  "elapsedMs",
  "companyWebsite",
  "formRenderedAt",
  "sourceUrl",
  "landingPath",
  "referrerHost",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "sessionStartedAt",
  "renderedAt",
  "startedAt",
  "payload",
  "metadata"
]);

function attributionMetadata(source: FormData | Record<string, unknown>) {
  const metadata: Record<string, string | number | boolean> = {};
  const explicitMetadata = getValue(source, "metadata");

  if (isRecord(explicitMetadata)) {
    for (const [key, value] of Object.entries(explicitMetadata)) {
      if (isMetadataValue(value)) metadata[key] = value;
    }
  }

  for (const key of ["landingPath", "referrerHost", "utmSource", "utmMedium", "utmCampaign"]) {
    const value = stringValue(getValue(source, key));
    if (value) metadata[key] = value;
  }

  const sessionId = stringValue(getValue(source, "sessionId"));
  if (sessionId) metadata.sessionId = sessionId;
  const sessionStartedAt = numberValue(getValue(source, "sessionStartedAt"));
  if (Number.isFinite(sessionStartedAt) && sessionStartedAt > 0) metadata.sessionStartedAt = sessionStartedAt;
  return sanitizeAnalyticsMetadata(metadata) ?? {};
}

function getValue(source: FormData | Record<string, unknown>, key: string) {
  return source instanceof FormData ? source.get(key) : source[key];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function identifierValue(value: unknown) {
  const text = stringValue(value).trim();
  return text ? text.slice(0, 120) : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formEntryValue(value: FormDataEntryValue) {
  return typeof value === "string" ? value : { name: value.name, size: value.size, type: value.type };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMetadataValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function stringMetadata(metadata: Record<string, string | number | boolean>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}
