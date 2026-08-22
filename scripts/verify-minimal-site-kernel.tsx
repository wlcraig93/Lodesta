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
const [sdkSource, v4SdkSource, auditedRuntimeSource, workflowSource, browserGateSource, previewSource, operatorRuntimeSource, publicRuntimeRouteSource] = await Promise.all([
  readFile("workers/site-sandbox/scaffold/platform/sdk.tsx", "utf8"),
  readFile("workers/site-sandbox/scaffold/platform/sdk-canonical.tsx", "utf8"),
  readFile("packages/trusted-runtime/site-runtime-v4.js", "utf8"),
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
assert.match(v4SdkSource, /export function NavigationDisclosure/);
assert.match(v4SdkSource, /trigger: ReactNode/);
assert.doesNotMatch(v4SdkSource, /LeadLabel|LeadControl/);

const canonicalRuntime = await buildSiteRuntimeBytes("site-runtime-v4");
assert.equal(canonicalRuntime.toString("utf8"), auditedRuntimeSource, "Canonical runtime builder must return the direct audited source.");
assert.match(canonicalRuntime.toString("utf8"), /site-runtime-v4: managed behavior without platform presentation/);
assert.match(canonicalRuntime.toString("utf8"), /data-lodesta-menu-toggle/);
assert.doesNotMatch(canonicalRuntime.toString("utf8"), /data-lodesta-gallery-direction/);
await assert.rejects(() => buildSiteRuntimeBytes("site-runtime-v3"), /only site-runtime-v4 is canonical/);
const v4Styles = platformCapabilityStylesFor("site-runtime-v4");
assert.match(v4Styles, /navigation-panel.*hidden/s);
assert.match(v4Styles, /data-lodesta-menu-toggle.*min-height:\s*2\.75rem/s);
assert.match(v4Styles, /navigation-behavior="modal".*position:\s*fixed/s);
assert.match(v4Styles, /inset:\s*var\(--lodesta-navigation-top, 0px\) 0 0/);
assert.match(v4Styles, /height:\s*calc\(100dvh - var\(--lodesta-navigation-top, 0px\)\)/);
assert.match(v4Styles, /overscroll-behavior:\s*contain/);
assert.match(v4Styles, /background:\s*var\(--site-color-background, Canvas\)/);
assert.doesNotMatch(v4Styles, /navigation-icon|transition:|navigation-panel\]\s+a|navigation-panel\].*>\s+nav/);
assert.doesNotMatch(workflowSource, /const runtimeSeriesId = "site-runtime-v[123]"/);
assert.match(workflowSource, /input\.buildInput\.capabilityConfiguration\.trustedRuntimeSeries/);
assert.match(workflowSource, /runtimeSource = await this\.readAuditedRuntimePatch/);
assert.match(browserGateSource, /runtimeSource\?: Buffer/);
assert.match(previewSource, /getPublicBuildInput\(session\.publicBuildInputId\)/);
assert.doesNotMatch(previewSource, /site-runtime-v[123]/);
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
  `export const siteDefinition={routes:[{path:"/",element:<main>Legacy</main>}]};`
), { runtimeSeriesId: "site-runtime-v3" }).some((finding) => finding.id === "source.runtime_series"));
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
