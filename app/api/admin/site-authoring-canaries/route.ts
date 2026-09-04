import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/security";
import { sitePlatformRepository } from "@/packages/platform-data";
import {
  retainedCanarySourceIsAvailable,
  siteAuthoringWorkflow
} from "@/packages/site-platform/workflow";
import { normalizeBootstrapSourceUrl } from "@/packages/site-platform/source-url";

export const runtime = "nodejs";
export const maxDuration = 300;

const canarySchema = z.object({
  url: z.string().trim().min(1).max(2048),
  idempotencyKey: z.string().trim().min(8).max(160),
  reportingTimezone: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  model: z.enum(["luna", "terra", "sol"])
}).strict();

const preferredRetainedSiteIds = new Map([
  [normalizeBootstrapSourceUrl("https://kindpest.com/"), "site_00193653a5ce4a81f6cc201ccac82120"],
  [normalizeBootstrapSourceUrl("https://surgepest.com/"), "site_48e5ac5685074d275410f23689567c81"]
]);

const lunaCanaryMaxCostUsd = 0.50;

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  const parsed = canarySchema.safeParse(body);
  if (!parsed.success || !validTimezone(parsed.data.reportingTimezone)) {
    return NextResponse.json({ error: "Enter a valid private canary request." }, { status: 400 });
  }
  try {
    const normalizedSource = normalizeBootstrapSourceUrl(parsed.data.url);
    const preferredSiteId = preferredRetainedSiteIds.get(normalizedSource);
    const exactSites = (await sitePlatformRepository.listSites()).filter((site) =>
      site.ownerUserId && site.normalizedSource === normalizedSource && !site.id.includes("_visual_")
    );
    const retainedSourceSite = preferredSiteId
      ? exactSites.find((site) => site.id === preferredSiteId)
      : exactSites.find((site) => site.currentPublicBuildInputId);
    if (!retainedSourceSite?.ownerUserId) {
      return NextResponse.json({ error: "An owned retained site with this exact source URL is required for a private canary." }, { status: 409 });
    }
    const retainedInput = retainedSourceSite.currentPublicBuildInputId
      ? await sitePlatformRepository.getPublicBuildInput(retainedSourceSite.currentPublicBuildInputId)
      : undefined;
    if (!retainedInput?.sourceSnapshotIds.length) {
      return NextResponse.json({ error: "The retained canary source is incomplete. Capture it once before running a canary." }, { status: 409 });
    }
    const retainedSourceAvailability = await Promise.all(retainedInput.sourceSnapshotIds.map(async (sourceId) => {
      const [snapshot, pages] = await Promise.all([
        sitePlatformRepository.getSourceSnapshot(sourceId),
        sitePlatformRepository.listSourceSnapshotPages(sourceId)
      ]);
      return retainedCanarySourceIsAvailable(snapshot, pages.length);
    }));
    if (retainedSourceAvailability.some((available) => !available)) {
      return NextResponse.json({ error: "The retained canary source is incomplete. Capture it once before running a canary." }, { status: 409 });
    }
    const modelId = `gpt-5.6-${parsed.data.model}`;
    const maxCostUsd = parsed.data.model === "sol"
      ? 5
      : parsed.data.model === "terra"
        ? 2
        : lunaCanaryMaxCostUsd;
    const result = await siteAuthoringWorkflow.bootstrapFromRetainedSite({
      templateSiteId: retainedSourceSite.id,
      idempotencyKey: parsed.data.idempotencyKey,
      slug: parsed.data.slug,
      reportingTimezone: parsed.data.reportingTimezone,
      modelRoute: { apiProvider: "openai", modelId },
      maxCostUsd
    });
    return NextResponse.json({
      siteId: result.site.id,
      runId: result.run.id,
      retainedTemplateSiteId: retainedSourceSite.id,
      sourceSnapshotIds: result.sourceSnapshotIds,
      sourceAcquisition: "retained-mirror-reference",
      generator: "canonical",
      modelId: result.run.modelId ?? null,
      authoringProfileId: result.run.authoringProfileId ?? null,
      workspacePath: `/workspace/${result.site.slug}/editor`,
      adminPath: `/admin/sites/${result.site.slug}`
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "site_authoring_canary_failed" }, { status: 422 });
  }
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
