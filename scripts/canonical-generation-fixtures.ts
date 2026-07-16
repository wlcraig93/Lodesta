import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  BusinessProfile,
  FieldProvenance,
  SiteAsset,
  SiteBundle,
  SiteVersionV3
} from "../lib/models";
import { summarizeCrawlHtml } from "../lib/crawler";
import { composeEvidenceLedger, type EvidenceLedger, type EvidenceProposal } from "../lib/evidence-ledger";
import { buildGenerationPlan } from "../lib/vertical-packs";
import { createFixtureSiteCopy } from "../lib/site-copy";
import { compileSite } from "../lib/site-compiler";
import type { GenerationPlan, ShippingDesignSystemId, SiteCopy } from "../lib/generation-contracts";
import { slugify } from "../lib/slug";
import { canonicalBusinessHours, canonicalBusinessServices } from "../lib/business-fact-normalization";

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
  assets: SiteAsset[];
  evidence: EvidenceLedger;
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
  const crawl = { pageSummaries: [page] } as Parameters<typeof composeEvidenceLedger>[0]["crawl"];
  const evidence = composeEvidenceLedger({
    crawl,
    proposals: definition.evidenceProposals.map((proposal) => ({ ...proposal, sourceUrl: definition.sourceUrl })),
    createdAt: fixtureTimestamp
  });
  const business = businessFromFixture(definition.id, definition.sourceUrl, page);
  const assets = await assetsFromFixture(
    business.siteId,
    page,
    html,
    definition.expectedDesignSystem === "precision_shop_editorial",
    definition.heroImagePath
  );
  const plan = buildGenerationPlan({ business, evidence, assets, createdAt: fixtureTimestamp });
  const copy = createFixtureSiteCopy(plan, business);
  const version = compileSite({ business, plan, copy, evidence, assets, createdAt: fixtureTimestamp });
  const bundle = fixtureBundle(business, version, assets, definition.sourceUrl);
  return { definition, business, assets, evidence, plan, copy, version, bundle };
}

function businessFromFixture(
  id: string,
  sourceUrl: string,
  page: ReturnType<typeof summarizeCrawlHtml>
): BusinessProfile {
  const facts = page.extractedFacts;
  const name = facts.name ?? page.title?.split("|")[0]?.trim() ?? id;
  const siteId = `site_fixture_${slugify(id)}`;
  const provenance = (_field: string): FieldProvenance => ({
    source: "website",
    sourceUrl,
    confidence: 0.9,
    verified: false,
    observedAt: fixtureTimestamp
  });
  const extractedServices = canonicalBusinessServices(facts.services);
  const services = extractedServices.length
    ? extractedServices
    : page.mainText?.match(/windshield/i)
      ? ["Windshield Repair", "Window Replacement"]
      : ["Auto Body Repair"];
  return {
    id: `bp_${slugify(id)}`,
    siteId,
    name,
    vertical: "auto_body",
    categories: facts.categories.length ? facts.categories : ["Auto Body Shop"],
    description: facts.description ?? page.metaDescription,
    phone: facts.phone,
    email: facts.email,
    address: facts.address,
    geo: facts.geo,
    hours: Object.fromEntries(canonicalBusinessHours(facts.hours).map(({ label, value }) => [label, value])),
    services,
    serviceHighlights: facts.serviceHighlights ?? [],
    serviceAreas: facts.serviceAreas.length ? facts.serviceAreas : facts.address?.city ? [facts.address.city] : [],
    socialLinks: facts.socialLinks,
    bookingLinks: facts.bookingLinks,
    orderingLinks: facts.orderingLinks,
    photos: [],
    pressLinks: facts.pressLinks,
    reviewsSummary: facts.reviewsSummary,
    provenance: {
      name: provenance("name"),
      ...(facts.phone ? { phone: provenance("phone") } : {}),
      ...(facts.address ? { address: provenance("address") } : {}),
      services: provenance("services")
    }
  };
}

async function assetsFromFixture(
  siteId: string,
  page: ReturnType<typeof summarizeCrawlHtml>,
  html: string,
  allowHero: boolean,
  heroImagePath?: string
): Promise<SiteAsset[]> {
  if (!allowHero) return [];
  const retained = page.assetReferences.filter((asset) => asset.kind === "image").slice(0, 1);
  const embeddedUrl = html.match(/<img[^>]+src=(["'])(.*?)\1/i)?.[2];
  const sourceAssets = heroImagePath
    ? [{
        url: `data:image/jpeg;base64,${(await readFile(path.join(process.cwd(), heroImagePath))).toString("base64")}`,
        alt: "Technician inspecting a vehicle in a clean independent repair shop"
      }]
    : retained.length
      ? retained
      : embeddedUrl
        ? [{ url: embeddedUrl, alt: "Source business repair photo" }]
        : [];
  return sourceAssets.map((asset, index) => ({
    id: `asset_fixture_${index + 1}`,
    siteId,
    kind: "photo",
    url: asset.url,
    alt: asset.alt ?? "Source business photo",
    source: "website_reference",
    rightsStatus: "preclaim_safe",
    usageScope: "preclaim_preview",
    ownerApproved: false,
    metadata: { analysisV1: { imageKind: "repair_environment", warnings: [] } },
    createdAt: fixtureTimestamp
  }));
}

function fixtureBundle(
  business: BusinessProfile,
  version: SiteVersionV3,
  assets: SiteAsset[],
  sourceUrl: string
): SiteBundle {
  return {
    businessProfile: business,
    siteModel: {
      id: business.siteId,
      slug: slugify(business.name),
      theme: version.theme ?? {
        paletteName: "canonical-fixture",
        colors: {
          background: "#ffffff",
          surface: "#ffffff",
          text: "#171717",
          muted: "#5f5f5f",
          primary: "#174c3c",
          primaryText: "#ffffff",
          accent: "#c84a2f",
          border: "#d6d6d6"
        },
        typography: { heading: "Arial, sans-serif", body: "Arial, sans-serif" },
        radius: "sm",
        density: "standard",
        mood: "utilitarian"
      },
      versions: [version],
      pinList: []
    },
    extensionModel: {
      forms: [{
        id: `form_${business.siteId}_estimate`,
        siteId: business.siteId,
        name: "Estimate request",
        fields: [
          { id: "name", label: "Name", type: "text", required: true },
          { id: "phone", label: "Phone", type: "phone", required: true },
          { id: "details", label: "Damage details", type: "textarea", required: true }
        ],
        submitLabel: "Request an estimate"
      }],
      workflows: [],
      customBlocks: []
    },
    experiments: [],
    presenceAssessment: {
      siteId: business.siteId,
      sourceUrl,
      assetInventory: assets,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}
