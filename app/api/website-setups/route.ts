import { after, NextResponse } from "next/server";
import { z } from "zod";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { sha256, stableJson } from "@/packages/business-data";
import { processWebsiteSetupAndRun } from "@/lib/website-setup-jobs";
import { getWebsiteSetupView, validateWebsiteSetupSource } from "@/lib/website-setups";
import { sitePlatformRepository } from "@/packages/platform-data";
import {
  ConcurrentProjectLimitError,
  IdempotencyKeyConflictError,
  platformOperationsRepository
} from "@/packages/platform-operations";
import { requireWebsiteSetupUser } from "./auth";

function validTimezone(value: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}

const createSchema = z.object({
  sourceUrl: z.string().trim().min(1).max(2048),
  prospectReportId: z.string().regex(/^prospect_report_[a-f0-9]{32}$/i).optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
  confirmDuplicate: z.boolean().optional(),
  reportingTimezone: z.string().min(1).max(100).refine(validTimezone, "Enter a valid IANA timezone.")
}).strict();

export async function GET(request: Request) {
  const limit = rateLimit(request, { bucket: "website_setup_read", limit: 90, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const auth = await requireWebsiteSetupUser();
  if (!auth.ok) return applyRateLimitHeaders(auth.response, limit);
  const setups = await platformOperationsRepository.listWebsiteSetupsForOwner(auth.user.id);
  return applyRateLimitHeaders(NextResponse.json({ setups: await Promise.all(setups.map(getWebsiteSetupView)) }), limit);
}

export async function POST(request: Request) {
  const limit = rateLimit(request, { bucket: "website_setup_create", limit: 12, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const auth = await requireWebsiteSetupUser();
  if (!auth.ok) return applyRateLimitHeaders(auth.response, limit);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return applyRateLimitHeaders(NextResponse.json({
      error: "Enter a valid website address.",
      issues: parsed.error.issues
    }, { status: 400 }), limit);
  }

  const source = await validateWebsiteSetupSource(parsed.data.sourceUrl);
  if (!source.ok) return applyRateLimitHeaders(NextResponse.json({ error: source.error }, { status: 400 }), limit);
  const prospectReportId = parsed.data.prospectReportId
    && await platformOperationsRepository.getProspectReport(parsed.data.prospectReportId)
    ? parsed.data.prospectReportId
    : undefined;

  const creationRequestHash = sha256(stableJson({
    normalizedSource: source.normalizedSource,
    reportingTimezone: parsed.data.reportingTimezone,
    prospectReportId
  }));
  const setups = await platformOperationsRepository.listWebsiteSetupsForOwner(auth.user.id);
  const idempotent = setups.find((setup) => setup.idempotencyKey === parsed.data.idempotencyKey);
  if (idempotent) {
    if (idempotent.creationRequestHash !== creationRequestHash) {
      return applyRateLimitHeaders(NextResponse.json({
        error: "This request key was already used for a different source.",
        code: "idempotency_key_conflict"
      }, { status: 409 }), limit);
    }
    if (idempotent.status === "queued") {
      after(async () => { await processWebsiteSetupAndRun(idempotent.id, `website_setup_request_${idempotent.id}`); });
    }
    return applyRateLimitHeaders(NextResponse.json({ view: await getWebsiteSetupView(idempotent), existing: true }), limit);
  }

  const sites = await sitePlatformRepository.getSitesByOwnerUserId(auth.user.id);

  if (!parsed.data.confirmDuplicate) {
    const sitesById = new Map(sites.map((site) => [site.id, site]));
    const projects = setups
      .filter((setup) =>
        setup.normalizedSource === source.normalizedSource
        && ["queued", "processing", "linked"].includes(setup.status)
      )
      .map((setup) => {
        const site = setup.siteId ? sitesById.get(setup.siteId) : undefined;
        return {
          id: setup.id,
          name: site?.slug.replaceAll("-", " ") ?? new URL(setup.sourceUrl).hostname,
          status: site?.publishedVersionId ? "live" : setup.status,
          href: site ? `/workspace/${site.slug}` : `/account/onboarding/${setup.id}`
        };
      });
    const representedSiteIds = new Set(projects.flatMap((project) => {
      const setup = setups.find((candidate) => candidate.id === project.id);
      return setup?.siteId ? [setup.siteId] : [];
    }));
    for (const site of sites) {
      if (site.normalizedSource !== source.normalizedSource || representedSiteIds.has(site.id)) continue;
      projects.push({
        id: site.id,
        name: site.slug.replaceAll("-", " "),
        status: site.publishedVersionId ? "live" : site.status,
        href: `/workspace/${site.slug}`
      });
    }
    if (projects.length) {
      return applyRateLimitHeaders(NextResponse.json({
        code: "duplicate_source_confirmation_required",
        projects
      }, { status: 409 }), limit);
    }
  }

  try {
    const setup = await platformOperationsRepository.createWebsiteSetup({
      ownerUserId: auth.user.id,
      sourceUrl: source.url,
      normalizedSource: source.normalizedSource,
      prospectReportId,
      idempotencyKey: parsed.data.idempotencyKey,
      creationRequestHash,
      reportingTimezone: parsed.data.reportingTimezone
    });
    after(async () => { await processWebsiteSetupAndRun(setup.id, `website_setup_request_${setup.id}`); });
    return applyRateLimitHeaders(NextResponse.json({ view: await getWebsiteSetupView(setup), existing: false }, { status: 202 }), limit);
  } catch (error) {
    if (error instanceof IdempotencyKeyConflictError) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 409 }), limit);
    }
    if (error instanceof ConcurrentProjectLimitError) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 429 }), limit);
    }
    throw error;
  }
}
