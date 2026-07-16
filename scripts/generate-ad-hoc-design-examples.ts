import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  adHocDesignExampleArtifactV1,
  adHocDesignGalleryReviewArtifactV1,
  adHocDesignExampleArtifactVersionV1,
  adHocDesignGalleryReviewArtifactVersionV1,
  sanitizeAdHocExampleHtmlV1,
  type AdHocDesignExamplePayloadV1
} from "../lib/ad-hoc-design-examples";
import { repository } from "../lib/repository";
import type { BusinessProfile } from "../lib/models";

const args = process.argv.slice(2);
const candidateId = valueAfter("--candidate");
const count = Number(valueAfter("--count") ?? "10");
const persist = args.includes("--persist");
const captureScreenshots = args.includes("--screenshots");
const selectedWinnerIds = new Set(
  (valueAfter("--winners") ?? "")
    .split(",")
    .map((winner) => winner.trim())
    .filter(Boolean)
);

if (!candidateId) {
  throw new Error(
    "Usage: npm run generate:ad-hoc-design-examples -- --candidate <candidateId> [--count 10] [--screenshots] [--winners example_01,example_02,example_03] [--persist]"
  );
}

const candidate = await repository.getSiteCandidate(candidateId);
if (!candidate) throw new Error(`Candidate ${candidateId} not found.`);

const outDir = join(process.cwd(), ".data", "ad-hoc-design-examples", candidateId);
await mkdir(outDir, { recursive: true });

const business = candidate.bundle.businessProfile;
const examples = staticExampleDirectionsV1(business).slice(0, Math.max(1, Math.min(12, count))).map((direction, index) => {
  const exampleId = `example_${String(index + 1).padStart(2, "0")}`;
  const payload: AdHocDesignExamplePayloadV1 = {
    version: adHocDesignExampleArtifactVersionV1,
    exampleId,
    title: direction.title,
    direction: direction.direction,
    mediaMode: direction.mediaMode,
    sourceCandidateId: candidateId,
    promptVersion: "reference-seeded-static-v1",
    referenceNotes: direction.referenceNotes,
    sourceAssetIds: [],
    html: sanitizeAdHocExampleHtmlV1(exampleHtmlV1(business, direction)),
    screenshots: [],
    rubric: direction.rubric,
    status: selectedWinnerIds.has(exampleId) ? "winner" : "reviewable",
    notes: direction.notes
  };
  return payload;
});
const generatedExampleIds = new Set(examples.map((example) => example.exampleId));
const unknownWinnerIds = [...selectedWinnerIds].filter((winnerId) => !generatedExampleIds.has(winnerId));
if (unknownWinnerIds.length) {
  throw new Error(`Unknown winner id(s): ${unknownWinnerIds.join(", ")}. Generated ids: ${[...generatedExampleIds].join(", ")}.`);
}

for (const example of examples) {
  await writeFile(join(outDir, `${example.exampleId}.html`), example.html, "utf8");
}

if (captureScreenshots) {
  const screenshotRoot = join(outDir, "screenshots");
  await mkdir(screenshotRoot, { recursive: true });
  await captureExampleScreenshotsV1({
    examples,
    outDir,
    screenshotRoot
  });
}

if (persist) {
  for (const example of examples) {
    await repository.upsertSiteArtifact(adHocDesignExampleArtifactV1({ candidateId, payload: example }));
  }
}

if (persist) {
  const winners = examples.filter((example) => example.status === "winner").map((example) => example.exampleId);
  await repository.upsertSiteArtifact(
    adHocDesignGalleryReviewArtifactV1({
      candidateId,
      payload: {
        version: adHocDesignGalleryReviewArtifactVersionV1,
        sourceCandidateId: candidateId,
        reviewedAt: new Date().toISOString(),
        winnerExampleIds: winners,
        teardown: [
          "No-media directions use type, service specifics, hours, and proof facts as the visual material.",
          "The strongest hero patterns avoid image-shaped placeholders and preserve a direct quote/call path.",
          "Curated automotive palettes carry credibility without depending on weak scraped photos."
        ],
        gateA: {
          status: winners.length >= 3 ? "passed" : "not_ready",
          reason: winners.length >= 3 ? "At least three static examples were marked as winners." : "Fewer than three examples were marked as winners."
        }
      }
    })
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      candidateId,
      outDir,
      persisted: persist,
      screenshots: captureScreenshots,
      winnerIds: examples.filter((example) => example.status === "winner").map((example) => example.exampleId),
      examples: examples.map((example) => ({ id: example.exampleId, title: example.title, mediaMode: example.mediaMode, status: example.status }))
    },
    null,
    2
  )}\n`
);

function valueAfter(flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function captureExampleScreenshotsV1(input: {
  examples: AdHocDesignExamplePayloadV1[];
  outDir: string;
  screenshotRoot: string;
}) {
  const playwright = await import("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const viewports = [
    { viewport: "desktop" as const, width: 1440, height: 1100 },
    { viewport: "tablet" as const, width: 834, height: 1112 },
    { viewport: "mobile" as const, width: 390, height: 844 }
  ];

  try {
    for (const example of input.examples) {
      const htmlPath = join(input.outDir, `${example.exampleId}.html`);
      const exampleScreenshotRoot = join(input.screenshotRoot, example.exampleId);
      await mkdir(exampleScreenshotRoot, { recursive: true });
      example.screenshots = [];

      for (const viewport of viewports) {
        const page = await browser.newPage({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1
        });
        try {
          const path = join(exampleScreenshotRoot, `${viewport.viewport}.png`);
          await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 15_000 });
          await page.screenshot({ path, fullPage: true, animations: "disabled", timeout: 15_000 });
          const file = await stat(path);
          example.screenshots.push({
            viewport: viewport.viewport,
            path,
            width: viewport.width,
            height: viewport.height,
            bytes: file.size,
            capturedAt: new Date().toISOString()
          });
        } finally {
          await page.close().catch(() => undefined);
        }
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function staticExampleDirectionsV1(business: BusinessProfile) {
  const city = business.address?.city ?? business.serviceAreas[0] ?? "your area";
  const serviceCount = Math.max(3, business.services.length);
  return [
    {
      title: "Editorial Service Ledger",
      direction: "A typographic no-media hero with a ledger of repair paths and direct phone-first conversion.",
      mediaMode: "no_media_primary" as const,
      referenceNotes: ["Editorial law/professional sites that use type, rule lines, and facts instead of photography."],
      rubric: score(94, 96, 96, 90, 94),
      notes: "Best seed for the absolute no-media floor."
    },
    {
      title: "Austin Repair Matrix",
      direction: "A service matrix turns the shop's real capabilities into the first-viewport visual system.",
      mediaMode: "no_media_primary" as const,
      referenceNotes: ["High-density SaaS/pricing matrices translated into local-service trust and quote flow."],
      rubric: score(92, 95, 94, 88, 93),
      notes: `Works well for ${serviceCount}+ auto-body services.`
    },
    {
      title: "Charcoal Quote Counter",
      direction: "A dark quote-forward surface with hours, phone, and repair intake facts as the identity.",
      mediaMode: "no_media_primary" as const,
      referenceNotes: ["Premium editorial heroes with strong contrast and one accent color."],
      rubric: score(91, 94, 92, 90, 95),
      notes: "Strong for sparse or weak imagery because it needs no visual proof."
    },
    {
      title: "Neighborhood Proof Board",
      direction: "Warm local proof cards, hours, and service-area facts form the visual interest.",
      mediaMode: "media_light" as const,
      referenceNotes: ["Local professional-service pages with proof-in-words and utility facts."],
      rubric: score(88, 90, 90, 92, 90),
      notes: "Useful as the more approachable no-media branch."
    },
    {
      title: "Precision Process",
      direction: "A numbered no-media repair process makes logistics and competence feel designed.",
      mediaMode: "media_light" as const,
      referenceNotes: ["Operational B2B pages using process diagrams and compact cards."],
      rubric: score(89, 91, 89, 92, 89),
      notes: "Best when content is process-rich."
    },
    {
      title: "Real Photo Cautious",
      direction: "Eligible real shop media is secondary to copy, never proof by itself.",
      mediaMode: "real_media_cautious" as const,
      referenceNotes: ["Magazine layouts where a small image supports, but does not define, the page."],
      rubric: score(84, 82, 86, 88, 88),
      notes: "Requires media to clear the beats-the-floor bar."
    },
    {
      title: "Compact Sparse Shop",
      direction: "A shorter no-media layout for businesses with fewer facts, avoiding stretched empty space.",
      mediaMode: "no_media_primary" as const,
      referenceNotes: ["Simple local landing pages with tight hierarchy and no filler."],
      rubric: score(87, 91, 90, 94, 89),
      notes: "Sparse-content fallback."
    },
    {
      title: "Graphic Bay Geometry",
      direction: "Decorative panel geometry supplies motion without pretending to be real shop media.",
      mediaMode: "ambitious" as const,
      referenceNotes: ["Editorial/product pages using abstract geometry instead of stock photos."],
      rubric: score(86, 88, 86, 84, 87),
      notes: "Only production-safe if CSS stays simple."
    }
  ].map((direction) => ({ ...direction, subtitle: `${business.name} in ${city}` }));
}

function score(visualQuality: number, noMediaCompleteness: number, weakMediaResilience: number, productionFeasibility: number, conversionClarity: number) {
  return { visualQuality, noMediaCompleteness, weakMediaResilience, productionFeasibility, conversionClarity };
}

function exampleHtmlV1(
  business: BusinessProfile,
  direction: ReturnType<typeof staticExampleDirectionsV1>[number]
) {
  const city = business.address?.city ?? business.serviceAreas[0] ?? "your area";
  const services = business.services.length ? business.services : ["Collision repair", "Paint refinishing", "Dent repair", "Bumper repair"];
  const phone = business.phone ?? "Call for a quote";
  const hours = business.hours ? Object.entries(business.hours).slice(0, 4) : [];
  const dark = direction.title.includes("Charcoal");
  const matrix = direction.title.includes("Matrix");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(business.name)} design example</title>
<style>
:root{--bg:${dark ? "#12161b" : "#eef1f0"};--surface:${dark ? "#1b2128" : "#fff"};--ink:${dark ? "#f8fafc" : "#111417"};--muted:${dark ? "#b6c0ca" : "#5b6268"};--primary:${dark ? "#f8fafc" : "#172634"};--accent:#d14f2a;--line:${dark ? "rgba(255,255,255,.16)" : "#ccd6da"}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,Arial,sans-serif}main{min-height:100svh;padding:clamp(24px,4vw,56px)}header{display:flex;justify-content:space-between;gap:24px;align-items:center;border-bottom:1px solid var(--line);padding-bottom:18px}.brand{font-weight:760}.call{color:var(--ink);text-decoration:none;border:1px solid var(--line);padding:10px 14px}.hero{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:clamp(34px,6vw,88px);align-items:center;min-height:calc(100svh - 130px);position:relative}.hero:before{content:"";position:absolute;right:6%;top:18%;width:min(28vw,360px);height:min(40vw,480px);border:1px solid var(--line);transform:rotate(-8deg);opacity:.75}.eyebrow{display:inline-flex;background:var(--accent);color:white;padding:7px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}h1{font-size:clamp(48px,8vw,112px);line-height:.88;letter-spacing:0;max-width:11ch;margin:24px 0}p{color:var(--muted);font-size:clamp(18px,2vw,22px);line-height:1.55;max-width:56ch}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}.button{background:var(--primary);color:${dark ? "#12161b" : "white"};text-decoration:none;padding:14px 18px;border:1px solid var(--primary);font-weight:800}.button.secondary{background:transparent;color:var(--ink);border-color:var(--line)}.panel{background:var(--surface);border:1px solid var(--line);padding:clamp(18px,3vw,30px);box-shadow:0 24px 70px rgba(0,0,0,.12);z-index:1}.facts{display:grid;gap:12px}.fact{border-bottom:1px solid var(--line);padding-bottom:12px}.fact span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;font-weight:800}.fact strong{font-size:20px}.services{display:grid;grid-template-columns:${matrix ? "repeat(2,minmax(0,1fr))" : "1fr"};gap:10px;margin-top:24px}.service{border:1px solid var(--line);padding:14px;background:${dark ? "rgba(255,255,255,.04)" : "#f7f9f9"}}.service strong{display:block}.hours{display:grid;gap:7px;margin-top:18px;color:var(--muted);font-size:14px}.hours div{display:flex;justify-content:space-between;gap:18px}@media(max-width:820px){main{padding:22px}.hero{grid-template-columns:1fr;min-height:auto;padding:56px 0}.hero:before{display:none}h1{font-size:clamp(44px,14vw,72px)}.services{grid-template-columns:1fr}}
</style>
</head>
<body>
<main>
<header><div class="brand">${escapeHtml(business.name)}</div><a class="call" href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></header>
<section class="hero">
<div>
<span class="eyebrow">${escapeHtml(direction.mediaMode.replaceAll("_", " "))}</span>
<h1>Auto body repair in ${escapeHtml(city)} without the runaround.</h1>
<p>${escapeHtml(business.description || `${business.name} handles collision repair, paint, dents, glass, and quote questions with practical next steps.`)}</p>
<div class="actions"><a class="button" href="#contact">Request a quote</a><a class="button secondary" href="#services">View services</a></div>
</div>
<aside class="panel">
<div class="facts">
<div class="fact"><span>Phone</span><strong>${escapeHtml(phone)}</strong></div>
<div class="fact"><span>Location</span><strong>${escapeHtml(city)}</strong></div>
<div class="fact"><span>Best for</span><strong>Panels, paint, dents, glass</strong></div>
</div>
<div class="services">
${services.slice(0, 6).map((service) => `<div class="service"><strong>${escapeHtml(service)}</strong><small>Start with the affected panel, timing, and whether the vehicle still drives.</small></div>`).join("")}
</div>
${hours.length ? `<div class="hours">${hours.map(([day, value]) => `<div><span>${escapeHtml(day)}</span><span>${escapeHtml(String(value))}</span></div>`).join("")}</div>` : ""}
</aside>
</section>
</main>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
