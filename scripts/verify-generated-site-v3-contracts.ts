import assert from "node:assert/strict";
import { compileGeneratedSiteV3Site } from "../lib/generated-site-v3-compiler";
import {
  defaultGeneratedSiteV3Mode,
  generatedSiteV3AllNewGenerationsConfirmation,
  generatedSiteV3ArtifactTypes,
  generatedSiteV3FontPairings,
  getGeneratedSiteV3Mode,
  initialSiteArtDirectionRecipesV3,
  isGeneratedSiteV3Allowed
} from "../lib/generated-site-v3";
import { maybeApplyGeneratedSiteV3 } from "../lib/generated-site-v3-pipeline";
import { localRepository } from "../lib/repository";
import { generateSite } from "../lib/site-generation-service";
import type { BusinessProfile, ExtensionModel, SiteBundle, SiteModel, Theme } from "../lib/models";

const forbiddenPublicV3Copy = [
  "template",
  "source fact",
  "source-backed",
  "generic contact form",
  "visual context",
  "business media context",
  "proof",
  "the page keeps",
  "the site keeps",
  "services listed here",
  "avoid unrelated work",
  "call path",
  "kept close",
  "text-first layout",
  "confirmed business information",
  "next step",
  "customer action path",
  "context"
];

assert.equal(defaultGeneratedSiteV3Mode, "fixture_only");
assert.equal(getGeneratedSiteV3Mode({ GENERATED_SITE_V3_MODE: "bad" } as unknown as NodeJS.ProcessEnv), "fixture_only");
assert.equal(getGeneratedSiteV3Mode({} as NodeJS.ProcessEnv), "fixture_only");
assert.equal(getGeneratedSiteV3Mode({ GENERATED_SITE_V3_MODE: "off" } as unknown as NodeJS.ProcessEnv), "off");
assert.equal(getGeneratedSiteV3Mode({ GENERATED_SITE_V3_MODE: "operator_allowlist" } as unknown as NodeJS.ProcessEnv), "operator_allowlist");

assert.equal(isGeneratedSiteV3Allowed({ mode: "off", fixture: true }), false);
assert.equal(isGeneratedSiteV3Allowed({ mode: "fixture_only", fixture: true }), true);
assert.equal(isGeneratedSiteV3Allowed({ mode: "fixture_only" }), false);
assert.equal(
  isGeneratedSiteV3Allowed({
    mode: "operator_allowlist",
    explicitOperatorRequest: true,
    sourceHost: "superb.example",
    allowlistHosts: ["superb.example"]
  }),
  true
);
assert.equal(
  isGeneratedSiteV3Allowed({
    mode: "operator_allowlist",
    explicitOperatorRequest: true,
    sourceHost: "missing.example",
    allowlistHosts: ["superb.example"]
  }),
  false
);
assert.equal(
  isGeneratedSiteV3Allowed({
    mode: "operator_allowlist",
    sourceHost: "superb.example",
    allowlistHosts: ["superb.example"]
  }),
  false
);
assert.equal(isGeneratedSiteV3Allowed({ mode: "all_new_generations", env: {} as NodeJS.ProcessEnv }), false);
assert.equal(
  isGeneratedSiteV3Allowed({
    mode: "all_new_generations",
    env: { GENERATED_SITE_V3_CONFIRM_ALL_NEW_GENERATIONS: generatedSiteV3AllNewGenerationsConfirmation } as unknown as NodeJS.ProcessEnv
  }),
  true
);

assert.deepEqual(generatedSiteV3ArtifactTypes, [
  "art_direction_decision",
  "media_asset_decision",
  "copy_evaluation_report",
  "v3_review_packet",
  "generation_cost_report"
]);

assert.ok(generatedSiteV3FontPairings.length >= 8, "V3 should define a broad universal font pool.");
assert.ok(initialSiteArtDirectionRecipesV3.length >= 5, "V3 should define launch art direction recipe candidates.");
assert.ok(
  initialSiteArtDirectionRecipesV3.every((recipe) => generatedSiteV3FontPairings.includes(recipe.fontPairingId)),
  "Every V3 art direction recipe should use an approved font pairing."
);
assert.ok(
  initialSiteArtDirectionRecipesV3.every((recipe) => recipe.headerModes.length && recipe.version === "site-art-direction-recipe-v1"),
  "Every V3 recipe should define bounded header compatibility and version."
);

const testBusiness: BusinessProfile = {
  id: "business_v3_contract",
  siteId: "site_v3_contract",
  name: "Contract Collision",
  vertical: "auto_body",
  categories: ["Auto body shop"],
  phone: "(512) 555-0100",
  address: {
    street: "100 Test Road",
    city: "Austin",
    region: "TX",
    postalCode: "78702",
    country: "US"
  },
  services: ["Collision repair", "Paint refinishing", "Dent repair", "Auto glass"],
  serviceAreas: ["Austin"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  photos: [],
  pressLinks: [],
  provenance: {}
};
const testVersion = compileGeneratedSiteV3Site({ siteId: testBusiness.siteId, business: testBusiness, createdAt: "2026-06-02T00:00:00.000Z" }).version;
assert.equal(testVersion.rendererVersion, "layout-v3", "V3 compiler should emit layout-v3.");
assert.equal(testVersion.pageComposition.pages[0]?.sections[0]?.variant, "media_masthead", "Auto-body V3 compiler should use the media masthead path with curated safe media.");
assert.ok(testVersion.mediaDecisions.every((decision) => decision.rightsStatus === "approved" && decision.mayImplyRealBusinessWork === false), "Curated V3 media decisions should be approved and non-deceptive.");
const compiledCopyCorpus = testVersion.pageComposition.pages.flatMap((page) => page.sections.flatMap((section) => collectStrings(section.props))).join("\n").toLowerCase();
for (const copy of forbiddenPublicV3Copy) {
  assert.equal(compiledCopyCorpus.includes(copy), false, `V3 compiler should not emit internal/template public copy: ${copy}`);
}

const testTheme: Theme = {
  paletteName: "test",
  colors: {
    background: "#ffffff",
    surface: "#ffffff",
    text: "#111111",
    muted: "#555555",
    primary: "#145c48",
    primaryText: "#ffffff",
    accent: "#c59d44",
    border: "#dddddd"
  },
  typography: { heading: "system", body: "system" },
  radius: "sm",
  density: "standard",
  mood: "editorial"
};
const testSite: SiteModel = {
  id: testBusiness.siteId,
  slug: "contract-collision",
  theme: testTheme,
  versions: [],
  pinList: []
};
const testExtensions: ExtensionModel = { forms: [], workflows: [], customBlocks: [] };
const testBundle: SiteBundle = {
  businessProfile: testBusiness,
  siteModel: testSite,
  extensionModel: testExtensions,
  optimizationFindings: [],
  experiments: [],
  presenceAssessment: {
    siteId: testBusiness.siteId,
    sourceUrl: "https://contract.example",
    technicalNotes: [],
    visualNotes: [],
    brandNotes: [],
    publicPresenceNotes: []
  }
};
assert.equal(maybeApplyGeneratedSiteV3({ bundle: testBundle, sourceHost: "contract.example" }).applied, false, "V3 application should fail closed by default.");
const applied = maybeApplyGeneratedSiteV3({
  bundle: testBundle,
  sourceHost: "contract.example",
  explicitOperatorRequest: true,
  now: "2026-06-02T00:00:00.000Z"
});
assert.equal(applied.applied, false, "Operator request should still respect fixture-only default mode.");
const previousMode = process.env.GENERATED_SITE_V3_MODE;
const previousAllowlist = process.env.GENERATED_SITE_V3_ALLOWLIST_HOSTS;
try {
  process.env.GENERATED_SITE_V3_MODE = "operator_allowlist";
  process.env.GENERATED_SITE_V3_ALLOWLIST_HOSTS = "contract.example";
  const allowlisted = maybeApplyGeneratedSiteV3({
    bundle: testBundle,
    sourceHost: "contract.example",
    explicitOperatorRequest: true,
    now: "2026-06-02T00:00:00.000Z"
  });
  assert.equal(allowlisted.applied, true, "Explicit allowlisted operator request should apply V3.");
  assert.equal(testBundle.siteModel.versions[0]?.rendererVersion, "layout-v3", "V3 application should replace the selected draft with layout-v3.");
} finally {
  if (previousMode === undefined) delete process.env.GENERATED_SITE_V3_MODE;
  else process.env.GENERATED_SITE_V3_MODE = previousMode;
  if (previousAllowlist === undefined) delete process.env.GENERATED_SITE_V3_ALLOWLIST_HOSTS;
  else process.env.GENERATED_SITE_V3_ALLOWLIST_HOSTS = previousAllowlist;
}

const previousModeForFullGeneration = process.env.GENERATED_SITE_V3_MODE;
const previousConfirmationForFullGeneration = process.env.GENERATED_SITE_V3_CONFIRM_ALL_NEW_GENERATIONS;
try {
  process.env.GENERATED_SITE_V3_MODE = "all_new_generations";
  process.env.GENERATED_SITE_V3_CONFIRM_ALL_NEW_GENERATIONS = generatedSiteV3AllNewGenerationsConfirmation;
  const generated = await generateSite({
    repository: localRepository,
    input: {
      prompt:
        "Create a website for Contract Collision, an auto body shop in Austin. Services: collision repair, paint refinishing, bumper repair, paintless dent repair, hail repair, auto glass. Phone: (512) 555-0100. Address: 100 Test Road, Austin, TX 78702."
    },
    source: "admin_console",
    metadata: { generatedSiteV3: true }
  });
  const generatedVersion = generated.bundle.siteModel.versions[0];
  assert.equal(generatedVersion?.rendererVersion, "layout-v3", "Canonical generateSite path should emit layout-v3 when V3 is explicitly enabled.");
  assert.equal(
    generatedVersion?.generationQa?.blockers.filter((blocker) => blocker.id !== "render_browser_unavailable").length,
    0,
    JSON.stringify(generatedVersion?.generationQa?.blockers ?? [], null, 2)
  );
  const generatedCopyCorpus =
    generatedVersion?.rendererVersion === "layout-v3"
      ? generatedVersion.pageComposition.pages.flatMap((page) => page.sections.flatMap((section) => collectStrings(section.props))).join("\n").toLowerCase()
      : "";
  for (const copy of forbiddenPublicV3Copy) {
    assert.equal(generatedCopyCorpus.includes(copy), false, `Full V3 generateSite path should not emit internal/template public copy: ${copy}`);
  }
} finally {
  if (previousModeForFullGeneration === undefined) delete process.env.GENERATED_SITE_V3_MODE;
  else process.env.GENERATED_SITE_V3_MODE = previousModeForFullGeneration;
  if (previousConfirmationForFullGeneration === undefined) delete process.env.GENERATED_SITE_V3_CONFIRM_ALL_NEW_GENERATIONS;
  else process.env.GENERATED_SITE_V3_CONFIRM_ALL_NEW_GENERATIONS = previousConfirmationForFullGeneration;
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      modeDefault: defaultGeneratedSiteV3Mode,
      artifactTypes: generatedSiteV3ArtifactTypes,
      fontPairings: generatedSiteV3FontPairings.length,
      recipes: initialSiteArtDirectionRecipesV3.map((recipe) => recipe.id)
    },
    null,
    2
  )}\n`
);

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}
