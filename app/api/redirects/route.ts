import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { platformOperationsRepository, validateSiteRedirectInput } from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("upsert"),
    siteId: z.string().min(1),
    sourcePath: z.string().min(1).max(512),
    destinationPath: z.string().min(1).max(512)
  }).strict(),
  z.object({
    action: z.literal("set_status"),
    siteId: z.string().min(1),
    redirectId: z.string().min(1),
    status: z.enum(["active", "inactive"])
  }).strict()
]);

export async function GET(request: Request) {
  const limit = rateLimit(request, { bucket: "site_redirect_read", limit: 60, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const siteId = new URL(request.url).searchParams.get("siteId")?.trim() ?? "";
  if (!siteId) return applyRateLimitHeaders(NextResponse.json({ error: "siteId is required" }, { status: 400 }), limit);
  const unauthorized = await requireAdminOrSiteOwner(request, siteId);
  if (unauthorized) return applyRateLimitHeaders(unauthorized, limit);
  return applyRateLimitHeaders(NextResponse.json({ redirects: await platformOperationsRepository.listRedirects(siteId) }), limit);
}

export async function POST(request: Request) {
  const limit = rateLimit(request, { bucket: "site_redirect_write", limit: 30, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return applyRateLimitHeaders(NextResponse.json({ error: "Invalid redirect request", issues: parsed.error.issues }, { status: 400 }), limit);
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return applyRateLimitHeaders(unauthorized, limit);

  try {
    if (parsed.data.action === "set_status") {
      const existing = await platformOperationsRepository.getRedirectById(parsed.data.redirectId);
      if (!existing || existing.siteId !== parsed.data.siteId) {
        return applyRateLimitHeaders(NextResponse.json({ error: "Redirect not found" }, { status: 404 }), limit);
      }
      if (parsed.data.status === "active") {
        await validateAgainstPublishedSite(existing);
      }
      const redirect = await platformOperationsRepository.setRedirectStatus({ redirectId: existing.id, status: parsed.data.status });
      return applyRateLimitHeaders(NextResponse.json({ ok: true, redirect }), limit);
    }

    const validated = await validateAgainstPublishedSite(parsed.data);
    const redirect = await platformOperationsRepository.upsertRedirect(validated);
    return applyRateLimitHeaders(NextResponse.json({ ok: true, redirect }), limit);
  } catch (error) {
    return applyRateLimitHeaders(NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }), limit);
  }
}

async function validateAgainstPublishedSite(input: { siteId: string; sourcePath: string; destinationPath: string }) {
  const site = await sitePlatformRepository.getSite(input.siteId);
  if (!site?.publishedVersionId || site.status !== "active") throw new Error("Redirects require an active published site.");
  const version = await sitePlatformRepository.getSiteVersion(site.publishedVersionId);
  const artifact = version ? await sitePlatformRepository.getBuildArtifact(version.artifactId) : undefined;
  if (!version || version.status !== "published" || !artifact || artifact.qa.hardGate !== "passed" || artifact.artifactHash !== version.artifactHash) {
    throw new Error("The published site artifact is unavailable.");
  }
  return validateSiteRedirectInput(input, artifact.routes.map((route) => route.path));
}
