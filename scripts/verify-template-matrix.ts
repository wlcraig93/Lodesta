/**
 * Template × content-shape matrix (Phase 0.4).
 *
 * Renders representative content shapes (photo counts, service counts, hours
 * richness, name lengths, verticals) through real browser inspection and
 * asserts zero failing findings — including the composition QA checks
 * (figure overlap, blank space) and the existing text/contrast/overflow
 * battery. Presentation variants and new catalog entries are admitted to
 * selector pools only when this matrix passes with them in play.
 *
 * Requires a Playwright browser; skips (exit 0 with notice) when unavailable,
 * matching the render-browser verification convention.
 */
import assert from "node:assert";
import { createSiteFromInput } from "../lib/intake";
import { compileGeneratedSiteV3Site } from "../lib/generated-site-v3-compiler";
import { inspectGeneratedSiteBundleRender } from "../lib/generated-site-render-inspection";
import type { SiteBundle } from "../lib/models";

type MatrixShape = {
  id: string;
  prompt: string;
  photoCount: number;
  hours?: Record<string, string>;
  /** Brand color cues, simulating palette-from-pixels derivation. */
  colorSignals?: string[];
};

const richHours = {
  monday: "8:00am - 5:30pm",
  tuesday: "8:00am - 5:30pm",
  wednesday: "8:00am - 5:30pm",
  thursday: "8:00am - 5:30pm",
  friday: "8:00am - 5:30pm",
  saturday: "9:00am - 3:00pm",
  sunday: "Closed"
};

const shapes: MatrixShape[] = [
  {
    id: "text_only_sparse",
    prompt: "Build a website for Ray's Mobile Tire, a tire shop in Austin offering flat repair and used tires. phone: 512-555-0101",
    photoCount: 0
  },
  {
    id: "one_photo_three_services",
    prompt: "Build a website for Birdie Lane Diner, a restaurant in Austin offering breakfast plates, burgers, and milkshakes. phone: 512-555-0102",
    photoCount: 1,
    hours: richHours
  },
  {
    id: "four_photos_long_name",
    prompt:
      "Build a website for Hill Country Collision and Complete Auto Body Refinishing, an auto body shop in Dripping Springs offering collision repair, paintless dent repair, bumper repair, and auto glass. phone: 512-555-0103",
    photoCount: 4,
    hours: richHours
  },
  {
    id: "eight_photos_eight_services",
    prompt:
      "Build a website for Atlas Home Services, a home services company in Round Rock offering plumbing repair, drain cleaning, water heaters, leak detection, fixture installation, repiping, sewer camera inspection, and emergency plumbing. phone: 512-555-0104",
    photoCount: 8,
    hours: richHours
  },
  {
    id: "no_phone_form_first",
    prompt:
      "Build a website for Verde Salon Collective, a beauty salon in Austin offering haircuts, color, balayage, styling, and treatments. email: hello@verdesalon.example",
    photoCount: 4
  },
  {
    id: "sparse_two_services",
    prompt: "Build a website for Quick Patch Tire, a tire shop in Buda offering flat repair and tire rotation. phone: 512-555-0106",
    photoCount: 1
  },
  {
    // Derived-palette + accent-forward regression case: a vivid yellow + navy
    // cue set (the Texas Tires class) produced a 1.00:1 brand_bar header and a
    // 3.33:1 filled-kicker on the image hero before composed-header validation
    // and the kicker cascade fix. This shape keeps that class covered.
    id: "derived_palette_accent_forward",
    prompt: "Build a website for Derived Tire Co, a tire shop in Austin offering flat repair, new tires, and wheel alignment. phone: 512-555-0109",
    photoCount: 4,
    hours: richHours,
    colorSignals: ["#fef201", "#1e2d46"]
  }
];

async function main() {
  // accent_forward expressions are part of the validated surface.
  process.env.LODESTA_ACCENT_FORWARD = "on";
  const failures: string[] = [];
  for (const shape of shapes) {
    const bundle: SiteBundle = createSiteFromInput({ prompt: shape.prompt, identity: { siteId: `site_matrix_${shape.id}` } });
    if (shape.hours) bundle.businessProfile.hours = shape.hours;
    if (shape.colorSignals) {
      bundle.presenceAssessment.brandAssessment = {
        ...(bundle.presenceAssessment.brandAssessment ?? {
          id: `brand_${shape.id}`,
          siteId: bundle.businessProfile.siteId,
          confidence: 0.9,
          cues: [],
          typographySignals: [],
          imageStyleSignals: [],
          toneSignals: [],
          notes: []
        }),
        colorSignals: shape.colorSignals
      } as typeof bundle.presenceAssessment.brandAssessment;
    }
    bundle.businessProfile.photos = Array.from({ length: shape.photoCount }, (_, index) => ({
      id: `matrix_${shape.id}_photo_${index + 1}`,
      url: `/generated-site-assets/auto-body/${["bodywork-hero-v1.jpg", "finished-shop-context-v1.png", "glass-service-v1.jpg", "paint-refinish-closeup-v1.png"][index % 4]}`,
      alt: `Service photo ${index + 1}`,
      source: "licensed" as const,
      rightsStatus: "preclaim_safe" as const
    }));
    const { version } = compileGeneratedSiteV3Site({ bundle });
    bundle.siteModel.versions = [version];
    const result = await inspectGeneratedSiteBundleRender({ bundle, version, qaRunId: `matrix_${shape.id}` });
    if (result.unavailableReason) {
      console.log(`verify-template-matrix: browser unavailable (${result.unavailableReason}); skipping.`);
      return;
    }
    const fails = result.findings.filter((finding) => finding.severity === "fail");
    if (fails.length) {
      failures.push(
        `${shape.id} [pairing=${version.artDirection.fontPairingId}, services=${version.artDirection.sectionPresentation?.services}]: ${fails
          .map((finding) => `${finding.id} (${finding.evidence.slice(0, 90)})`)
          .join("; ")}`
      );
    }
  }
  assert.equal(failures.length, 0, `template matrix failures:\n${failures.join("\n")}`);
  console.log(`verify-template-matrix: ${shapes.length} content shapes passed across all viewports`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
