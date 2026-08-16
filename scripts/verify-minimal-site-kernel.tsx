import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSiteRuntimeBytes } from "../packages/trusted-runtime";
import { directionsHrefForLocation } from "../workers/site-sandbox/scaffold/platform/presentation";
import { platformCapabilityStylesFor } from "../workers/site-sandbox/scaffold/platform/capability-styles";
import { validateWorkspaceSourcePolicy } from "../workers/site-sandbox/scaffold/platform/source-policy";

assert.equal(directionsHrefForLocation({
  label: "Downtown office",
  street: "12 Main & Market",
  city: "Austin",
  region: "TX",
  postalCode: "78701",
  country: "US"
}), "https://www.google.com/maps/dir/?api=1&destination=12%20Main%20%26%20Market%2C%20Austin%2C%20TX%2C%2078701%2C%20US");
assert.equal(directionsHrefForLocation({ label: "North office" }), "https://www.google.com/maps/dir/?api=1&destination=North%20office");
const [sdkSource, nativeSdkSource, v4SdkSource, auditedRuntimeSource, workflowSource, browserGateSource, previewSource, operatorRuntimeSource, publicRuntimeRouteSource] = await Promise.all([
  readFile("workers/site-sandbox/scaffold/platform/sdk.tsx", "utf8"),
  readFile("workers/site-sandbox/scaffold/platform/sdk-native.tsx", "utf8"),
  readFile("workers/site-sandbox/scaffold/platform/sdk-v4.tsx", "utf8"),
  readFile("packages/trusted-runtime/site-runtime-v1.js", "utf8"),
  readFile("packages/site-platform/workflow.ts", "utf8"),
  readFile("packages/site-verification/browser-gate.ts", "utf8"),
  readFile("app/api/site-agent/sessions/[sessionId]/preview/[[...path]]/route.ts", "utf8"),
  readFile("app/api/operator/runtime/route.ts", "utf8"),
  readFile("app/%5Flodesta/runtime/[file]/route.ts", "utf8")
]);
assert.match(sdkSource, /Unknown location \$\{locationId\}/);
assert.match(sdkSource, /rel=\{target === "_blank" \? "noopener noreferrer" : undefined\}/);
assert.match(sdkSource, /data-lodesta-directions=""/);
assert.doesNotMatch(sdkSource, /export function (?:ManagedMap|Gallery|Disclosure)\b/);
assert.match(sdkSource, /behavior: "modal" \| "inline";/);
assert.doesNotMatch(nativeSdkSource, /NavigationDisclosure/);
assert.match(v4SdkSource, /export function NavigationDisclosure/);
assert.match(v4SdkSource, /trigger: ReactNode/);
assert.doesNotMatch(v4SdkSource, /LeadLabel|LeadControl/);

const [legacyRuntime, canonicalRuntime, nativeRuntime, headlessRuntime] = await Promise.all([
  buildSiteRuntimeBytes("site-runtime-v1"),
  buildSiteRuntimeBytes("site-runtime-v2"),
  buildSiteRuntimeBytes("site-runtime-v3"),
  buildSiteRuntimeBytes("site-runtime-v4")
]);
assert.equal(legacyRuntime.toString("utf8"), auditedRuntimeSource, "Legacy audited runtime bytes changed during canonical runtime creation");
assert.notEqual(canonicalRuntime.toString("utf8"), auditedRuntimeSource);
assert.match(canonicalRuntime.toString("utf8"), /isNavigationRendered/);
assert.doesNotMatch(canonicalRuntime.toString("utf8"), /data-lodesta-gallery-direction/);
assert.doesNotMatch(nativeRuntime.toString("utf8"), /data-lodesta-menu-toggle|data-lodesta-navigation|data-lodesta-gallery-direction/);
assert.match(nativeRuntime.toString("utf8"), /form\[data-lodesta-form-id\]/);
assert.match(nativeRuntime.toString("utf8"), /observeWebVitals\(\)/);
assert.match(nativeRuntime.toString("utf8"), /data-lodesta-directions/);
assert.match(headlessRuntime.toString("utf8"), /site-runtime-v4: managed behavior without platform presentation/);
assert.match(headlessRuntime.toString("utf8"), /data-lodesta-menu-toggle/);
assert.notEqual(headlessRuntime.toString("utf8"), canonicalRuntime.toString("utf8"));
const v4Styles = platformCapabilityStylesFor("site-runtime-v4");
assert.match(v4Styles, /navigation-panel.*hidden/s);
assert.doesNotMatch(v4Styles, /navigation-icon|position:|inset:|height:|width:|background:|color:/);
const formRuntimeMarker = '  for (const form of document.querySelectorAll("form[data-lodesta-form-id]")) {';
assert.equal(
  nativeRuntime.toString("utf8").slice(nativeRuntime.toString("utf8").indexOf(formRuntimeMarker)),
  canonicalRuntime.toString("utf8").slice(canonicalRuntime.toString("utf8").indexOf(formRuntimeMarker)),
  "The native runtime changed managed forms or telemetry while removing presentation behavior"
);
assert.doesNotMatch(workflowSource, /const runtimeSeriesId = "site-runtime-v1"/);
assert.match(workflowSource, /input\.buildInput\.capabilityConfiguration\.trustedRuntimeSeries/);
assert.match(workflowSource, /runtimeSource = await this\.readAuditedRuntimePatch/);
assert.match(browserGateSource, /runtimeSource\?: Buffer/);
assert.match(previewSource, /getPublicBuildInput\(session\.publicBuildInputId\)/);
assert.doesNotMatch(previewSource, /site-runtime-v1/);
assert.match(operatorRuntimeSource, /seriesId: seriesIdSchema/);
assert.match(operatorRuntimeSource, /valid seriesId query parameter is required/);
assert.match(publicRuntimeRouteSource, /getRuntimeSeries\(seriesId\)/);

const sourceFiles = (content: string) => [
  { path: "src/site.tsx", content },
  { path: "src/styles.css", content: ".content{display:block}" }
];
assert(validateWorkspaceSourcePolicy(sourceFiles(
  `export const siteDefinition={routes:[{path:"/",element:<main data-lodesta-map="location">Forged</main>}]};`
)).some((finding) => finding.id === "source.reserved_kernel_attribute"));
assert.deepEqual(validateWorkspaceSourcePolicy(sourceFiles(
  `export const siteDefinition={routes:[{path:"/",element:<main><a href="/contact" data-lodesta-conversion="primary">Contact</a><details><summary>Question</summary><p>Answer</p></details></main>}]};`
)), []);
assert(validateWorkspaceSourcePolicy(sourceFiles(
  `import { NavigationDisclosure } from "#lodesta-sdk"; export const siteDefinition={routes:[{path:"/",element:<NavigationDisclosure id="nav" behavior="inline"><a href="/">Home</a></NavigationDisclosure>}]};`
), { runtimeSeriesId: "site-runtime-v3" }).some((finding) => finding.id === "source.sdk_export"));
assert.deepEqual(validateWorkspaceSourcePolicy(sourceFiles(
  `export const siteDefinition={routes:[{path:"/",element:<header><button popoverTarget="menu">Menu</button><nav id="menu" popover="auto"><a href="/">Home</a></nav></header>}]};`
), { runtimeSeriesId: "site-runtime-v3" }), []);
assert(validateWorkspaceSourcePolicy(sourceFiles(
  `import { LeadLabel } from "#lodesta-sdk"; export const siteDefinition={routes:[{path:"/",element:<main><LeadLabel id="name" /></main>}]};`
), { runtimeSeriesId: "site-runtime-v4" }).some((finding) => finding.id === "source.sdk_export"));
assert(validateWorkspaceSourcePolicy([
  ...sourceFiles(`export const siteDefinition={routes:[{path:"/",element:<main>Ready</main>}]};`),
  { path: "src/legacy.tsx", content: `import { LeadControl } from "../platform/sdk"; export const legacy = LeadControl;` }
], { runtimeSeriesId: "site-runtime-v4" }).some((finding) => finding.id === "source.import_module"));
assert.deepEqual(validateWorkspaceSourcePolicy(sourceFiles(
  `import { NavigationDisclosure } from "#lodesta-sdk"; export const siteDefinition={routes:[{path:"/",element:<NavigationDisclosure id="nav" behavior="modal" trigger={<span>Menu</span>}><a href="/">Home</a></NavigationDisclosure>}]};`
), { runtimeSeriesId: "site-runtime-v4" }), []);

console.log(JSON.stringify({ ok: true, directions: "pass", fallback: "pass", targetSecurity: "pass", sourcePolicy: "pass" }));
