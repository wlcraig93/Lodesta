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
assert.match(skills, /three-bar closed trigger.*distinct close state/i);
assert.match(skills, /never collapse multiple bars onto one coordinate/i);
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
assert(workflow.includes("preferredRouteLimit: 4")
  && workflow.includes("browserRoutePaths: input.releasePlan?.browserRoutePaths")
  && !workflow.includes("all-representative-routes")
  && !authoringProfile.includes("all-representative-routes"),
"The authoring loop must retain its all-route mechanical pass while limiting the separate model-facing visual pass to four representative routes.");
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
