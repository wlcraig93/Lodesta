import "./load-env";

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as React from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { compileGeneratedSiteV3Site } from "../lib/generated-site-v3-compiler";
import { getVisualSectionV3 } from "../lib/generated-site-v3-visual-controls";
import { createSiteV3FromInput } from "../lib/intake";
import { createDeterministicSiteDirectorPlanV1 } from "../lib/deterministic-site-director-plan-v1";
import { getRenderInspectionRuntimeStatus, inspectUrlRender } from "../lib/render-inspection";
import { SiteRenderer } from "../lib/site-renderer";
import type { AssetReference, GeneratedCopyDeckV2 } from "../lib/models";

const artifactRoot = await mkdtemp(join(tmpdir(), "lodesta-render-browser-"));

try {
  const runtime = await getRenderInspectionRuntimeStatus({ launch: true });
  if (!runtime.packageInstalled || !runtime.browserLaunchable) {
    throw new Error(`${runtime.message} Run npm run install:browsers.`);
  }

  const html = encodeURIComponent(`
    <!doctype html>
    <html>
      <head><title>Lodesta render browser verification</title></head>
      <body>
        <main>
          <section data-section-id="hero">
            <h1>Browser render verification</h1>
            <p>This fixture has enough visible text for render metrics and screenshot capture verification.</p>
            <a class="button" data-analytics-role="primary_cta" href="tel:+15551234567">Call Now</a>
            <form><input name="name" aria-label="Name" /></form>
          </section>
        </main>
      </body>
    </html>
  `);
  const result = await inspectUrlRender({
    url: `data:text/html,${html}`,
    captureScreenshots: true,
    artifactRoot
  });

  if (result.adapter !== "playwright") {
    throw new Error(`Expected Playwright render inspection, received ${result.adapter}: ${result.unavailableReason ?? "no reason"}`);
  }
  if (result.screenshots.length !== 3 || result.screenshots.some((screenshot) => (screenshot.bytes ?? 0) <= 0)) {
    throw new Error("Expected non-empty desktop, tablet, and mobile screenshot artifacts.");
  }
  if (!result.findings.some((finding) => finding.id === "render.primary_cta.desktop" && finding.severity === "pass")) {
    throw new Error("Expected desktop CTA detection to pass.");
  }
  if (!result.findings.some((finding) => finding.id === "render.form.mobile" && finding.severity === "pass")) {
    throw new Error("Expected mobile form detection to pass.");
  }

  const servicePage = await renderGeneratedServicePageHtml();
  if (!servicePage.html.includes(`data-section-template="contact_split"`)) {
    throw new Error("Expected generated service page to render a contact_split section.");
  }
  if (!servicePage.html.includes(`class="site-contact-form-v3"`) || !servicePage.html.includes(`value="page_services_emergency-hvac-repair"`)) {
    throw new Error("Expected generated service page contact form with service-page attribution.");
  }
  const serviceResult = await inspectUrlRender({
    url: `data:text/html,${encodeURIComponent(servicePage.html)}`,
    captureScreenshots: true,
    artifactRoot
  });
  if (serviceResult.adapter !== "playwright") {
    throw new Error(`Expected Playwright service-page render inspection, received ${serviceResult.adapter}: ${serviceResult.unavailableReason ?? "no reason"}`);
  }
  if (serviceResult.screenshots.length !== 3 || serviceResult.screenshots.some((screenshot) => (screenshot.bytes ?? 0) <= 0)) {
    throw new Error("Expected non-empty generated service-page desktop, tablet, and mobile screenshot artifacts.");
  }
  if (!serviceResult.findings.some((finding) => finding.id === "render.form.mobile" && finding.severity === "pass")) {
    throw new Error("Expected generated service-page contact form detection to pass on mobile.");
  }

  const noMediaPage = await renderAutoBodyNoMediaPageHtml();
  if (!noMediaPage.html.includes(`data-hero-layout="no_media_editorial"`)) {
    throw new Error("Expected auto-body no-media fixture to render the no_media_editorial hero.");
  }
  if (noMediaPage.bodyHtml.includes("site-visual-block-v3-hero_media")) {
    throw new Error("Expected auto-body no-media fixture to render no hero media well.");
  }
  const noMediaResult = await inspectUrlRender({
    url: `data:text/html,${encodeURIComponent(noMediaPage.html)}`,
    captureScreenshots: true,
    artifactRoot
  });
  if (noMediaResult.adapter !== "playwright") {
    throw new Error(`Expected Playwright no-media render inspection, received ${noMediaResult.adapter}: ${noMediaResult.unavailableReason ?? "no reason"}`);
  }
  if (noMediaResult.screenshots.length !== 3 || noMediaResult.screenshots.some((screenshot) => (screenshot.bytes ?? 0) <= 0)) {
    throw new Error("Expected non-empty auto-body no-media desktop, tablet, and mobile screenshot artifacts.");
  }
  if ((noMediaResult.metrics.brokenImageCount ?? 0) > 0) {
    throw new Error("Expected auto-body no-media fixture to render without broken images.");
  }

  const framedProofPage = await renderAutoBodyFramedProofPageHtml();
  if (!framedProofPage.html.includes(`data-figure-treatment="framed_shadow"`)) {
    throw new Error("Expected framed proof fixture to render through the framed_shadow figure treatment.");
  }
  if (!framedProofPage.html.includes("site-visual-block-v3-proof_pair_media") && !framedProofPage.html.includes("site-visual-block-v3-media_feature_image")) {
    throw new Error("Expected framed proof fixture to render first-party proof media.");
  }
  const framedProofResult = await inspectUrlRender({
    url: `data:text/html,${encodeURIComponent(framedProofPage.html)}`,
    captureScreenshots: true,
    artifactRoot
  });
  if (framedProofResult.adapter !== "playwright") {
    throw new Error(`Expected Playwright framed-proof render inspection, received ${framedProofResult.adapter}: ${framedProofResult.unavailableReason ?? "no reason"}`);
  }
  if ((framedProofResult.metrics.brokenImageCount ?? 0) > 0) {
    throw new Error("Expected framed proof fixture to render without broken images.");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        adapter: result.adapter,
        screenshots: result.screenshots.map((screenshot) => ({
          viewport: screenshot.viewport,
          bytes: screenshot.bytes,
          path: screenshot.path
        })),
        generatedServicePage: {
          slug: servicePage.slug,
          screenshots: serviceResult.screenshots.map((screenshot) => ({
            viewport: screenshot.viewport,
            bytes: screenshot.bytes,
            path: screenshot.path
          }))
        },
        generatedAutoBodyNoMedia: {
          heroLayout: noMediaPage.heroLayout,
          paletteName: noMediaPage.paletteName,
          screenshots: noMediaResult.screenshots.map((screenshot) => ({
            viewport: screenshot.viewport,
            bytes: screenshot.bytes,
            path: screenshot.path
          }))
        },
        generatedAutoBodyFramedProof: {
          figureTreatment: framedProofPage.figureTreatment,
          screenshots: framedProofResult.screenshots.map((screenshot) => ({
            viewport: screenshot.viewport,
            bytes: screenshot.bytes,
            path: screenshot.path
          }))
        },
        browser: runtime.message,
        artifactRoot
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  if (process.env.LODESTA_RENDER_VERIFY_KEEP_ARTIFACTS !== "true") {
    await rm(artifactRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  process.stderr.write(`Render browser verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

async function renderGeneratedServicePageHtml() {
  const bundle = createSiteV3FromInput({
    prompt:
      "Build a website for Boundary Browser HVAC in Austin. services: Emergency HVAC Repair, AC Tune Ups. phone: 512-555-0188"
  });
  bundle.presenceAssessment.businessUnderstanding = {
    version: "business-understanding-v2",
    source: "deterministic_fallback",
    vertical: bundle.businessProfile.vertical,
    verticalConfidence: 1,
    detectedSubverticals: [],
    cleanedServices: [
      {
        name: "Emergency HVAC Repair",
        sourceText:
          "Emergency HVAC Repair — urgent heating and cooling failures are triaged from reported system symptoms, outage timing, and the Austin service address.",
        confidence: 1
      },
      { name: "AC Tune Ups", sourceText: "AC Tune Ups", confidence: 1 }
    ],
    primaryConversionGoal: "call_first",
    urgentServiceSignals: ["Emergency HVAC Repair"],
    factConfidence: [],
    notes: ["Browser fixture with substantive source evidence for one dedicated service page."]
  };
  bundle.presenceAssessment.siteDirectorPlanV1 = createDeterministicSiteDirectorPlanV1({
    bundle,
    createdAt: "2026-07-15T00:00:00.000Z"
  });
  bundle.presenceAssessment.generatedCopyDeck = servicePageCopyDeck();
  const compiled = compileGeneratedSiteV3Site({ bundle }).version;
  const slug = "services/emergency-hvac-repair";
  const page = compiled.pageComposition.pages.find((candidate) => candidate.slug === slug);
  if (!page) throw new Error("Generated service-page browser fixture did not compile the expected service page.");
  bundle.siteModel.versions = [compiled];
  const stream = await renderToReadableStream(
    React.createElement(SiteRenderer, {
      business: bundle.businessProfile,
      site: bundle.siteModel,
      extensions: bundle.extensionModel,
      version: compiled,
      pageSlug: slug,
      tracking: false,
      formsEnabled: true
    })
  );
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value);
  }
  const css = await readFile(join(process.cwd(), "app", "globals.css"), "utf8");
  return {
    slug,
    html: `<!doctype html><html><head><title>Generated service page render verification</title><style>${css}</style></head><body>${html}</body></html>`
  };
}

async function renderAutoBodyNoMediaPageHtml() {
  const bundle = createSiteV3FromInput({
    prompt:
      "Build a website for Mencia Auto Body & Paint, an auto body shop in Austin. services: Collision repair, Paint refinishing, Paintless dent repair, Bumper repair, Auto glass. phone: 512-551-9434. address: 819 Houston St, Austin, TX 78756"
  });
  bundle.businessProfile.photos = [];
  bundle.presenceAssessment.generatedCopyDeck = autoBodyNoMediaCopyDeck();
  const compiled = compileGeneratedSiteV3Site({ bundle }).version;
  const hero = getVisualSectionV3(compiled.pageComposition.pages[0]?.sections[0]?.props ?? {});
  const heroLayout = hero?.templateId === "hero_statement" || hero?.templateId === "hero_split" ? hero.options.heroLayout : undefined;
  if (hero?.templateId !== "hero_statement" || heroLayout !== "no_media_editorial") {
    throw new Error(`Expected no-media auto-body compile to lead with no_media_editorial hero; got ${hero?.templateId}:${heroLayout}.`);
  }
  bundle.siteModel.versions = [compiled];
  const stream = await renderToReadableStream(
    React.createElement(SiteRenderer, {
      business: bundle.businessProfile,
      site: bundle.siteModel,
      extensions: bundle.extensionModel,
      version: compiled,
      tracking: false,
      formsEnabled: true
    })
  );
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value);
  }
  const css = await readFile(join(process.cwd(), "app", "globals.css"), "utf8");
  return {
    heroLayout,
    paletteName: compiled.theme?.paletteName ?? "",
    bodyHtml: html,
    html: `<!doctype html><html><head><title>Auto-body no-media render verification</title><style>${css}</style></head><body>${html}</body></html>`
  };
}

async function renderAutoBodyFramedProofPageHtml() {
  const bundle = createSiteV3FromInput({
    prompt:
      "Build a website for Mencia Auto Body & Paint, an auto body shop in Austin. services: Collision repair, Paint refinishing, Paintless dent repair, Bumper repair, Auto glass. phone: 512-551-9434. address: 819 Houston St, Austin, TX 78756"
  });
  bundle.businessProfile.photos = [framedProofAsset()];
  bundle.presenceAssessment.generatedCopyDeck = autoBodyNoMediaCopyDeck();
  const compiled = compileGeneratedSiteV3Site({ bundle }).version;
  if (compiled.artDirection.controls?.figureTreatment !== "framed_shadow") {
    throw new Error(`Expected framed proof compile to use framed_shadow; got ${compiled.artDirection.controls?.figureTreatment ?? "none"}.`);
  }
  bundle.siteModel.versions = [compiled];
  const stream = await renderToReadableStream(
    React.createElement(SiteRenderer, {
      business: bundle.businessProfile,
      site: bundle.siteModel,
      extensions: bundle.extensionModel,
      version: compiled,
      tracking: false,
      formsEnabled: true
    })
  );
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value);
  }
  const css = await readFile(join(process.cwd(), "app", "globals.css"), "utf8");
  return {
    figureTreatment: compiled.artDirection.controls?.figureTreatment,
    bodyHtml: html,
    html: `<!doctype html><html><head><title>Auto-body framed proof render verification</title><style>${css}</style></head><body>${html}</body></html>`
  };
}

function framedProofAsset(): AssetReference {
  const url =
    "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%201200%20800'%3E%3Crect%20width='600'%20height='800'%20fill='%23242a31'/%3E%3Crect%20x='600'%20width='600'%20height='800'%20fill='%237c8894'/%3E%3Ctext%20x='120'%20y='120'%20fill='white'%20font-size='72'%3EBefore%3C/text%3E%3Ctext%20x='720'%20y='120'%20fill='white'%20font-size='72'%3EAfter%3C/text%3E%3C/svg%3E";
  return {
    id: "render_framed_text_overlay_before_after",
    url,
    alt: "Before and after repair reference with text overlay",
    source: "website_reference",
    rightsStatus: "reference_only",
    width: 1200,
    height: 800,
    analysisV1: {
      version: "asset-analysis-v1",
      source: "openai",
      model: "fixture",
      analyzedAt: "2026-07-09T00:00:00.000Z",
      imageKind: "before_after",
      warnings: ["text_overlay"],
      focalPoint: "center",
      subjectPlacement: "centered",
      contentTags: ["auto-body", "before-after"],
      summary: "Before and after repair reference with text overlay.",
      limitations: []
    }
  };
}

function servicePageCopyDeck(): GeneratedCopyDeckV2 {
  return {
    version: "generated-copy-deck-v2",
    source: "openai",
    hero: {
      eyebrow: "HVAC help",
      heading: "Emergency HVAC repair with a clear first call.",
      body: "Boundary Browser HVAC helps Austin customers with emergency HVAC repair and AC tune ups."
    },
    servicesIntro: {
      heading: "HVAC services customers can request.",
      body: "Emergency HVAC repair and AC tune ups are the documented services for this browser fixture."
    },
    serviceItems: [
      {
        title: "Emergency HVAC Repair",
        body: "Emergency HVAC repair starts with the system issue, timing, and whether heat or cooling is out."
      },
      {
        title: "AC Tune Ups",
        body: "AC tune ups check documented comfort concerns before heavier repair decisions."
      }
    ],
    processIntro: { heading: "Start with the system details.", body: "Call or send the HVAC issue, timing, and Austin location." },
    processSteps: [
      { title: "Share the issue", body: "Name the HVAC service and what changed." },
      { title: "Confirm fit", body: "The team confirms the next repair or tune up step." },
      { title: "Plan the visit", body: "Use the call path to confirm timing and location." }
    ],
    faqs: [
      { question: "Can I request emergency HVAC repair?", answer: "Yes. Share the system issue, timing, and whether heating or cooling is out." },
      { question: "Can I ask about AC tune ups?", answer: "Yes. AC tune ups are part of the documented service list." },
      { question: "Should I call first?", answer: "Yes. Calling first confirms the best next step." },
      { question: "Do you serve Austin?", answer: "Yes. Confirm the exact address when you reach out." }
    ],
    contactIntro: { heading: "Contact Boundary Browser HVAC", body: "Use the call or form path with the HVAC service and timing." },
    splitMedia: { heading: "HVAC service details before assumptions.", body: "The first contact starts with the source-backed service need." },
    gallery: { heading: "HVAC context.", body: "Approved media can support the service detail after review." },
    seo: {
      title: "Boundary Browser HVAC | Emergency HVAC Repair in Austin",
      description: "Emergency HVAC repair and AC tune ups in Austin with a clear call or form path."
    },
    groundingNotes: ["Browser render fixture copy for source-backed service pages."],
    voiceProfile: { pov: "brand_direct" },
    servicePages: [
      {
        serviceName: "Emergency HVAC Repair",
        hero: {
          heading: "Emergency HVAC repair starts with the urgent system problem.",
          body: "Emergency HVAC repair calls should include what stopped working, when it happened, and whether heating or cooling is out."
        },
        detail: {
          heading: "Emergency HVAC repair details before dispatch planning.",
          body: "Emergency HVAC repair requests stay grounded in the system symptoms, timing, and Austin service address before the next step is confirmed."
        },
        faqs: [
          { question: "When should I ask for emergency HVAC repair?", answer: "Ask for emergency HVAC repair when heating or cooling stops working and timing matters." },
          { question: "What helps the first call?", answer: "Share the HVAC system issue, timing, and address." },
          { question: "Can I confirm service fit first?", answer: "Yes, the first call confirms whether emergency HVAC repair is the right next step." },
          { question: "Do I need an address?", answer: "Yes, share the Austin service address so the team can confirm fit." }
        ],
        seo: {
          title: "Emergency HVAC Repair in Austin | Boundary Browser HVAC",
          description: "Emergency HVAC repair in Austin with clear questions, service details, and contact path."
        }
      }
    ]
  };
}

function autoBodyNoMediaCopyDeck(): GeneratedCopyDeckV2 {
  return {
    version: "generated-copy-deck-v2",
    source: "openai",
    hero: {
      eyebrow: "Austin auto body",
      heading: "Auto body repair without the runaround.",
      body: "Mencia Auto Body & Paint helps Austin drivers with collision repair, paint refinishing, dents, bumpers, and glass questions."
    },
    servicesIntro: {
      heading: "Repair paths customers can start clearly.",
      body: "Bring the affected panel, timing, and vehicle condition. The first conversation keeps the repair path practical."
    },
    serviceItems: [
      { title: "Collision repair", body: "Panel damage, impact repair questions, and next-step planning for collision needs." },
      { title: "Paint refinishing", body: "Paint work starts with the affected area, finish goals, and timing." },
      { title: "Paintless dent repair", body: "Dents are reviewed for fit before heavier repair assumptions." },
      { title: "Bumper repair", body: "Bumper repair questions start with damage location and whether the vehicle still drives." },
      { title: "Auto glass", body: "Glass questions can be routed from the same direct contact path." }
    ],
    processIntro: { heading: "Start with the repair details.", body: "Share the damage, vehicle condition, and preferred timing." },
    processSteps: [
      { title: "Describe the damage", body: "Name the affected panel, paint, bumper, dent, or glass issue." },
      { title: "Confirm repair fit", body: "The shop confirms the right next step before expectations are set." },
      { title: "Plan the quote", body: "Use the phone or form path to coordinate details." }
    ],
    faqs: [
      { question: "Can I ask about collision repair?", answer: "Yes. Share the damage location and whether the vehicle still drives." },
      { question: "Can I ask about paint refinishing?", answer: "Yes. Start with the affected area and finish concerns." },
      { question: "Can I call first?", answer: "Yes. Calling is the clearest way to start a repair question." },
      { question: "Do you serve Austin?", answer: "Yes. Confirm the exact vehicle and location details when you reach out." }
    ],
    contactIntro: { heading: "Contact Mencia Auto Body & Paint", body: "Call or send the repair details to start a practical quote conversation." },
    splitMedia: { heading: "Repair details before assumptions.", body: "The first step is the actual damage, timing, and vehicle condition." },
    gallery: { heading: "Repair context.", body: "Real shop media can support this page only when it is approved and strong enough to help." },
    seo: {
      title: "Mencia Auto Body & Paint | Auto Body Repair in Austin",
      description: "Collision repair, paint refinishing, dents, bumpers, and glass questions in Austin."
    },
    groundingNotes: ["Browser render fixture copy for auto-body no-media floor."],
    voiceProfile: { pov: "brand_direct" },
    servicePages: [
      {
        serviceName: "Collision repair",
        hero: {
          heading: "Collision repair starts with the damage details.",
          body: "Share the affected panels, whether the vehicle drives, and the timing you are trying to plan around."
        },
        detail: {
          heading: "Practical collision repair questions before assumptions.",
          body: "Collision repair requests stay grounded in damage location, vehicle condition, and next-step fit."
        },
        faqs: [
          { question: "What should I share first?", answer: "Share the panel, timing, and whether the vehicle is safe to drive." },
          { question: "Can I call about paint too?", answer: "Yes. Paint refinishing questions can start through the same contact path." },
          { question: "Can I ask about a quote?", answer: "Yes. A quote conversation starts with the repair details." },
          { question: "Is Austin served?", answer: "Yes. Confirm your location and vehicle details when you reach out." }
        ],
        seo: {
          title: "Collision Repair in Austin | Mencia Auto Body & Paint",
          description: "Collision repair questions in Austin with a clear phone or form path."
        }
      }
    ]
  };
}
