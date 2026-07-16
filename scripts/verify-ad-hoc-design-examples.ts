import assert from "node:assert/strict";
import {
  adHocDesignExampleArtifactV1,
  adHocDesignExampleArtifactVersionV1,
  adHocDesignGalleryReviewArtifactV1,
  adHocDesignGalleryReviewArtifactVersionV1,
  adHocDesignExamplePayloadSchemaV1,
  parseAdHocDesignExampleArtifactV1,
  sanitizeAdHocExampleHtmlV1,
  type AdHocDesignExamplePayloadV1
} from "../lib/ad-hoc-design-examples";
import { compileGeneratedSiteV3Site } from "../lib/generated-site-v3-compiler";
import { getVisualSectionV3 } from "../lib/generated-site-v3-visual-controls";
import type { BusinessProfile } from "../lib/models";

const candidateId = "sitecand_verify_ad_hoc_design";
const payload: AdHocDesignExamplePayloadV1 = {
  version: adHocDesignExampleArtifactVersionV1,
  exampleId: "example_verify",
  title: "Verification No-Media Hero",
  direction: "Type, facts, and services carry the first viewport without a media well.",
  mediaMode: "no_media_primary",
  sourceCandidateId: candidateId,
  promptVersion: "verify-static-v1",
  referenceNotes: ["No-media editorial reference"],
  sourceAssetIds: [],
  html: "<!doctype html><html><head><style>body{font-family:sans-serif}</style></head><body><h1>No media floor</h1></body></html>",
  screenshots: [
    { viewport: "desktop", width: 1440, height: 1100, capturedAt: "2026-06-22T00:00:00.000Z" },
    { viewport: "tablet", width: 834, height: 1100, capturedAt: "2026-06-22T00:00:00.000Z" },
    { viewport: "mobile", width: 390, height: 900, capturedAt: "2026-06-22T00:00:00.000Z" }
  ],
  rubric: {
    visualQuality: 92,
    noMediaCompleteness: 96,
    weakMediaResilience: 95,
    productionFeasibility: 90,
    conversionClarity: 94
  },
  status: "winner",
  notes: "Verification payload."
};

const artifact = adHocDesignExampleArtifactV1({ candidateId, payload, createdAt: "2026-06-22T00:00:00.000Z" });
assert.equal(artifact.scope, "candidate_alternative");
assert.equal(artifact.artifactType, "visual_benchmark");
assert.equal(artifact.artifactVersion, adHocDesignExampleArtifactVersionV1);
assert.deepEqual(parseAdHocDesignExampleArtifactV1(artifact), payload);
assert.ok(adHocDesignExamplePayloadSchemaV1.safeParse(payload).success, "Example payload should validate.");

const reviewArtifact = adHocDesignGalleryReviewArtifactV1({
  candidateId,
  createdAt: "2026-06-22T00:00:00.000Z",
  payload: {
    version: adHocDesignGalleryReviewArtifactVersionV1,
    sourceCandidateId: candidateId,
    reviewedAt: "2026-06-22T00:00:00.000Z",
    winnerExampleIds: ["example_verify"],
    teardown: ["The winner uses service facts as visual material."],
    gateA: { status: "passed", reason: "Three human-approved examples would pass Gate A." }
  }
});
assert.equal(reviewArtifact.scope, "qa_evidence");
assert.equal(reviewArtifact.artifactType, "v3_review_packet");

const sanitized = sanitizeAdHocExampleHtmlV1(
  `<script>alert(1)</script><div onclick="alert(1)" style="background:url(https://example.com/a.png)">@import url(https://example.com/x.css);</div>`
);
assert.equal(/<script|onclick|@import|https:\/\/example\.com/i.test(sanitized), false, "Ad hoc HTML sanitizer should remove active and external network surfaces.");

const business = autoBodyBusinessFixture();
const { version } = compileGeneratedSiteV3Site({ siteId: business.siteId, business, createdAt: "2026-06-22T00:00:00.000Z" });
const hero = getVisualSectionV3(version.pageComposition.pages[0]?.sections[0]?.props ?? {});
assert.equal(version.rendererVersion, "layout-v3");
assert.match(version.artDirection.recipeId, /^precision-service-v1:/);
assert.equal(version.artDirection.mediaTreatment, "editorial_crop");
assert.equal(version.artDirection.colorSystem, "high_contrast_neutral");
assert.equal(version.theme?.paletteName.startsWith("identity-v1:auto_body:"), true);
assert.equal(hero?.templateId, "hero_statement");
assert.equal(hero?.options.heroLayout, "text_first");
assert.equal("media" in (hero?.slots ?? {}), false, "No-media hero must not render a media slot.");
assert.ok(version.mediaDecisions.some((decision) => decision.source === "first_party" || decision.source === "generated_ai"));

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      artifactVersion: artifact.artifactVersion,
      reviewArtifactVersion: reviewArtifact.artifactVersion,
      recipeId: version.artDirection.recipeId,
      paletteName: version.theme?.paletteName,
      heroLayout: hero?.options.heroLayout
    },
    null,
    2
  )}\n`
);

function autoBodyBusinessFixture(): BusinessProfile {
  return {
    id: "biz_verify_no_media",
    siteId: "site_verify_no_media",
    name: "Mencia Auto Body & Paint",
    vertical: "auto_body",
    categories: ["Auto body shop", "Collision repair"],
    description: "Mencia Auto Body & Paint handles collision repair, paint services, dents, glass, and self-pay repair questions in Austin.",
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
    serviceHighlights: ["Collision repair", "Paint services", "Dent repair"],
    serviceAreas: ["Austin", "Central Austin", "North Austin"],
    photos: [
      {
        id: "generic_stock_panel",
        url: "/generated-site-assets/auto-body/paint-booth-masked-panel-v1.png",
        alt: "Generic generated auto body panel",
        source: "generated",
        rightsStatus: "preclaim_safe"
      }
    ],
    socialLinks: [],
    bookingLinks: [],
    orderingLinks: [],
    pressLinks: [],
    provenance: {}
  };
}
