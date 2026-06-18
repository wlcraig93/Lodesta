import assert from "node:assert/strict";
import { buildGenerationRepairTargets } from "../lib/generated-site-repair-targets";
import {
  applyGeneratedSiteRepairTarget,
  applyMechanicalGeneratedSiteCleanupPatches,
  orderedLiveRepairTargets,
  patchWasRejected
} from "../lib/generated-site-repair-loop";
import { applyUnresolvedRepairTargetReadinessGate } from "../lib/generated-site-readiness";
import { getVisualSectionV3, withVisualSectionV3 } from "../lib/generated-site-v3-visual-controls";
import type { BusinessProfile, SiteBundle, SiteVersionV3 } from "../lib/models";

const business: BusinessProfile = {
  id: "biz_repair_verify",
  siteId: "site_repair_verify",
  name: "Repair Verify Auto",
  vertical: "auto_body",
  categories: ["Auto body shop"],
  description: "Auto body repair verification fixture.",
  services: ["Collision repair", "Paint repair", "Dent repair"],
  serviceAreas: ["Austin"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  photos: [
    {
      id: "photo_safe",
      url: "https://cdn.example.com/photo-safe.jpg",
      alt: "Repair bay",
      source: "uploaded",
      rightsStatus: "preclaim_safe",
      analysisV1: {
        version: "asset-analysis-v1",
        source: "openai",
        model: "fixture",
        analyzedAt: "2026-06-17T00:00:00.000Z",
        imageKind: "repair_detail",
        qualityScore: 92,
        usableSlots: ["service", "gallery"],
        focalPoint: "center",
        subjectPlacement: "centered",
        recommendedCropIntent: "subject",
        cropRecommendations: {
          wide: { focalPoint: "center", cropIntent: "wide", suitability: 0.8 },
          square: { focalPoint: "center", cropIntent: "subject", suitability: 0.9 },
          portrait: { focalPoint: "center", cropIntent: "portrait", suitability: 0.6 },
          card: { focalPoint: "center", cropIntent: "subject", suitability: 0.95 }
        },
        warnings: [],
        contentTags: ["repair"],
        summary: "Fixture source-safe repair image.",
        limitations: []
      }
    }
  ],
  pressLinks: [],
  provenance: {}
};

function versionFixture(): SiteVersionV3 {
  return {
    id: "version_repair_verify",
    status: "draft",
    rendererVersion: "layout-v3",
    designSchemaVersion: "design-v3",
    createdAt: "2026-06-17T00:00:00.000Z",
    artDirection: {
      version: "site-art-direction-v3",
      recipeId: "fixture",
      fontPairingId: "editorial_serif_clean_sans",
      colorSystem: "light_editorial",
      spacingRhythm: "standard",
      headerMode: "minimal_wordmark",
      mediaTreatment: "editorial_crop",
      buttonSystem: "solid_with_quiet_secondary",
      cardTreatment: "hairline_surface",
      density: "balanced"
    },
    pageComposition: {
      id: "composition_repair_verify",
      version: "page-composition-v3",
      pages: [
        {
          id: "home",
          slug: "",
          title: "Repair Verify Auto",
          seo: { title: "Repair Verify Auto", description: "Repair Verify Auto.", canonicalPath: "/" },
          purpose: "homepage",
          sections: [
            {
              id: "services",
              family: "services.intro_grid",
              variant: "intro_grid",
              controls: {
                layout: "card_grid",
                alignment: "start",
                width: "contained",
                padding: "standard",
                background: "surface",
                mediaCrop: "center",
                density: "balanced"
              },
              props: withVisualSectionV3(
                {},
                {
                  version: "visual-section-v3",
                  templateId: "intro_grid",
                  options: {
                    background: { kind: "solid", token: "surface" },
                    headingLayout: "side_rail",
                    numberDisplay: "badge",
                    mediaAspect: "none",
                    mediaCrop: "center",
                    cardAction: "text_link"
                  },
                  slots: {
                    intro: { heading: "Services", body: "This website shows a generated section." },
                    items: {
                      items: [
                        { title: "Collision repair", body: "Generic support.", mediaUrl: "https://cdn.example.com/bad.jpg", meta: "01" },
                        { title: "Collision repair", body: "Generic support.", mediaUrl: "https://cdn.example.com/bad.jpg", meta: "02" }
                      ]
                    }
                  }
                }
              ),
              slots: [],
              responsiveRules: [],
              requiredFactKinds: [],
              optionalFactKinds: [],
              sparseBehavior: {
                minimumValidSlots: [],
                omitWhenMissingFactKinds: [],
                blockWhenMissingFactKinds: [],
                gracefulDegradation: "Fixture"
              }
            }
          ]
        }
      ]
    },
    mediaDecisions: [],
    artifactRefs: []
  };
}

function bundleFixture(): SiteBundle {
  const theme = {
    paletteName: "repair-verify",
    colors: {
      background: "#ffffff",
      surface: "#f4f5f6",
      text: "#171512",
      muted: "#5d6268",
      primary: "#17324a",
      primaryText: "#ffffff",
      accent: "#d23b2d",
      border: "#d8dde2"
    },
    typography: { heading: "system", body: "system" },
    radius: "md" as const,
    density: "standard" as const,
    mood: "editorial" as const
  };
  return {
    businessProfile: business,
    siteModel: { id: "site_model_repair_verify", slug: "repair-verify-auto", theme, versions: [versionFixture()], pinList: [] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: business.siteId,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}

async function main() {
  const targets = buildGenerationRepairTargets({
    blockers: [
      {
        id: "v3_repeated_section_rhythm",
        title: "V3 section rhythm is too repetitive",
        detail: "A layout-v3 homepage must use distinct section variants.",
        severity: "blocking"
      },
      {
        id: "unsupported_insurance_claim",
        title: "Unsupported insurance claim",
        detail: "Copy mentioned insurance without evidence.",
        severity: "blocking"
      }
    ],
    warnings: [
      {
        id: "generic_heading",
        title: "Generic heading",
        detail: "Heading says Services."
      }
    ]
  });
  assert.equal(targets.find((target) => target.findingId === "unsupported_insurance_claim")?.activation, "telemetry_only");
  assert.equal(targets.find((target) => target.findingId === "generic_heading")?.activation, "live");
  assert.equal(orderedLiveRepairTargets({ readiness: "blocked", blockers: [], warnings: [], repairTargets: targets })[0]?.target, "director_plan");
  assert.equal(
    buildGenerationRepairTargets({
      blockers: [{ id: "render.form_affordance.desktop", title: "Contact form fields have visible affordances", detail: "1 form affordance issue.", severity: "blocking" }],
      warnings: []
    })[0]?.target,
    "template_geometry",
    "Form affordance failures should route to template geometry repair."
  );
  assert.equal(
    buildGenerationRepairTargets({
      blockers: [{ id: "v3_media_suitability_reject", title: "Unsuitable proof media was rejected", detail: "text_overlay collage proof media.", severity: "blocking" }],
      warnings: []
    })[0]?.target,
    "asset_crop",
    "Unsuitable proof media should route to asset/media repair."
  );
  const failOpenGuard = applyUnresolvedRepairTargetReadinessGate({
    readiness: "ready",
    blockers: [],
    warnings: [],
    repairTargets: [
      {
        id: "repair_blocker_render_form_affordance_template_geometry",
        source: "blocker",
        findingId: "render.form_affordance.desktop",
        title: "Contact form fields have visible affordances",
        detail: "1 form affordance issue.",
        target: "template_geometry",
        activation: "live",
        priority: "high"
      }
    ],
    repair: {
      attempted: true,
      applied: false,
      mutationSummaries: [],
      unresolvedBlockerIds: [],
      unresolvedTargetIds: ["repair_blocker_render_form_affordance_template_geometry"]
    }
  });
  assert.equal(failOpenGuard.readiness, "blocked", "Unresolved high-priority live repair targets must not leave a candidate ready.");
  assert.equal(failOpenGuard.blockers.some((blocker) => blocker.id === "repair_unresolved_live_targets"), true);

  const bundle = bundleFixture();
  const version = bundle.siteModel.versions[0] as SiteVersionV3;
  const rhythmTarget = targets.find((target) => target.target === "director_plan");
  assert(rhythmTarget);
  const directorPatch = await applyGeneratedSiteRepairTarget({ bundle, version, target: rhythmTarget, pass: 1 });
  assert.equal(directorPatch?.status, "applied");
  const visualAfterDirector = getVisualSectionV3(version.pageComposition.pages[0].sections[0].props);
  assert.equal(visualAfterDirector?.templateId, "intro_grid");
  assert.equal(visualAfterDirector?.options.headingLayout, "full_width");
  assert.equal(visualAfterDirector?.options.numberDisplay, "none");

  const mechanicalPatches = applyMechanicalGeneratedSiteCleanupPatches({ bundle, version, pass: 1 });
  assert(mechanicalPatches.length >= 1);
  const visualAfterCleanup = getVisualSectionV3(version.pageComposition.pages[0].sections[0].props);
  assert(visualAfterCleanup?.templateId === "intro_grid");
  assert.equal(visualAfterCleanup.slots.items.items.length, 1);
  assert.equal(visualAfterCleanup.slots.intro.heading, "Services");

  const assetTarget = {
    ...targets.find((target) => target.findingId === "generic_heading")!,
    id: "repair_asset_fixture",
    target: "asset_crop" as const,
    activation: "live" as const,
    sectionId: "services",
    findingId: "render.section_broken_media",
    title: "Section images load",
    detail: "1 broken image."
  };
  const assetPatch = await applyGeneratedSiteRepairTarget({ bundle, version, target: assetTarget, pass: 1 });
  assert.equal(assetPatch?.status, "applied");
  const visualAfterAsset = getVisualSectionV3(version.pageComposition.pages[0].sections[0].props);
  assert(visualAfterAsset?.templateId === "intro_grid");
  assert.equal(visualAfterAsset.options.mediaCrop, "detail_zoom");
  assert.equal(visualAfterAsset.options.mediaAspect, "4x3");

  const rejected = patchWasRejected(assetPatch!, "Regression", ["new_blocker"]);
  assert.equal(rejected.status, "rejected");
  assert.deepEqual(rejected.introducedBlockerIds, ["new_blocker"]);

  console.log("ok - generated-site repair loop primitives verified");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
