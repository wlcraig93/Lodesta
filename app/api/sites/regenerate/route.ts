import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

export const runtime = "nodejs";

const schema = z.object({ siteId: z.string().trim().min(1) });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid site regeneration request", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;
  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const sourceUrl = bundle.presenceAssessment.sourceUrl;
  if (!sourceUrl) {
    return NextResponse.json({ error: "This site has no retained source URL for regeneration." }, { status: 409 });
  }
  const job = await repository.enqueueJob("generate_site", {
    url: sourceUrl,
    intendedSiteId: bundle.businessProfile.siteId,
    metadata: {
      entrypoint: "/api/sites/regenerate",
      reason: "explicit managed-site structural regeneration",
      rendererVersion: "layout-v3"
    }
  });
  return NextResponse.json({
    ok: true,
    jobId: job.id,
    statusUrl: `/api/intake/jobs/${job.id}`,
    message: "A replacement candidate is queued for operator review. The current managed version remains unchanged."
  }, { status: 202 });
}
