import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  BusinessProfile,
  BusinessUnderstandingV2,
  SiteAsset,
  SiteBundle,
  SiteVersionV3
} from "../lib/models";
import type { FactObservationV1, GenerationInputSnapshotV1, ResolvedAssetV1, SourceSnapshotV1 } from "../lib/control-plane-contracts";
import type { CrawlAssessment } from "../lib/crawler";
import { summarizeCrawlHtml } from "../lib/crawler";
import { composeGenerationEvidenceManifestV1, type GenerationEvidenceManifestV1, type EvidenceProposal } from "../lib/generation-evidence-manifest";
import { buildGenerationPlan } from "../lib/vertical-packs";
import { createFixtureSiteCopy } from "../lib/site-copy";
import { compileSite } from "../lib/site-compiler";
import type { GenerationPlan, ShippingDesignSystemId, SiteCopy } from "../lib/generation-contracts";
import { slugify } from "../lib/slug";
import { renderProfileFromSnapshot, siteRenderEnvelopeFromSnapshot } from "../lib/site-render-envelope";
import { createSiteBundleFromInput } from "../lib/intake";
import { generationSnapshotFromIntakeBundle, type CanonicalGenerationInputV1 } from "../lib/intake-generation-snapshot";
import { measureImageDimensions } from "../lib/image-dimensions";

export type CanonicalFixtureDefinition = {
  id: string;
  sourceUrl: string;
  htmlPath: string;
  heroImagePath?: string;
  profile: string;
  expectedDesignSystem: ShippingDesignSystemId;
  evidenceProposals: Array<Omit<EvidenceProposal, "sourceUrl">>;
};

type Manifest = {
  schemaVersion: "generation-fixture-manifest-v1";
  fixtures: CanonicalFixtureDefinition[];
};

export type CanonicalFixtureBuild = {
  definition: CanonicalFixtureDefinition;
  business: BusinessProfile;
  snapshot: GenerationInputSnapshotV1;
  canonicalInput: CanonicalGenerationInputV1;
  sourceSnapshots: SourceSnapshotV1[];
  observations: FactObservationV1[];
  assets: ResolvedAssetV1[];
  evidence: GenerationEvidenceManifestV1;
  plan: GenerationPlan;
  copy: SiteCopy;
  version: SiteVersionV3;
  bundle: SiteBundle;
};

const fixtureTimestamp = "2026-07-16T00:00:00.000Z";

export async function loadCanonicalFixtureDefinitions() {
  const manifestPath = path.join(process.cwd(), "fixtures/generation-pipeline/four-fixture-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  if (manifest.schemaVersion !== "generation-fixture-manifest-v1" || manifest.fixtures.length !== 4) {
    throw new Error("Canonical generation verification requires exactly four v1 fixtures.");
  }
  return manifest.fixtures;
}

export async function buildCanonicalFixture(definition: CanonicalFixtureDefinition): Promise<CanonicalFixtureBuild> {
  const html = await readFile(path.join(process.cwd(), definition.htmlPath), "utf8");
  const page = summarizeCrawlHtml(html, definition.sourceUrl);
  const crawl = fixtureCrawl(definition.sourceUrl, page);
  const evidence = composeGenerationEvidenceManifestV1({
    crawl,
    proposals: definition.evidenceProposals.map((proposal) => ({ ...proposal, sourceUrl: definition.sourceUrl })),
    createdAt: fixtureTimestamp
  });
  const understanding = fixtureUnderstanding(definition, crawl);
  const intakeBundle = createSiteBundleFromInput({
    url: definition.sourceUrl,
    identity: {
      siteId: `site_fixture_${slugify(definition.id)}`,
      slug: slugify(definition.id),
      businessProfileId: `bp_fixture_${slugify(definition.id)}`
    },
    crawl,
    understanding,
    createdAt: fixtureTimestamp
  });
  intakeBundle.presenceAssessment.evidenceManifest = evidence;
  const retainedAssets = await assetsFromFixture(
    intakeBundle.businessProfile.siteId,
    definition.expectedDesignSystem === "precision_shop_editorial",
    definition.heroImagePath
  );
  const canonicalInput = generationSnapshotFromIntakeBundle({
    bundle: intakeBundle,
    assets: retainedAssets,
    crawl,
    eligibilityMode: "public",
    createdAt: fixtureTimestamp
  });
  const snapshot = canonicalInput.snapshot;
  const assets = snapshot.assets;
  const plan = buildGenerationPlan({ snapshot, evidence, createdAt: fixtureTimestamp });
  const copy = createFixtureSiteCopy(plan, snapshot, fixtureTimestamp);
  const version = compileSite({
    snapshot,
    plan,
    copy,
    createdAt: fixtureTimestamp,
    versionId: `version_fixture_${slugify(definition.id)}_v1`
  });
  const bundle = fixtureBundle(snapshot, version, plan, copy, definition.sourceUrl);
  const business = renderProfileFromSnapshot(snapshot.business);
  return {
    definition,
    business,
    snapshot,
    canonicalInput,
    sourceSnapshots: canonicalInput.sourceSnapshots,
    observations: canonicalInput.observations,
    assets,
    evidence,
    plan,
    copy,
    version,
    bundle
  };
}

export function bakeoffInputArtifact(fixture: CanonicalFixtureBuild) {
  return {
    schemaVersion: "generation-bakeoff-input-v1" as const,
    fixture: {
      id: fixture.definition.id,
      profile: fixture.definition.profile,
      sourceUrl: fixture.definition.sourceUrl
    },
    sourceSnapshots: fixture.sourceSnapshots,
    observations: fixture.observations,
    generationInputSnapshot: fixture.snapshot
  };
}

export function templatedBaselineArtifact(fixture: CanonicalFixtureBuild) {
  return {
    schemaVersion: "templated-generation-baseline-v1" as const,
    fixtureId: fixture.definition.id,
    generator: "lodesta-canonical-templated-v1" as const,
    inputSnapshotId: fixture.snapshot.id,
    inputHash: fixture.snapshot.inputHash,
    output: {
      plan: fixture.plan,
      copy: fixture.copy,
      version: fixture.version
    },
    trace: {
      schemaVersion: "bakeoff-templated-trace-v1" as const,
      stages: ["vertical_pack", "plan", "fixture_copy", "compile"] as const,
      counts: { plans: 1, copies: 1, compiles: 1, gates: 0, judges: 0 }
    }
  };
}

function fixtureCrawl(sourceUrl: string, page: ReturnType<typeof summarizeCrawlHtml>): CrawlAssessment {
  return {
    url: sourceUrl,
    fetched: true,
    status: 200,
    finalUrl: sourceUrl,
    title: page.title,
    metaDescription: page.metaDescription,
    canonical: page.canonical,
    hasViewportMeta: page.hasViewportMeta,
    hasLocalBusinessSchema: page.hasLocalBusinessSchema,
    hasTelLink: page.hasTelLink,
    robotsFound: true,
    sitemapFound: true,
    formCount: page.formCount,
    imageCount: page.imageCount,
    imagesWithoutAlt: page.imagesWithoutAlt,
    internalLinkCount: page.internalLinkCount,
    externalLinkCount: page.externalLinkCount,
    jsonLdTypes: page.jsonLdTypes,
    extractedFacts: structuredClone(page.extractedFacts),
    formReferences: structuredClone(page.formReferences),
    linkReferences: structuredClone(page.linkReferences),
    assetReferences: structuredClone(page.assetReferences),
    sampledInternalPages: [],
    pageSummaries: [page],
    score: { overall: 0, max: 0, percent: 0, grade: "needs_work", checks: [] },
    findings: []
  };
}

function fixtureUnderstanding(definition: CanonicalFixtureDefinition, crawl: CrawlAssessment): BusinessUnderstandingV2 {
  return {
    version: "business-understanding-v2",
    source: "deterministic_fallback",
    vertical: "auto_body",
    verticalConfidence: 1,
    detectedSubverticals: [],
    cleanedServices: crawl.extractedFacts.services.map((service) => ({
      name: service,
      sourceText: service,
      confidence: 0.9
    })),
    hours: Object.entries(crawl.extractedFacts.hours ?? {}).map(([label, value]) => ({ label, value })),
    primaryConversionGoal: "form_first",
    urgentServiceSignals: [],
    brandExpression: {
      version: "brand-expression-v1",
      mood: "technical",
      fontPosture: "utility",
      voiceRegister: "plainspoken",
      paletteSeed: { strategy: "neutral" },
      rationale: "Deterministic bakeoff fixture expression."
    },
    evidenceProposals: definition.evidenceProposals.map((proposal) => ({ ...proposal, sourceUrl: definition.sourceUrl })),
    factConfidence: [
      { field: "name", confidence: 0.9, sourceBacked: true },
      { field: "services", confidence: 0.9, sourceBacked: true }
    ],
    notes: ["Deterministic bakeoff fixture interpretation."]
  };
}

async function assetsFromFixture(
  siteId: string,
  allowHero: boolean,
  heroImagePath?: string
): Promise<SiteAsset[]> {
  if (!allowHero || !heroImagePath) return [];
  const bytes = await readFile(path.join(process.cwd(), heroImagePath));
  const mimeType = heroImagePath.endsWith(".png") ? "image/png" as const
    : heroImagePath.endsWith(".webp") ? "image/webp" as const
      : "image/jpeg" as const;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const dimensions = measureImageDimensions(bytes, mimeType);
  const assetId = `asset_fixture_${slugify(siteId)}_hero`;
  return [{
    id: assetId,
    siteId,
    kind: "photo",
    url: `/${heroImagePath.replace(/^public\//, "")}`,
    alt: "Technician inspecting a vehicle in a clean independent repair shop",
    source: "website_reference",
    rightsStatus: "reference_only",
    usageScope: "preclaim_preview",
    ownerApproved: false,
    metadata: {
      contentHash,
      storagePath: heroImagePath,
      mimeType,
      bytes: bytes.byteLength,
      ...(dimensions ?? {}),
      analysisV1: { imageKind: "repair_environment", warnings: [] }
    },
    createdAt: fixtureTimestamp
  }];
}

function fixtureBundle(
  snapshot: GenerationInputSnapshotV1,
  version: SiteVersionV3,
  plan: GenerationPlan,
  copy: SiteCopy,
  sourceUrl: string
): SiteBundle {
  const bundle = siteRenderEnvelopeFromSnapshot({ snapshot, version, plan, copy });
  bundle.presenceAssessment.sourceUrl = sourceUrl;
  return bundle;
}
