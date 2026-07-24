import assert from "node:assert/strict";
import sharp from "sharp";
import {
  evaluateVisualQuality,
  publiclyEligibleVisualQualityCheckIds,
  visualQualityCheckDefinitions,
  visualQualityMethodologyIdentity,
  visualQualityPromptIdentity
} from "../packages/website-assessment";

const ids = visualQualityCheckDefinitions.map((check) => check.id);
assert.equal(new Set(ids).size, ids.length, "Visual Quality check IDs must be unique.");
assert(visualQualityMethodologyIdentity.startsWith("visual-quality@sha256:"));
assert(visualQualityPromptIdentity.startsWith("visual-prompt@sha256:"));
assert(visualQualityCheckDefinitions.every((check) => ["major", "minor", "advisory"].includes(check.impact)), "Visual Quality cannot emit critical checks.");
assert([...publiclyEligibleVisualQualityCheckIds].every((id) => ids.includes(id)), "The public Visual Quality allowlist contains an unknown check.");

const live = process.env.VISUAL_QUALITY_LIVE_CONFORMANCE === "true";
const reports = [];
if (live) {
  assert(process.env.OPENAI_API_KEY, "OPENAI_API_KEY is required for live Visual Quality conformance.");
  for (const fixture of ["strong", "mixed", "defective"] as const) {
    const contactSheet = await fixtureContactSheet(fixture);
    const assessment = await evaluateVisualQuality({
      contactSheet,
      contactSheetMimeType: "image/png",
      screenshots: [
        { route: "/", viewport: "desktop", artifactKey: `fixture/${fixture}-desktop.png` },
        { route: "/", viewport: "mobile", artifactKey: `fixture/${fixture}-mobile.png` }
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
