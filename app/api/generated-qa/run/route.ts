import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { inspectUrlRender } from "@/lib/render-inspection";
import { buildGeneratedSiteQaMetadata } from "@/lib/generated-site-qa";
import { applyDeterministicGeneratedSiteRepair } from "@/lib/generated-site-repair";
import { computeSiteModelHash } from "@/lib/site-version-metadata";

const generatedQaSchema = z.object({
  siteId: z.string().min(1),
  versionId: z.string().min(1),
  autoRepair: z.boolean().default(true)
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = generatedQaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid generated QA request", issues: parsed.error.issues }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const version = bundle.siteModel.versions.find((candidate) => candidate.id === parsed.data.versionId);
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  const firstRun = await inspectAndPersist({
    request,
    bundle,
    version,
    qaRunId: `generated_qa_${crypto.randomUUID().replace(/-/g, "")}`
  });

  if (
    parsed.data.autoRepair &&
    firstRun.version.generationQa?.blockers.length &&
    firstRun.version.status === "draft" &&
    !firstRun.version.ownerTouched &&
    !firstRun.version.ownerApprovedAt &&
    firstRun.version.generationQa.siteModelHash === computeSiteModelHash(bundle, firstRun.version)
  ) {
    const repairedVersion = structuredClone(firstRun.version);
    const repair = applyDeterministicGeneratedSiteRepair({
      bundle,
      version: repairedVersion,
      blockers: firstRun.version.generationQa.blockers
    });
    if (repair.applied) {
      await repository.saveSiteVersion({ siteId: parsed.data.siteId, version: repairedVersion });
      const refreshedBundle = await repository.getSiteBundle(parsed.data.siteId);
      const refreshedVersion = refreshedBundle?.siteModel.versions.find((candidate) => candidate.id === parsed.data.versionId);
      if (refreshedBundle && refreshedVersion) {
        const secondRun = await inspectAndPersist({
          request,
          bundle: refreshedBundle,
          version: refreshedVersion,
          qaRunId: `generated_qa_${crypto.randomUUID().replace(/-/g, "")}`,
          repair
        });
        return NextResponse.json({
          qa: secondRun.version.generationQa,
          repaired: true,
          previewUrl: secondRun.previewUrl
        });
      }
    }
  }

  return NextResponse.json({
    qa: firstRun.version.generationQa,
    repaired: false,
    previewUrl: firstRun.previewUrl
  });
}

async function inspectAndPersist(input: {
  request: Request;
  bundle: NonNullable<Awaited<ReturnType<typeof repository.getSiteBundle>>>;
  version: NonNullable<Awaited<ReturnType<typeof repository.getSiteBundle>>>["siteModel"]["versions"][number];
  qaRunId: string;
  repair?: NonNullable<NonNullable<NonNullable<Awaited<ReturnType<typeof repository.getSiteBundle>>>["siteModel"]["versions"][number]["generationQa"]>["repair"]>;
}) {
  const previewToken = await findOrCreatePreviewToken(input.bundle.businessProfile.siteId, input.version.id);
  if (!previewToken) throw new Error("Unable to create version-bound preview token.");
  const previewUrl = `${appOrigin(input.request)}/preview/${previewToken.token}?artifact=site&chrome=none`;
  const siteModelHash = computeSiteModelHash(input.bundle, input.version);
  const inspection = await inspectUrlRender({
    url: previewUrl,
    target: "generated_site",
    siteId: input.bundle.businessProfile.siteId,
    versionId: input.version.id,
    siteModelHash,
    qaRunId: input.qaRunId,
    captureScreenshots: true
  });
  const nextVersion = structuredClone(input.version);
  nextVersion.generationQa = buildGeneratedSiteQaMetadata({
    bundle: input.bundle,
    version: nextVersion,
    inspection,
    qaRunId: input.qaRunId,
    repair: input.repair
  });
  await repository.saveSiteVersion({ siteId: input.bundle.businessProfile.siteId, version: nextVersion });
  return { version: nextVersion, previewUrl };
}

async function findOrCreatePreviewToken(siteId: string, versionId: string) {
  const existing = (await repository.listPreviewTokens(siteId)).find((token) => token.versionId === versionId);
  if (existing) return existing;
  return repository.createPreviewToken({
    siteId,
    versionId,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
  });
}

function appOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}
