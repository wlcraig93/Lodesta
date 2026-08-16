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
  routes: routes.map((item) => ({ path: item.path, title: item.title, html: item.bodyHtml })),
  sourcePaths: ["/", "/services", "/services/ants", "/services/rodents", "/contact"]
});
assert.equal(ia.report.liveRouteCount, 6);
assert.equal(ia.report.newRouteCount, 1);
assert.deepEqual(ia.report.unreachableFromHome, ["/faq"]);
assert(ia.findings.length <= 3);
assert(ia.findings.every((finding) => finding.severity !== "error"));

const [workflow, manager, skills, worker, nativeSdk, v4Sdk, canaryRoute] = await Promise.all([
  readFile("packages/site-platform/workflow.ts", "utf8"),
  readFile("packages/site-agent/manager.ts", "utf8"),
  readFile("packages/site-agent/skills.ts", "utf8"),
  readFile("workers/site-sandbox/src/index.ts", "utf8"),
  readFile("workers/site-sandbox/scaffold/platform/sdk-native.tsx", "utf8"),
  readFile("workers/site-sandbox/scaffold/platform/sdk-v4.tsx", "utf8"),
  readFile("app/api/admin/site-authoring-canaries/route.ts", "utf8")
]);
assert.match(workflow, /run\.kind === "initial_build"[\s\S]*prepareInitialArchitecture/);
assert.doesNotMatch(workflow, /initialBuildProfile\?\.initialBuildScope/);
assert.doesNotMatch(workflow, /architectureInventory:/);
assert.match(skills, /Preserve every existing workspace source file unconditionally/);
assert.match(skills, /MobileNavigation and ManagedLeadForm recipes/);
assert.match(workflow, /Older authoring format—full rebuild required/);
assert.match(workflow, /canonicalSiteAuthoringRuntimeSeriesId/);
assert.match(workflow, /olderAuthoringRevision \|\| run\.kind === "initial_build"/);
assert.match(worker, /runtimeSeriesId !== "site-runtime-v4"[\s\S]*unsupported_authoring_runtime_series/);
assert.match(worker, /"#lodesta-sdk": "\.\/platform\/sdk-v4\.tsx"/);
assert.doesNotMatch(worker, /"#lodesta-sdk"[\s\S]{0,300}sdk-native\.tsx/);
assert.doesNotMatch(nativeSdk, /NavigationDisclosure/);
assert.match(v4Sdk, /NavigationDisclosure/);
assert.doesNotMatch(v4Sdk, /LeadLabel|LeadControl/);
assert.match(canaryRoute, /generator: "canonical"/);
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
