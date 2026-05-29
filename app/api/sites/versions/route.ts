import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";

const publishVersionSchema = z.object({
  siteId: z.string().min(1),
  versionId: z.string().min(1)
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const unauthorized = siteId ? await requireAdminOrSiteOwner(request, siteId) : requireAdmin(request);
  if (unauthorized) return unauthorized;

  const bundles = siteId ? [await repository.getSiteBundle(siteId)] : await repository.listSiteBundles();
  return NextResponse.json({
    sites: bundles.filter(Boolean).map((bundle) => ({
      siteId: bundle!.businessProfile.siteId,
      slug: bundle!.siteModel.slug,
      versions: bundle!.siteModel.versions.map((version) => ({
        id: version.id,
        status: version.status,
        createdAt: version.createdAt,
        pages: version.pages.length,
        title: version.pages[0]?.seo.title ?? version.pages[0]?.title ?? "Untitled"
      }))
    }))
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = publishVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid version publish request", issues: parsed.error.issues }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const result = await repository.publishVersion(parsed.data);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json(result);
}
