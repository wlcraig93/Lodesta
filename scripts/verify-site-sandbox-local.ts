import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import { requiredDestinationsSource } from "../workers/site-sandbox/src/initial-source";
import {
  directionsHrefForLocation,
  formatLocalHoursValue,
  formatLocalAddress,
  summarizedLocationHours
} from "../workers/site-sandbox/scaffold/platform/presentation";
import { removeReactImagePreloads } from "../workers/site-sandbox/scaffold/platform/preloads";
import {
  assertRenderedRouteBodies,
  assertValidRoutePaths
} from "../workers/site-sandbox/scaffold/platform/route-contract";

const scaffold = resolve("workers/site-sandbox/scaffold");
const workspace = await mkdtemp(join(tmpdir(), "lodesta-multifile-sandbox-"));
const input = buildSyntheticSiteInput("site-runtime-v4");
input.business.assets.push({
  assetId: "asset_hero",
  revisionId: "asset_revision_hero",
  kind: "photo",
  contentHash: `sha256:${"9".repeat(64)}`,
  storageKey: "site-assets/business_synthetic/hero",
  mimeType: "image/jpeg",
  alt: "Technician inspecting a vehicle panel",
  width: 1440,
  height: 900,
  origin: "owner_upload",
  sourceFactIds: [],
  activeForFutureBuilds: true
});
input.assetRevisionIds.push("asset_revision_hero");
input.business.links.push({
  id: "link_customer_portal",
  kind: "other",
  label: "Customer Login",
  url: "https://synthetic.fieldportals.com/",
  publicEligible: true,
  sourceFactIds: []
});
const files = [
  {
    path: "src/site.tsx",
    content: `import { Asset, BusinessAddress, BusinessHours, BusinessName, DirectionsLink, Fact, LeadForm } from "#lodesta-sdk";
import { LocalIntro } from "./components/LocalIntro";
import { NavigationFixtures } from "./components/NavigationFixtures";
import { PageShell } from "./components/PageShell";
function HomePage(){ return <PageShell><main><LocalIntro /><h1><BusinessName /></h1><Fact id="fact_phone" /><BusinessHours locationId="location_primary" /><BusinessHours locationId="location_primary" variant="weekly" /><BusinessAddress locationId="location_primary" /><DirectionsLink locationId="location_primary">Get directions</DirectionsLink><div className="gallery"><figure><Asset id="asset_hero" loading="eager" fetchPriority="high" /></figure></div><details><summary>Service details</summary><p>Native disclosure content.</p></details><LeadForm id="${input.forms[0]?.id}" /><NavigationFixtures /></main></PageShell>; }
function AboutPage(){ return <PageShell><main><h1>About <BusinessName /></h1></main></PageShell>; }
export const siteDefinition = {
  routes: [
    { path: "/", element: <HomePage /> },
    { path: "/about", title: "About", element: <AboutPage /> }
  ]
};`
  },
  { path: "src/styles.css", content: ":root{--site-color-background:#fff;--site-color-text:#111;--site-color-accent:#176b5b;--site-space-4:1rem;--site-content-width:72rem;--site-radius-md:.5rem;--site-shadow-md:0 1rem 2rem #0002;--site-motion-standard:180ms}html{scroll-behavior:smooth}body{margin:0;color:var(--site-color-text);background:var(--site-color-background);font:16px Arial,sans-serif}" },
  { path: "src/required-destinations.tsx", content: requiredDestinationsSource(input) },
  { path: "src/components/LocalIntro.tsx", content: `import { BusinessName } from "#lodesta-sdk"; export function LocalIntro(){ return <p className="intro">Multi-file component rendered for <BusinessName />.</p>; }` },
  { path: "src/components/PageShell.tsx", content: `import type { ReactNode } from "react"; import { SiteFooter } from "./SiteFooter"; import { SiteHeader } from "./SiteHeader"; export function PageShell({children}:{children:ReactNode}){ return <><SiteHeader />{children}<SiteFooter /></>; }` },
  { path: "src/components/SiteHeader.tsx", content: `import { BusinessName } from "#lodesta-sdk"; import { MobileNavigation } from "./MobileNavigation"; export function SiteHeader(){ return <header><a href="/"><BusinessName /></a><MobileNavigation><a href="/">Home</a><a href="/about">About</a></MobileNavigation></header>; }` },
  { path: "src/components/MobileNavigation.tsx", content: `import type { ReactNode } from "react"; import { NavigationDisclosure } from "#lodesta-sdk"; import { RequiredDestinations } from "../required-destinations"; export function MobileNavigation({children}:{children:ReactNode}){ return <NavigationDisclosure id="primary-navigation" label="Primary" behavior="modal" className="site-mobile-navigation" toggleClassName="site-mobile-navigation__toggle" panelClassName="site-mobile-navigation__panel" trigger={<span aria-hidden="true">Menu</span>}>{children}<RequiredDestinations /></NavigationDisclosure>; }` },
  { path: "src/components/SiteFooter.tsx", content: `import { BusinessName } from "#lodesta-sdk"; export function SiteFooter(){ return <footer>Visit <BusinessName /></footer>; }` },
  { path: "src/components/NavigationFixtures.tsx", content: `import { NavigationDisclosure } from "#lodesta-sdk"; export function NavigationFixtures(){ return <NavigationDisclosure id="inline-navigation" label="Secondary" behavior="inline" trigger={<span>Menu choices</span>}><a href="/about">About</a></NavigationDisclosure>; }` },
  { path: "src/components/local-intro.css", content: ".intro{color:var(--site-color-accent);font-weight:700;letter-spacing:.01em}" },
  { path: "src/components/mobile-navigation.css", content: ".site-mobile-navigation{display:block}.site-mobile-navigation__toggle{display:grid;place-items:center}.site-mobile-navigation__panel{padding:2rem}" }
];

try {
  await Promise.all([
    cp(join(scaffold, "platform"), join(workspace, "platform"), { recursive: true }),
    cp(join(scaffold, "package.json"), join(workspace, "package.json")),
    cp(join(scaffold, "tsconfig.json"), join(workspace, "tsconfig.json")),
    cp(join(scaffold, "vite.config.ts"), join(workspace, "vite.config.ts")),
    cp(join(scaffold, "component-manifest.ts"), join(workspace, "component-manifest.ts")),
    cp(join(scaffold, "lodesta-manifest.json"), join(workspace, "lodesta-manifest.json"))
  ]);
  await symlink(join(scaffold, "node_modules"), join(workspace, "node_modules"), "dir");
  await mkdir(join(workspace, ".lodesta"), { recursive: true });
  await writeFile(join(workspace, ".lodesta", "public-build-input.json"), JSON.stringify(input));
  const policyInput = join(workspace, "source-policy-input.json");
  await writeFile(policyInput, JSON.stringify({ files, runtimeSeriesId: "site-runtime-v4" }));
  await execute(join(workspace, "node_modules", ".bin", "tsx"), ["platform/validate-source.ts", policyInput], workspace);
  for (const file of files) {
    const target = join(workspace, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  await execute(join(workspace, "node_modules", ".bin", "tsx"), ["platform/build.tsx"], workspace);
  const artifact = JSON.parse(await readFile(join(workspace, "dist", "lodesta-artifact.json"), "utf8")) as {
    kind?: string;
    compilerManifest?: Record<string, unknown>;
    sharedCss?: string;
    routes?: Array<{ path?: string; title?: string; description?: string; bodyHtml?: string }>;
    capabilityBindings?: unknown[];
  };
  const livePreviewHtml = await readFile(join(workspace, "dist", "index.html"), "utf8");
  assert.equal(artifact.kind, "agent-authored-artifact", "sandbox did not emit the canonical artifact contract");
  assert.deepEqual(artifact.compilerManifest, expectedSiteSandboxManifest, "artifact omitted or drifted from the actual compiler manifest");
  assert(!Object.hasOwn(artifact, "factDeclarations") && !Object.hasOwn(artifact, "claims"), "sandbox retained model-authored declarations");
  assert.deepEqual(artifact.capabilityBindings, [{
    id: "capability_form___1",
    kind: "form",
    route: "/",
    config: { formId: "form_estimate" }
  }], "compiler did not derive SDK capabilities from rendered markup");
  assert(!JSON.stringify(artifact.capabilityBindings).match(/gallery|disclosure|map/), "Canonical compiler emitted a removed managed binding for static gallery, native details, or directions.");
  assert(artifact.sharedCss?.includes(".intro{color:var(--site-color-accent)"), "nested CSS module was not included in the artifact");
  assert(artifact.sharedCss?.includes("--site-color-accent:#176b5b"), "the site-local design token root was not retained");
  assert(artifact.sharedCss?.includes("color:var(--site-color-accent)"), "component CSS did not consume the site-local token system");
  assert(artifact.sharedCss?.includes(".site-mobile-navigation"), "authored mobile-navigation CSS was not compiled");
  assert(!artifact.sharedCss?.includes("--lodesta-navigation-top"), "authored source unexpectedly supplied platform modal containment");
  assert(livePreviewHtml.includes("--lodesta-navigation-top"), "live workspace preview did not use active scaffold modal containment");
  assert(livePreviewHtml.includes(".site-mobile-navigation__panel{padding:2rem}"), "live workspace preview lost authored panel presentation");
  assert.equal(artifact.routes?.length, 2, "the shared-component fixture did not compile both routes");
  assert.equal(artifact.routes?.[0]?.title, input.business.name, "compiler did not supply the canonical fallback title");
  assert.equal(artifact.routes?.[0]?.description, `${input.business.name}.`, "compiler did not supply the canonical fallback description");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("Multi-file component rendered for"), "local TSX module was not rendered");
  const routeHeaders = artifact.routes?.map((route) => route.bodyHtml?.match(/<header>[\s\S]*?<\/header>/)?.[0]);
  const routeFooters = artifact.routes?.map((route) => route.bodyHtml?.match(/<footer>[\s\S]*?<\/footer>/)?.[0]);
  assert(routeHeaders?.every((header) => header === routeHeaders[0]), "ordinary routes did not render the same shared SiteHeader source component");
  assert(routeFooters?.every((footer) => footer === routeFooters[0]), "ordinary routes did not render the same shared SiteFooter source component");
  assert(artifact.routes?.[0]?.bodyHtml?.includes('data-lodesta-navigation-behavior="modal"'), "NavigationDisclosure did not retain its required modal behavior");
  assert(!artifact.routes?.[0]?.bodyHtml?.includes('data-lodesta-navigation-icon=""'), "Canonical NavigationDisclosure injected platform trigger artwork");
  assert(artifact.routes?.[0]?.bodyHtml?.includes('aria-label="Open navigation"'), "NavigationDisclosure omitted its default accessible label");
  assert(artifact.routes?.[0]?.bodyHtml?.includes('data-lodesta-navigation-behavior="inline"'), "NavigationDisclosure did not retain an owner-selected inline behavior");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("Menu choices"), "NavigationDisclosure did not retain a custom visible trigger");
  assert(artifact.routes?.[0]?.bodyHtml?.includes('href="https://synthetic.fieldportals.com/"'), "The materialized customer portal was not structurally seeded into mobile navigation.");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("(512) 555-0142"), "compiler did not render the canonical formatted phone");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("Monday–Friday: 8:00 AM-5:30 PM"), "compiler did not render a compact source-bound hours summary");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("<dt>Monday</dt><dd>8:00 AM-5:30 PM</dd>"), "compiler did not render structured weekly hours");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("1200 Main Street, Austin, TX 78701"), "compiler did not render the natural US address variant");
  assert(artifact.routes?.[0]?.bodyHtml?.includes('data-lodesta-location-id="location_primary"'), "BusinessAddress did not retain its SDK-owned location identity.");
  assert(artifact.routes?.[0]?.bodyHtml?.includes('href="https://www.google.com/maps/dir/?api=1&amp;destination=1200%20Main%20Street%2C%20Austin%2C%20TX%2C%2078701%2C%20US"'), "DirectionsLink did not encode the retained canonical address.");
  assert(artifact.routes?.[0]?.bodyHtml?.includes('target="_blank" rel="noopener noreferrer" data-lodesta-directions=""'), "DirectionsLink did not apply secure default target behavior and analytics marker.");
  assert(!artifact.routes?.[0]?.bodyHtml?.includes(", US"), "compiler leaked a trailing country code into the local address variant");
  assert(artifact.routes?.[0]?.bodyHtml?.includes('loading="eager"'), "Asset did not preserve explicit eager loading.");
  assert(artifact.routes?.[0]?.bodyHtml?.includes('fetchPriority="high"'), "Asset did not preserve explicit fetch priority.");
  assert(!artifact.routes?.[0]?.bodyHtml?.includes("<link"), "React image preload markup leaked into route body HTML.");
  for (const preload of [
    `<link rel="preload" as="image" href="asset://asset_hero"/>`,
    `<link fetchPriority="high" href="asset://asset_hero" as="image" rel="preload">`,
    `<link imagesrcset="asset://asset_hero 1x" as="image" rel="preload" href="asset://asset_hero"/>`
  ]) {
    assert.equal(removeReactImagePreloads(`before${preload}after`), "beforeafter", `Asset image preload was not removed: ${preload}`);
  }
  for (const unrelated of [
    `<link rel="stylesheet" href="/site.css">`,
    `<link rel="preload" as="font" href="asset://asset_hero">`,
    `<link rel="preload" as="image" href="https://example.com/hero.jpg">`
  ]) {
    assert.equal(removeReactImagePreloads(unrelated), unrelated, `Unrelated link was removed: ${unrelated}`);
  }
  assert.doesNotThrow(
    () => assertValidRoutePaths([{ path: "/" }, { path: "/services" }]),
    "The sandbox route contract rejected a valid unique homepage and service route."
  );
  assert.doesNotThrow(
    () => assertRenderedRouteBodies([{ path: "/", bodyHtml: "<main>Home</main>" }]),
    "The sandbox route contract rejected rendered route HTML."
  );
  assert.throws(
    () => assertRenderedRouteBodies([{ path: "/", bodyHtml: "" }]),
    /element: <PageComponent \/>/,
    "The sandbox build accepted an empty rendered route."
  );
  assert.throws(
    () => assertValidRoutePaths([{ path: "/" }, { path: "/services" }, { path: "/services" }]),
    /Duplicate route \/services/,
    "The sandbox build accepted duplicate normalized route paths."
  );
  assert.throws(
    () => assertValidRoutePaths([{ path: "/services" }]),
    /homepage route at \//,
    "The sandbox build accepted a route set without a homepage."
  );
  assert.throws(
    () => assertValidRoutePaths([{ path: "/" }, { path: "/*" }]),
    /not a static site path/,
    "The sandbox build accepted a wildcard route that cannot become an immutable artifact path."
  );
  const retainedLegacyRouteStartedAt = performance.now();
  assert.doesNotThrow(
    () => assertValidRoutePaths([{
      path: "/"
    }, {
      path: "/blog/2025/february/what-is-the-best-way-to-get-rid-of-rodents-"
    }, {
      path: "/store/p/-plated-daily-serum"
    }]),
    "The sandbox build rejected a retained legacy route with a leading or trailing hyphen."
  );
  assert(
    performance.now() - retainedLegacyRouteStartedAt < 1_000,
    "Long retained route validation regressed to catastrophic backtracking."
  );
  assert.doesNotThrow(
    () => assertValidRoutePaths([{ path: "/" }, { path: "/about-us.html" }]),
    "The sandbox route contract rejected a safe legacy HTML route approved by architecture."
  );
  assert.throws(
    () => assertValidRoutePaths([{ path: "/" }, { path: "/payload.exe" }]),
    /not a static site path/,
    "The sandbox route contract admitted an unsupported file-like route."
  );
  assert.throws(
    () => assertValidRoutePaths([{ path: "/" }, { path: "/store/---" }]),
    /not a static site path/,
    "The sandbox route contract admitted a slug segment without an alphanumeric character."
  );
  await writeFile(join(workspace, "src/site.tsx"), `export const siteDefinition = {
    routes: [
      { path: "/services", element: <main>One</main> },
      { path: "/services", element: <main>Two</main> }
    ]
  };`);
  await assert.rejects(
    () => execute(join(workspace, "node_modules", ".bin", "tsx"), ["platform/build.tsx"], workspace),
    /Duplicate route \/services/,
    "The integrated sandbox compiler emitted an artifact with duplicate normalized routes."
  );
  await writeFile(join(workspace, "src/site.tsx"), `function HomePage() { return <main>Home</main>; }
  export const siteDefinition = {
    routes: [{ path: "/", component: HomePage }]
  };`);
  await assert.rejects(
    () => execute(join(workspace, "node_modules", ".bin", "tsx"), ["platform/build.tsx"], workspace),
    /Route \/ rendered no HTML.*element: <PageComponent \/>/,
    "The integrated sandbox compiler silently accepted a component reference that rendered an empty route."
  );
  assert.throws(
    () => formatLocalAddress({ street: "1 King St", city: "Toronto", region: "ON", postalCode: "M5H 1A1", country: "CA" }),
    /supports US locations only/,
    "The local address formatter silently rendered a non-US address."
  );
  assert.equal(
    formatLocalAddress({ street: "3300 Bennett St. N.,", city: "St. Petersburg", region: "FL", postalCode: "33713", country: "US" }),
    "3300 Bennett St. N., St. Petersburg, FL 33713",
    "The local address formatter preserved source punctuation that duplicates its presentation separator."
  );
  assert.equal(
    directionsHrefForLocation({ label: "Geiger's", street: "3300 Bennett St. N.,", city: "St. Petersburg", region: "FL", postalCode: "33713", country: "US" }),
    "https://www.google.com/maps/dir/?api=1&destination=3300%20Bennett%20St.%20N.%2C%20St.%20Petersburg%2C%20FL%2C%2033713%2C%20US",
    "The managed directions URL preserved source punctuation that duplicates its address separator."
  );
  assert.equal(
    summarizedLocationHours({ Monday: "Open", Wednesday: "Open" }),
    "Monday: Open; Wednesday: Open",
    "Compact hours formatting combined non-contiguous days into a false range."
  );
  assert.equal(
    formatLocalHoursValue("08:00-17:00"),
    "8 AM–5 PM",
    "Canonical 24-hour storage values were exposed as customer-facing military time."
  );
  assert.equal(
    formatLocalHoursValue("09:30–00:00"),
    "9:30 AM–12 AM",
    "Canonical local times were not converted across noon and midnight."
  );
  assert.equal(
    formatLocalHoursValue("By appointment"),
    "By appointment",
    "Non-clock availability text was rewritten."
  );
  process.stdout.write(`${JSON.stringify({ ok: true, sourceFiles: files.length, sdkAlias: "pass", automaticJsx: "pass", v4SdkBoundary: "pass", localImports: "pass", nestedCss: "pass" })}\n`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function execute(command: string, args: string[], cwd: string) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", rejectPromise);
    child.once("exit", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`Command failed (${code}): ${stderr || stdout}`)));
  });
}
