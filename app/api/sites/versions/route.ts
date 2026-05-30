import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { runSiteQa } from "@/lib/qa";
import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";
import { claimGateForBundle } from "@/lib/site-publication";

const versionActionSchema = z.object({
  siteId: z.string().min(1),
  versionId: z.string().min(1),
  action: z.enum(["publish", "restore_draft"]).default("publish"),
  confirmed: z.boolean().default(false)
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const unauthorized = siteId ? await requireAdminOrSiteOwner(request, siteId) : await requireAdmin(request);
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
  const parsed = versionActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid version action request", issues: parsed.error.issues }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;
  if (parsed.data.action === "restore_draft") {
    const result = await repository.restoreVersionToDraft(parsed.data);
    if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
    const qa = runSiteQa(result.bundle, { versionId: result.draftVersionId });
    return NextResponse.json({ ...result, qa });
  }

  if (!parsed.data.confirmed) {
    return NextResponse.json(
      { error: "Publish confirmation required.", confirmationRequired: true },
      { status: 409 }
    );
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const claimGate = claimGateForBundle(bundle, await repository.listClaims(parsed.data.siteId));
  if (!claimGate.ok) {
    const verificationRequired = claimGate.code === "verification_required";
    return NextResponse.json(
      {
        error: claimGate.reason,
        claimGate: claimGate.code,
        paymentRequired: !verificationRequired,
        factVerificationRequired: verificationRequired,
        missingRequiredFacts: claimGate.missingFacts
      },
      { status: verificationRequired ? 409 : 402 }
    );
  }
  const qa = runSiteQa(bundle, { versionId: parsed.data.versionId });
  if (!qa.passed) {
    return NextResponse.json({ error: "Version QA failed. Fix blocking checks before publishing.", qa }, { status: 400 });
  }

  const result = await repository.publishVersion(parsed.data);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({ ...result, qa, confirmed: true });
}
