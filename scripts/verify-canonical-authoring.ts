import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildInformationArchitectureAdvisory } from "../packages/site-verification";
import { selectArtifactReviewRoutePaths } from "../packages/website-assessment/route-selection";

const routes = [
  route("/", "Home", "Primary business homepage", ["/services", "/contact"]),
  route("/services", "Services", "Service overview", ["/services/ants", "/services/rodents"]),
  route("/services/ants", "Ant control", "Detailed ant treatment information", ["/contact"]),
  route("/services/rodents", "Rodent control", "Detailed rodent treatment information", ["/contact"]),
  route("/contact", "Contact", "Request an estimate", []),
  route("/faq", "FAQ", "Frequently asked questions", [])
];
const requirements = [
  { slug: null, purpose: "home" },
  { slug: "services", purpose: "services" },
  { slug: "services/ants", purpose: "service_detail" },
  { slug: "services/rodents", purpose: "service_detail" },
  { slug: "contact", purpose: "contact" },
  { slug: "faq", purpose: "faq" }
];
const reviewRoutes = selectArtifactReviewRoutePaths(routes, requirements);
assert.deepEqual(reviewRoutes, ["/", "/services", "/services/ants", "/contact"]);

const ia = buildInformationArchitectureAdvisory({
  routes: routes.map((item) => ({ path: item.path, title: item.title, description: item.description, html: item.bodyHtml })),
  sourcePaths: ["/", "/services", "/services/ants", "/services/rodents", "/contact"]
});
assert.equal(ia.report.liveRouteCount, 6);
assert.equal(ia.report.newRouteCount, 1);
assert.deepEqual(ia.report.unreachableFromHome, ["/faq"]);
assert.equal(ia.report.routeWordCounts.length, routes.length);
assert.equal(ia.report.metadataCoverage.titledRoutes, routes.length);
assert.equal(ia.report.metadataCoverage.describedRoutes, routes.length);
assert(ia.findings.length <= 3);
assert(ia.findings.every((finding) => finding.severity !== "error"));

const extensionUtilityEvidence = buildInformationArchitectureAdvisory({
  routes: ["/contact.html", "/image-credit.html", "/privacy-policy.php"].map((path) => ({
    path,
    title: path,
    description: path,
    html: "<main><h1>Utility</h1><p>Concise supported utility content.</p></main>"
  })),
  sourcePaths: ["/contact.html", "/image-credit.html", "/privacy-policy.php"]
});
assert.deepEqual(
  extensionUtilityEvidence.report.suspectedThinRoutes,
  [],
  "Legacy-extension contact, legal, or image-credit utilities were incorrectly reported as thin commercial routes."
);

const wholeInventoryEvidence = buildInformationArchitectureAdvisory({
  routes: ["/services/one", "/services/two", "/services/three"].map((path, index) => ({
    path,
    title: `Service ${index + 1}`,
    description: `Distinct description ${index + 1}`,
    html: `<main><img src="/_lodesta/assets/shared-photo"><p>${"concrete customer answer ".repeat(50)}${index === 1 ? " Source website" : ""}${index === 2 ? " 12:00 AM–11:59 PM" : ""}</p></main>`
  })),
  sourcePaths: ["/services/one", "/services/two", "/services/three"]
});
assert.equal(wholeInventoryEvidence.report.distinctMainImageCount, 1);
assert.equal(wholeInventoryEvidence.report.repeatedOpeningImages[0]?.routes.length, 3);
assert.deepEqual(wholeInventoryEvidence.report.internalArtifactRoutes, ["/services/two"]);
assert.deepEqual(wholeInventoryEvidence.report.rawDataStringRoutes, ["/services/three"]);
assert(wholeInventoryEvidence.findings.some((finding) => finding.id === "advisory.asset_reuse"));

const sharedDetailStructure = (title: string, description: string, tone: string) => `<main class="${tone}-tone"><section class="${tone}-hero"><h1>${title}</h1><p>${description}</p></section><section class="${tone}-guide"><h2>Useful guidance</h2><p>${Array.from({ length: 36 }, (_, index) => `detailword${index}`).join(" ")}</p></section></main>`;
const repeatedSectionWords = Array.from({ length: 36 }, (_, index) => `evidenceword${index}`).join(" ");
const wholeRouteIntegrityEvidence = buildInformationArchitectureAdvisory({
  routes: [
    { path: "/services/bats", title: "Bat control", description: "Bat service", html: sharedDetailStructure("Bat control", "Guidance for bat activity around a building.", "bat") },
    { path: "/services/birds", title: "Bird control", description: "Bird service", html: sharedDetailStructure("Bird control", "Guidance for nuisance birds around a building.", "bird") },
    { path: "/services/rodents", title: "Rodent control", description: "Rodent service", html: sharedDetailStructure("Rodent control", "Guidance for rodent signs inside a building.", "rodent") },
    {
      path: "/about",
      title: "About",
      description: "About the business",
      html: `<main><section><h2>About the work</h2><p>${repeatedSectionWords}</p></section><section><h2>About our work</h2><p>${repeatedSectionWords}</p></section></main>`
    }
  ],
  sourcePaths: ["/services/bats", "/services/birds", "/services/rodents", "/about"]
});
assert.deepEqual(wholeRouteIntegrityEvidence.report.headingCoverage.missingH1Routes, ["/about"]);
assert.deepEqual(
  wholeRouteIntegrityEvidence.report.repeatedMainStructureGroups[0]?.routes,
  ["/services/bats", "/services/birds", "/services/rodents"]
);
assert.equal(wholeRouteIntegrityEvidence.report.adjacentSectionRepetition[0]?.path, "/about");
assert(wholeRouteIntegrityEvidence.findings.some((finding) =>
  finding.id === "advisory.ia_structure"
    && finding.message.includes("/about")
    && finding.message.includes("near-duplicate")));
assert(wholeRouteIntegrityEvidence.findings.some((finding) =>
  finding.id === "advisory.ia_repetition"
    && finding.message.includes("complete main-structure")));

const substantiveCompactRoute = buildInformationArchitectureAdvisory({
  routes: [{
    path: "/service",
    title: "Focused service",
    description: "A concise but substantive customer answer",
    html: `<main><h1>Focused service</h1><section><h2>What to notice</h2><p>${Array.from({ length: 94 }, (_, index) => `useful${index}`).join(" ")}</p></section></main>`
  }],
  sourcePaths: ["/service"]
});
assert.deepEqual(substantiveCompactRoute.report.suspectedThinRoutes, [], "The IA advisory must not induce word-count padding on a substantive compact route.");

const [workflow, manager, managerRuntime, authoringProfile, skills, worker, v4Sdk, canaryRoute] = await Promise.all([
  readFile("packages/site-platform/workflow.ts", "utf8"),
  readFile("packages/site-agent/manager.ts", "utf8"),
  readFile("packages/site-platform/manager-runtime.ts", "utf8"),
  readFile("packages/site-agent/authoring-profile.ts", "utf8"),
  readFile("packages/site-agent/skills.ts", "utf8"),
  readFile("workers/site-sandbox/src/index.ts", "utf8"),
  readFile("workers/site-sandbox/scaffold/platform/sdk-canonical.tsx", "utf8"),
  readFile("app/api/admin/site-authoring-canaries/route.ts", "utf8")
]);
assert.match(workflow, /run\.kind === "initial_build"[\s\S]*prepareInitialArchitecture/);
assert.doesNotMatch(workflow, /initialBuildProfile\?\.initialBuildScope/);
assert.doesNotMatch(workflow, /architectureInventory:/);
assert.match(skills, /Preserve every existing workspace source file unconditionally/);
assert.match(skills, /const knowledgeByKind =/);
assert.match(skills, /blank initial build.*NavigationDisclosure behavior=/);
assert.match(skills, /three-bar closed trigger.*unmistakable close state/i);
assert.match(skills, /closed bars distinct positions/i);
assert.match(skills, /every live route one clear H1/i);
assert.match(skills, /essential controls at least 48px/i);
assert.match(skills, /approvedSourceIndex\.liveRoutePaths as the exact internal-route set/i);
assert.match(skills, /Historical sourcePath values are evidence, not destinations/i);
assert.match(skills, /readable focused route, content, legal, and shared-shell modules from the first write/i);
assert.match(skills, /Never obscure customer-visible text to evade verification/i);
assert.match(skills, /distinct truthful title and description for every route, never one global fallback description/i);
assert.match(skills, /Never apply blank-build design defaults/);
assert.match(skills, /websiteAuthoringSkillIdentityFor\(kind/);
assert.match(workflow, /Older authoring format—full rebuild required/);
assert.match(workflow, /canonicalSiteAuthoringRuntimeSeriesId/);
assert.match(workflow, /olderAuthoringRevision \|\| run\.kind === "initial_build"/);
assert.match(workflow, /const materializedInitialSource = !resumedSandboxSource[\s\S]*this\.sandbox\.getSource\(sandboxState\.session\.sandboxId!\)/,
  "Blank initial builds must materialize the sandbox scaffold into the manager workspace.");
assert.match(workflow, /currentFiles = resumedSandboxSource\?\.files[\s\S]*materializedInitialSource\?\.files[\s\S]*loadWorkspaceSource/,
  "Blank source, resumed source, and retained owner source must share one explicit precedence path.");
assert.doesNotMatch(workflow, /mobile-navigation\.tsx|managed-lead-form\.tsx|classifyRecipeSource/);
assert(workflow.includes("assertMaterializedInitialSource(materializedInitialSource, sandboxState.revision, buildInput)")
  && workflow.includes('files.get("src/required-destinations.tsx")')
  && workflow.includes('"src/site.tsx"')
  && workflow.includes('"src/styles.css"')
  && workflow.includes("missing_required_destination")
  && workflow.includes("materialized_initial_source_invalid")
  && workflow.includes("currentFiles: WorkspaceSourceFile[]"), "Initial source must fail loudly before authoring and every manager invocation must receive an explicit source array.");
assert(managerRuntime.includes("const inspectionToolTimeoutMs = 8 * 60_000")
  && managerRuntime.includes('error: "inspection_timeout"')
  && managerRuntime.includes("recoverable: true")
  && managerRuntime.includes("mechanicalAnalysisMs")
  && managerRuntime.includes("browserNavigationCaptureMs")
  && managerRuntime.includes("contactSheetGenerationMs")
  && managerRuntime.includes("persistenceMs"), "Inspection must retain mechanical feedback and surface the eight-minute ceiling as a recoverable tool failure with phase telemetry.");
assert.match(managerRuntime, /Readability, contrast, form text, essential target size/i);
assert.match(managerRuntime, /Follow the task skill for design and content judgment/i);
assert(workflow.includes("preferredRouteLimit: 5")
  && workflow.includes("defaultRoutes: input.releasePlan?.visualReviewRoutePaths")
  && workflow.includes("createArtifactRouteFamilyContactSheets")
  && workflow.includes("browserRoutePaths: input.releasePlan?.browserRoutePaths")
  && !workflow.includes("all-representative-routes")
  && !authoringProfile.includes("all-representative-routes"),
"The authoring loop must retain its all-route mechanical pass while splitting five architecture-selected review routes into readable family sheets.");
assert.match(worker, /runtimeSeriesId !== "site-runtime-v4"[\s\S]*unsupported_authoring_runtime_series/);
assert.match(worker, /"#lodesta-sdk": "\.\/platform\/sdk-canonical\.tsx"/);
assert.doesNotMatch(worker, /"#lodesta-sdk"[\s\S]{0,300}sdk-native\.tsx/);
assert.match(v4Sdk, /NavigationDisclosure/);
assert.doesNotMatch(v4Sdk, /LeadLabel|LeadControl/);
assert.match(canaryRoute, /generator: "canonical"/);
assert.match(canaryRoute, /const lunaCanaryMaxCostUsd = 0\.50/);
assert.match(canaryRoute, /: lunaCanaryMaxCostUsd/);
assert.doesNotMatch(canaryRoute, /site-runtime-v3|retired_authoring_profile|identity-nav-copy/);

process.stdout.write(`${JSON.stringify({ ok: true, reviewRoutes, iaFindings: ia.findings.length })}\n`);

function route(path: string, title: string, description: string, links: string[]) {
  const body = `${Array.from({ length: 130 }, (_, index) => `useful-${index}`).join(" ")} ${description}`;
  return {
    path,
    title,
    description,
    bodyHtml: `<header><nav>${links.map((href) => `<a href="${href}">${href}</a>`).join("")}</nav></header><main><h1>${title}</h1><p>${body}</p></main><footer>Shared footer</footer>`
  };
}
