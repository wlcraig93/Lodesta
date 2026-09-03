import assert from "node:assert/strict";
import sharp from "sharp";
import {
  evaluateVisualQuality,
  publiclyEligibleVisualQualityCheckIds,
  visualQualityCheckDefinitions,
  visualQualityMethodologyIdentity,
  visualQualityPrompt,
  visualQualityPromptIdentity
} from "../packages/website-assessment";

const ids = visualQualityCheckDefinitions.map((check) => check.id);
assert.equal(new Set(ids).size, ids.length, "Visual Quality check IDs must be unique.");
assert(visualQualityMethodologyIdentity.startsWith("visual-quality@sha256:"));
assert(visualQualityPromptIdentity.startsWith("visual-prompt@sha256:"));
assert(visualQualityCheckDefinitions.every((check) => ["major", "minor", "advisory"].includes(check.impact)), "Visual Quality cannot emit critical checks.");
assert([...publiclyEligibleVisualQualityCheckIds].every((id) => ids.includes(id)), "The public Visual Quality allowlist contains an unknown check.");
assert.match(visualQualityPrompt, /opened mobile navigation/, "Visual review can still pass navigation from a closed header alone.");

const live = process.env.VISUAL_QUALITY_LIVE_CONFORMANCE === "true";
const reports = [];
const deterministicConflict = await evaluateVisualQuality({
  contactSheets: [
    { viewport: "desktop", bytes: Buffer.from("desktop-fixture"), mimeType: "image/png" },
    { viewport: "mobile", bytes: Buffer.from("mobile-fixture"), mimeType: "image/png" }
  ],
  screenshots: [
    { route: "/", viewport: "desktop", frame: "top", artifactKey: "fixture/desktop.png" },
    { route: "/", viewport: "mobile", frame: "top", artifactKey: "fixture/mobile.png" }
  ],
  vertical: "plumber",
  verticalConfidence: 1,
  businessName: "Example Local Business",
  primaryLocation: "Austin, TX",
  services: ["Primary service"],
  customerJourneys: ["Call for service"],
  deterministicContext: {
    minimumFontSize: 16,
    horizontalOverflow: false,
    clippingCount: 0
  },
  hasMeaningfulImagery: true,
  client: {
    create: async () => ({
      status: "completed",
      output_text: JSON.stringify({
        checks: visualQualityCheckDefinitions.map((check, index) => ({
          id: check.id,
          status: "warning",
          confidence: 1,
          explanation: index === 0
            ? "The font-size is visibly too small."
            : "The composition could establish a clearer visual relationship.",
          evidence: [{
            route: "/",
            viewport: "desktop",
            frame: "top",
            observation: "The cited frame supports this composition judgment."
          }]
        }))
      })
    })
  }
});
assert.equal(
  deterministicConflict.evaluator.status,
  "unavailable",
  "A screenshot model was allowed to override deterministic measurement evidence."
);
assert(
  deterministicConflict.coverage.limitations.some((limitation) =>
    limitation.includes("visual_evaluator_prohibited_assertion")
  ),
  "A measurable screenshot assertion was not rejected with retained provenance."
);
const homepageOnlySiteReview = await evaluateVisualQuality({
  contactSheets: [
    { viewport: "desktop", bytes: Buffer.from("desktop-fixture"), mimeType: "image/png" },
    { viewport: "mobile", bytes: Buffer.from("mobile-fixture"), mimeType: "image/png" }
  ],
  screenshots: [
    { route: "/", viewport: "desktop", frame: "top", artifactKey: "fixture/home-desktop.png" },
    { route: "/", viewport: "mobile", frame: "top", artifactKey: "fixture/home-mobile.png" },
    { route: "/service", viewport: "desktop", frame: "top", artifactKey: "fixture/service-desktop.png" },
    { route: "/service", viewport: "mobile", frame: "top", artifactKey: "fixture/service-mobile.png" }
  ],
  vertical: "plumber",
  verticalConfidence: 1,
  businessName: "Example Local Business",
  primaryLocation: "Austin, TX",
  services: ["Primary service"],
  customerJourneys: ["Call for service"],
  deterministicContext: {},
  hasMeaningfulImagery: true,
  client: {
    create: async () => ({
      status: "completed",
      output_text: JSON.stringify({
        checks: visualQualityCheckDefinitions.map((check, index) => ({
          id: check.id,
          status: "pass",
          confidence: 1,
          explanation: "The supplied composition supports this visual judgment.",
          evidence: [{
            route: "/",
            viewport: index % 2 === 0 ? "desktop" : "mobile",
            frame: "top",
            observation: "The homepage frame supports this visual judgment."
          }]
        }))
      })
    })
  }
});
assert.equal(
  homepageOnlySiteReview.evaluator.status,
  "unavailable",
  "A multi-route visual review was accepted without citing every labeled route."
);
assert(
  homepageOnlySiteReview.coverage.limitations.some((limitation) =>
    limitation.includes("visual_evaluator_incomplete_evidence_coverage")
  ),
  "Incomplete route evidence was not retained as the visual-review failure reason."
);
const navigationStateReview = await evaluateVisualQuality({
  contactSheets: [
    { viewport: "desktop", bytes: Buffer.from("desktop-fixture"), mimeType: "image/png" },
    { viewport: "mobile", bytes: Buffer.from("mobile-fixture"), mimeType: "image/png" }
  ],
  screenshots: [
    { route: "/", viewport: "desktop", frame: "top", artifactKey: "fixture/home-desktop.png" },
    { route: "/", viewport: "mobile", frame: "top", artifactKey: "fixture/home-mobile.png" },
    { route: "/", viewport: "mobile", frame: "navigation", artifactKey: "fixture/home-navigation.png" }
  ],
  vertical: "plumber",
  verticalConfidence: 1,
  businessName: "Example Local Business",
  primaryLocation: "Austin, TX",
  services: ["Primary service"],
  customerJourneys: ["Call for service"],
  deterministicContext: {
    navigationEvidence: { interactiveDisclosureObserved: true, openedStateCaptured: true }
  },
  hasMeaningfulImagery: true,
  client: {
    create: async () => ({
      status: "completed",
      output_text: JSON.stringify({
        checks: visualQualityCheckDefinitions.map((check, index) => ({
          id: check.id,
          status: check.id === "visual.navigation.presentation" ? "warning" : "pass",
          confidence: 1,
          explanation: check.id === "visual.navigation.presentation"
            ? "The opened disclosure artwork does not communicate a distinct close state."
            : "The supplied composition supports this visual judgment.",
          evidence: [{
            route: "/",
            viewport: check.id === "visual.navigation.presentation" || index % 2 ? "mobile" : "desktop",
            frame: check.id === "visual.navigation.presentation" ? "navigation" : "top",
            observation: check.id === "visual.navigation.presentation"
              ? "The open panel is visible while the trigger retains its closed three-line artwork."
              : "The cited frame supports this composition judgment."
          }]
        }))
      })
    })
  }
});
assert.equal(navigationStateReview.evaluator.status, "completed", "Opened navigation evidence was rejected by the visual contract.");
assert.equal(
  navigationStateReview.groups.flatMap((group) => group.checks)
    .find((check) => check.id === "visual.navigation.presentation")?.status,
  "warning",
  "Opened navigation evidence did not drive the navigation-presentation result."
);
if (live) {
  assert(process.env.OPENAI_API_KEY, "OPENAI_API_KEY is required for live Visual Quality conformance.");
  for (const fixture of ["strong", "mixed", "defective"] as const) {
    const contactSheet = await fixtureContactSheet(fixture);
    const assessment = await evaluateVisualQuality({
      contactSheets: [
        { viewport: "desktop", bytes: contactSheet, mimeType: "image/png" },
        { viewport: "mobile", bytes: contactSheet, mimeType: "image/png" }
      ],
      screenshots: [
        { route: "/", viewport: "desktop", frame: "top", artifactKey: `fixture/${fixture}-desktop.png` },
        { route: "/", viewport: "mobile", frame: "top", artifactKey: `fixture/${fixture}-mobile.png` }
      ],
      vertical: "general_local",
      verticalConfidence: 0.9,
      businessName: "Example Local Business",
      primaryLocation: "Austin, TX",
      services: ["Primary service", "Secondary service"],
      customerJourneys: ["Understand the service", "Request an estimate"],
      deterministicContext: { fixture },
      hasMeaningfulImagery: true
    });
    assert.equal(assessment.evaluator.status, "completed", `Live ${fixture} visual evaluation did not complete.`);
    reports.push({
      fixture,
      verified: assessment.counts.verified,
      opportunities: assessment.counts.opportunities,
      unknown: assessment.counts.unknown,
      durationMs: assessment.evaluator.durationMs,
      estimatedCostUsd: assessment.evaluator.estimatedCostUsd
    });
  }
}

console.log(JSON.stringify({
  ok: true,
  methodologyIdentity: visualQualityMethodologyIdentity,
  checks: ids.length,
  publicEligibleChecks: publiclyEligibleVisualQualityCheckIds.size,
  deterministicPrecedence: "pass",
  liveConformance: live ? reports : "not_configured"
}, null, 2));

async function fixtureContactSheet(fixture: "strong" | "mixed" | "defective") {
  const config = fixture === "strong"
    ? { gap: 28, headingX: 72, ctaX: 72, imageX: 650, accent: "#1f513b", crooked: false }
    : fixture === "mixed"
      ? { gap: 12, headingX: 42, ctaX: 330, imageX: 650, accent: "#6a725f", crooked: false }
      : { gap: 2, headingX: -20, ctaX: 810, imageX: 980, accent: "#ff2d55", crooked: true };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="980">
    <rect width="1400" height="980" fill="#d7d9dc"/>
    <text x="28" y="38" font-family="Arial" font-size="20" font-weight="700">/ · desktop</text>
    <g transform="translate(28 58)${config.crooked ? " rotate(-1)" : ""}">
      <rect width="920" height="880" fill="#fff"/>
      <rect width="920" height="72" fill="#f5f4ef"/>
      <rect x="40" y="24" width="180" height="20" fill="${config.accent}"/>
      <rect x="${config.headingX}" y="150" width="430" height="52" fill="#17251e"/>
      <rect x="${config.headingX}" y="${220 + config.gap}" width="360" height="18" fill="#8c918d"/>
      <rect x="${config.ctaX}" y="${270 + config.gap}" width="180" height="52" rx="6" fill="${config.accent}"/>
      <rect x="${config.imageX}" y="130" width="250" height="300" fill="#b9c5bb"/>
      <rect x="50" y="${410 + config.gap}" width="820" height="1" fill="#d9ddda"/>
      <rect x="50" y="${450 + config.gap}" width="250" height="180" fill="#eef0ed"/>
      <rect x="${335 - config.gap}" y="${450 + config.gap}" width="250" height="180" fill="#eef0ed"/>
      <rect x="${620 - config.gap}" y="${450 + config.gap}" width="250" height="180" fill="#eef0ed"/>
    </g>
    <text x="990" y="38" font-family="Arial" font-size="20" font-weight="700">/ · mobile</text>
    <g transform="translate(990 58)">
      <rect width="380" height="880" fill="#fff"/>
      <rect width="380" height="64" fill="#f5f4ef"/>
      <rect x="24" y="22" width="130" height="18" fill="${config.accent}"/>
      <rect x="${Math.max(14, config.headingX / 3)}" y="112" width="${fixture === "defective" ? 410 : 330}" height="72" fill="#17251e"/>
      <rect x="24" y="${205 + config.gap}" width="300" height="16" fill="#8c918d"/>
      <rect x="${fixture === "defective" ? 260 : 24}" y="${250 + config.gap}" width="190" height="52" rx="6" fill="${config.accent}"/>
      <rect x="24" y="${340 + config.gap}" width="${fixture === "defective" ? 420 : 332}" height="220" fill="#b9c5bb"/>
      <rect x="24" y="${590 + config.gap}" width="332" height="160" fill="#eef0ed"/>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
