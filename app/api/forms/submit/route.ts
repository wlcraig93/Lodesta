import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { executeFormSubmissionWorkflows } from "@/lib/workflows";

export async function POST(request: Request) {
  const parsedSubmission = await parseSubmissionRequest(request);
  if (!parsedSubmission.ok) {
    return NextResponse.json({ error: parsedSubmission.error }, { status: 400 });
  }

  const { siteId, formId, honeypot, renderedAt, payload } = parsedSubmission;

  if (!siteId || !formId) {
    return NextResponse.json({ error: "Missing siteId or formId" }, { status: 400 });
  }

  const tooFast = renderedAt > 0 && Date.now() - renderedAt < 800;
  if (honeypot || tooFast) {
    return NextResponse.json({ accepted: true, status: "ignored" });
  }

  const submission = await repository.recordFormSubmission({
    siteId,
    formId,
    pageId: parsedSubmission.pageId || "unknown",
    payload,
    metadata: parsedSubmission.metadata,
    sourceUrl: parsedSubmission.sourceUrl || request.headers.get("referer") || undefined,
    userAgent: request.headers.get("user-agent") ?? undefined
  });

  await repository.recordAnalyticsEvent({
    siteId,
    sessionId: parsedSubmission.sessionId || `form_${submission.id}`,
    pageId: submission.pageId,
    eventType: "form_submit",
    timestamp: submission.submittedAt,
    sectionId: parsedSubmission.sectionId || undefined,
    metadata: { formId, ...submission.metadata }
  });

  const bundle = await repository.getSiteBundle(siteId);
  const workflowDeliveries = bundle
    ? await executeFormSubmissionWorkflows(bundle, submission, (delivery) => repository.recordWorkflowDelivery(delivery))
    : [];

  return NextResponse.json({ ...submission, workflowDeliveries });
}

type ParsedSubmission =
  | { ok: false; error: string }
  | {
      ok: true;
      siteId: string;
      formId: string;
      pageId: string;
      sectionId?: string;
      sessionId?: string;
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
      formId: stringValue(body.formId),
      pageId: stringValue(body.pageId),
      sectionId: stringValue(body.sectionId) || undefined,
      sessionId: stringValue(body.sessionId) || undefined,
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
      formId: stringValue(formData.get("formId")),
      pageId: stringValue(formData.get("pageId")),
      sectionId: stringValue(formData.get("sectionId")) || undefined,
      sessionId: stringValue(formData.get("sessionId")) || undefined,
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
  "formId",
  "pageId",
  "sectionId",
  "sessionId",
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
  return metadata;
}

function getValue(source: FormData | Record<string, unknown>, key: string) {
  return source instanceof FormData ? source.get(key) : source[key];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
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
