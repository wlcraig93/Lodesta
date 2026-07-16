import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSiteV3FromInput } from "../lib/intake";
import { compileGeneratedSiteV3Site } from "../lib/generated-site-v3-compiler";
import { inspectGeneratedSiteBundleRender, renderGeneratedSiteHtml } from "../lib/generated-site-render-inspection";
import { buildGeneratedSiteQaMetadata } from "../lib/generated-site-qa";
import { createOpenAiVisualQa, createUnavailableVisualQa } from "../lib/visual-qa";
import type { AssetReference, BusinessProfile, RenderInspectionResult, SiteBundle, VisualQaResult } from "../lib/models";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactRoot = join(process.cwd(), ".data", "auto-body-quality-benchmark", runId);
const reportPath = join(artifactRoot, "report.json");
const runLiveModel = process.argv.includes("--live") || process.env.LODESTA_AUTO_BODY_LIVE_QA === "1";

const fixtures = [
  ...["a", "b", "c"].map((seed) => menciaFixture(seed)),
  {
    id: "holdout_capitol_collision",
    siteId: "site_holdout_capitol_collision",
    prompt:
      "Build a website for Capitol Collision Works, an auto body shop in Sacramento offering collision repair, bumper repair, paint refinishing, frame measuring, and insurance claim support. phone: 916-555-0188. address: 420 R Street, Sacramento, CA 95811.",
    name: "Capitol Collision Works",
    categories: ["Auto body shop", "Collision repair"],
    description:
      "Capitol Collision Works handles collision repair, bumper damage, paint refinishing, frame measuring, and claim documentation for drivers around Sacramento.",
    phone: "(916) 555-0188",
    email: undefined,
    address: { street: "420 R Street", city: "Sacramento", region: "CA", postalCode: "95811", country: "US" },
    hours: {
      monday: "8:00am - 5:30pm",
      tuesday: "8:00am - 5:30pm",
      wednesday: "8:00am - 5:30pm",
      thursday: "8:00am - 5:30pm",
      friday: "8:00am - 5:30pm"
    },
    services: ["Collision repair", "Bumper repair", "Paint refinishing", "Frame measuring", "Insurance claim support"],
    serviceAreas: ["Sacramento", "West Sacramento", "East Sacramento"],
    photoCount: 5,
    colorSignals: ["#0f3840", "#d66b2a"]
  },
  {
    id: "holdout_northstar_dent_glass",
    siteId: "site_holdout_northstar_dent_glass",
    prompt:
      "Build a website for Northstar Dent & Glass, an auto body shop in Madison offering paintless dent repair, hail damage repair, auto glass replacement, and scratch repair. phone: 608-555-0142. address: 1150 Atlas Avenue, Madison, WI 53714.",
    name: "Northstar Dent & Glass",
    categories: ["Auto body shop", "Dent repair"],
    description:
      "Northstar Dent & Glass focuses on dent, hail, glass, and scratch repair with a photo-first intake so the shop can route each vehicle to the right next step.",
    phone: "(608) 555-0142",
    email: undefined,
    address: { street: "1150 Atlas Avenue", city: "Madison", region: "WI", postalCode: "53714", country: "US" },
    hours: {
      monday: "8:30am - 5:00pm",
      tuesday: "8:30am - 5:00pm",
      wednesday: "8:30am - 5:00pm",
      thursday: "8:30am - 5:00pm",
      friday: "8:30am - 4:00pm",
      saturday: "By appointment"
    },
    services: ["Paintless dent repair", "Hail damage repair", "Auto glass replacement", "Scratch repair"],
    serviceAreas: ["Madison", "Middleton", "Sun Prairie"],
    photoCount: 4,
    colorSignals: ["#14213d", "#fca311"]
  }
] satisfies AutoBodyFixture[];

await mkdir(artifactRoot, { recursive: true });

const results: AutoBodyBenchmarkResult[] = [];

for (const fixture of fixtures) {
  const result = await inspectFixture(fixture);
  results.push(result);
  process.stdout.write(
    `${JSON.stringify({
      id: result.id,
      readiness: result.readiness,
      renderFailures: result.renderFailures.length,
      sectionFailures: result.sectionFailures.length,
      copyIssues: result.copyIssues.length,
      visualVerdict: result.visualQa.verdict,
      craftScore: result.visualQa.craftScore,
      adapter: result.adapter,
      unavailableReason: result.unavailableReason,
      blockers: result.blockers
    })}\n`
  );
}

const report = {
  runId,
  runLiveModel,
  artifactRoot,
  readinessCounts: results.reduce<Record<string, number>>((counts, result) => {
    counts[result.readiness] = (counts[result.readiness] ?? 0) + 1;
    return counts;
  }, {}),
  results
};
await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
process.stdout.write(`${JSON.stringify({ reportPath, readinessCounts: report.readinessCounts })}\n`);

const hardFailures = results.flatMap((result) => [
  ...result.blockers.map((issue) => `${result.id}: blocker ${issue}`),
  ...result.renderFailures.map((issue) => `${result.id}: render ${issue}`),
  ...result.sectionFailures.map((issue) => `${result.id}: section ${issue}`),
  ...result.copyIssues.map((issue) => `${result.id}: copy ${issue}`)
]);
if (runLiveModel) {
  hardFailures.push(
    ...results.flatMap((result) => visualJudgmentFailures(result).map((issue) => `${result.id}: visual ${issue}`))
  );
}
assert.equal(hardFailures.length, 0, `Auto-body quality benchmark failures:\n${hardFailures.join("\n")}`);

function menciaFixture(seed: string): AutoBodyFixture {
  return {
    id: `mencia_${seed}`,
    siteId: `site_mencia_auto_body_${seed}`,
    prompt:
      "Build a website for Mencia Auto Body & Paint, an auto body shop in Austin offering collision repair, professional paint services, paintless dent repair, bumper repair, auto glass, insurance claim help, and self-pay repair options. phone: (512) 551-9434. address: 819 Houston St, Austin, TX 78756.",
    name: "Mencia Auto Body & Paint",
    categories: ["Auto body shop", "Collision repair", "Paint services"],
    description:
      "Mencia Auto Body & Paint is a family-owned Austin shop founded in 2018, handling high-quality auto body repairs, professional paint services, insurance-claim questions, and self-pay repair options.",
    phone: "(512) 551-9434",
    email: "support@menciaautoshop.com",
    address: { street: "819 Houston St.", city: "Austin", region: "TX", postalCode: "78756", country: "US" },
    hours: {
      monday: "9:00am - 6:00pm",
      tuesday: "9:00am - 6:00pm",
      wednesday: "9:00am - 6:00pm",
      thursday: "9:00am - 6:00pm",
      friday: "9:00am - 6:00pm",
      saturday: "10:00am - 2:00pm"
    },
    services: ["Collision repair", "Professional paint services", "Paintless dent repair", "Bumper repair", "Auto glass"],
    serviceAreas: ["Austin", "Central Austin", "North Austin"],
    photoCount: 6,
    colorSignals: ["#181818", "#d33a2c"]
  };
}

async function inspectFixture(fixture: AutoBodyFixture): Promise<AutoBodyBenchmarkResult> {
  const bundle = fixtureBundle(fixture);
  const { version } = compileGeneratedSiteV3Site({ bundle, createdAt: "2026-06-13T00:00:00.000Z" });
  bundle.siteModel.versions = [version];
  const qaRunId = `auto_body_quality_${fixture.id}`;
  const inspection = await inspectGeneratedSiteBundleRender({ bundle, version, qaRunId });
  const visualQa = runLiveModel
    ? await createOpenAiVisualQa({
        bundle,
        renderInspection: inspection,
        modelReview: { allowed: true, reason: "Auto-body quality benchmark live visual QA run." }
      })
    : createUnavailableVisualQa({ bundle, renderInspection: inspection });
  const qa = buildGeneratedSiteQaMetadata({ bundle, version, inspection, qaRunId, visualQa });
  const html = await renderGeneratedSiteHtml(bundle, version);
  const copyIssues = copyIssuesForHtml(html);
  return {
    id: fixture.id,
    readiness: qa.readiness,
    adapter: inspection.adapter,
    unavailableReason: inspection.unavailableReason,
    blockers: qa.blockers.map((blocker) => blocker.id),
    renderFailures: inspection.findings
      .filter((finding) => finding.severity === "fail")
      .map((finding) => `${finding.id}${finding.viewport ? `.${finding.viewport}` : ""}: ${finding.evidence.slice(0, 160)}`),
    sectionFailures: sectionFailuresForInspection(inspection),
    copyIssues,
    visualQa: {
      source: visualQa.source,
      verdict: visualQa.verdict,
      craftScore: visualQa.craftScore,
      findingCount: visualQa.findings.length
    },
    screenshotCounts: {
      fullPage: inspection.screenshots.length,
      section: inspection.sectionScreenshots?.length ?? 0
    },
    templates: version.pageComposition.pages[0]?.sections.map((section) => section.variant) ?? [],
    servicePresentation: version.artDirection.sectionPresentation?.services
  };
}

function fixtureBundle(fixture: AutoBodyFixture): SiteBundle {
  const bundle = createSiteV3FromInput({ prompt: fixture.prompt, identity: { siteId: fixture.siteId } });
  const photos = fixturePhotos(fixture);
  const business: BusinessProfile = {
    ...bundle.businessProfile,
    id: `biz_${fixture.siteId}`,
    siteId: fixture.siteId,
    name: fixture.name,
    vertical: "auto_body",
    categories: fixture.categories,
    description: fixture.description,
    phone: fixture.phone,
    email: fixture.email,
    address: fixture.address,
    hours: fixture.hours,
    services: fixture.services,
    serviceHighlights: fixture.services,
    serviceAreas: fixture.serviceAreas,
    socialLinks: [],
    bookingLinks: [],
    orderingLinks: [],
    photos,
    pressLinks: [],
    provenance: bundle.businessProfile.provenance
  };
  return {
    ...bundle,
    businessProfile: business,
    locations: [
      {
        id: `loc_${fixture.siteId}_primary`,
        businessId: business.id,
        label: "Shop",
        address: fixture.address,
        serviceAreas: fixture.serviceAreas,
        phone: fixture.phone,
        email: fixture.email,
        hours: fixture.hours,
        provenance: {},
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:00.000Z"
      }
    ],
    locationBindings: [{ locationId: `loc_${fixture.siteId}_primary`, role: "primary", orderIndex: 0 }],
    presenceAssessment: {
      ...bundle.presenceAssessment,
      brandAssessment: {
        ...(bundle.presenceAssessment.brandAssessment ?? {
          id: `brand_${fixture.siteId}`,
          siteId: fixture.siteId,
          confidence: 0.85,
          cues: [],
          typographySignals: [],
          imageStyleSignals: [],
          toneSignals: [],
          notes: []
        }),
        colorSignals: fixture.colorSignals
      } as NonNullable<SiteBundle["presenceAssessment"]["brandAssessment"]>
    }
  };
}

function fixturePhotos(fixture: AutoBodyFixture): AssetReference[] {
  const urls = [
    "/generated-site-assets/auto-body/lift-bay-overview-v1.png",
    "/generated-site-assets/auto-body/finished-shop-review-v1.png",
    "/generated-site-assets/auto-body/pdr-reflection-panel-v1.png",
    "/generated-site-assets/auto-body/paint-prep-sanding-block-v1.png",
    "/generated-site-assets/auto-body/windshield-replacement-v1.png",
    "/generated-site-assets/auto-body/before-after-body-panel-v2.png"
  ];
  return urls.slice(0, fixture.photoCount).map((url, index) => ({
    id: `${fixture.id}_photo_${index + 1}`,
    url,
    alt: `${fixture.name} auto body service photo ${index + 1}`,
    source: "generated",
    rightsStatus: "preclaim_safe"
  }));
}

function sectionFailuresForInspection(inspection: RenderInspectionResult) {
  return (inspection.sectionInspections ?? []).flatMap((section) =>
    section.findings
      .filter((finding) => finding.severity === "fail")
      .map((finding) => `${section.viewport} ${section.label}: ${finding.id} (${finding.evidence})`)
  );
}

function copyIssuesForHtml(html: string) {
  const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)).map((match) => stripHtml(match[1]));
  const text = stripHtml(html);
  const issues: string[] = [];
  const genericHeadingPatterns = [
    /\bOur approach\b/i,
    /\bWhat we do\b/i,
    /\bReady to get started\b/i,
    /\bChoose the service that fits\b/i,
    /\bHow it works\b/i,
    /\bGet started\b/i,
    /\bServices\b$/i
  ];
  for (const heading of headings) {
    if (genericHeadingPatterns.some((pattern) => pattern.test(heading))) {
      issues.push(`generic heading "${heading}"`);
    }
    if (/^(Auto body shop|Collision repair|Paint services)$/i.test(heading)) {
      issues.push(`category-as-heading "${heading}"`);
    }
  }
  const forbiddenBodyPatterns = [
    /\b(template|renderer|component|section-template|v3|visual factory|placeholder)\b/i,
    /\b(local business|core service|easy next step|help visitors|ready visitors)\b/i,
    /\bcan be verified\b/i,
    /\bsite source|source-backed|conversion path|proof section\b/i
  ];
  for (const pattern of forbiddenBodyPatterns) {
    const match = text.match(pattern);
    if (match) issues.push(`forbidden copy phrase "${match[0]}"`);
  }
  return issues;
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function visualJudgmentFailures(result: AutoBodyBenchmarkResult) {
  return result.visualQa.verdict === "ship" ? [] : [`verdict was ${result.visualQa.verdict}`];
}

type AutoBodyFixture = {
  id: string;
  siteId: string;
  prompt: string;
  name: string;
  categories: string[];
  description: string;
  phone: string;
  email?: string;
  address: NonNullable<BusinessProfile["address"]>;
  hours: Record<string, string>;
  services: string[];
  serviceAreas: string[];
  photoCount: number;
  colorSignals: string[];
};

type AutoBodyBenchmarkResult = {
  id: string;
  readiness: string;
  adapter: RenderInspectionResult["adapter"];
  unavailableReason?: string;
  blockers: string[];
  renderFailures: string[];
  sectionFailures: string[];
  copyIssues: string[];
  visualQa: {
    source: VisualQaResult["source"];
    verdict: VisualQaResult["verdict"];
    craftScore?: number;
    findingCount: number;
  };
  screenshotCounts: { fullPage: number; section: number };
  templates: string[];
  servicePresentation?: string;
};
