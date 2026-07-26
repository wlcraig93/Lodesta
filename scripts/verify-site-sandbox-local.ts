import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import {
  formatLocalAddress,
  summarizedLocationHours
} from "../workers/site-sandbox/scaffold/platform/presentation";

const scaffold = resolve("workers/site-sandbox/scaffold");
const workspace = await mkdtemp(join(tmpdir(), "lodesta-multifile-sandbox-"));
const input = buildSyntheticSiteInput();
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
const files = [
  {
    path: "src/site.tsx",
    content: `import { Asset, BusinessAddress, BusinessHours, BusinessName, Fact, ManagedForm } from "#lodesta-sdk";
import { LocalIntro } from "./components/LocalIntro";
import { LegacyBadge } from "./legacy";
export const siteDefinition = {
  routes: [{ path: "/",
    element: <main><LocalIntro /><LegacyBadge /><h1><BusinessName /></h1><Fact id="fact_phone" /><BusinessHours locationId="location_primary" /><BusinessHours locationId="location_primary" variant="weekly" /><BusinessAddress locationId="location_primary" /><Asset id="asset_hero" loading="eager" fetchPriority="high" /><ManagedForm id="${input.forms[0]?.id}" /></main> }]
};`
  },
  { path: "src/styles.css", content: "html{scroll-behavior:smooth}body{margin:0;font:16px Arial,sans-serif}" },
  { path: "src/components/LocalIntro.tsx", content: `import { BusinessName } from "#lodesta-sdk"; export function LocalIntro(){ return <p className="intro">Multi-file component rendered for <BusinessName />.</p>; }` },
  { path: "src/legacy.tsx", content: `import { BusinessName } from "../platform/sdk"; export function LegacyBadge(){ return <small>Legacy boundary: <BusinessName /></small>; }` },
  { path: "src/components/local-intro.css", content: ".intro{font-weight:700;letter-spacing:.01em}" }
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
  await writeFile(policyInput, JSON.stringify(files));
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
  assert.equal(artifact.kind, "agent-authored-artifact", "sandbox did not emit the canonical artifact contract");
  assert.deepEqual(artifact.compilerManifest, expectedSiteSandboxManifest, "artifact omitted or drifted from the actual compiler manifest");
  assert(!Object.hasOwn(artifact, "factDeclarations") && !Object.hasOwn(artifact, "claims"), "sandbox retained model-authored declarations");
  assert.deepEqual(artifact.capabilityBindings, [{
    id: "capability_form___1",
    kind: "form",
    route: "/",
    config: { formId: "form_estimate" }
  }], "compiler did not derive SDK capabilities from rendered markup");
  assert(artifact.sharedCss?.includes(".intro{font-weight:700"), "nested CSS module was not included in the artifact");
  assert.equal(artifact.routes?.[0]?.title, input.business.name, "compiler did not supply the canonical fallback title");
  assert.equal(artifact.routes?.[0]?.description, `${input.business.name}.`, "compiler did not supply the canonical fallback description");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("Multi-file component rendered for"), "local TSX module was not rendered");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("Legacy boundary:"), "legacy relative SDK import was not rendered");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("(512) 555-0142"), "compiler did not render the canonical formatted phone");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("Monday–Friday: 8:00 AM-5:30 PM"), "compiler did not render a compact source-bound hours summary");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("<dt>Monday</dt><dd>8:00 AM-5:30 PM</dd>"), "compiler did not render structured weekly hours");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("1200 Main Street, Austin, TX 78701"), "compiler did not render the natural US address variant");
  assert(!artifact.routes?.[0]?.bodyHtml?.includes(", US"), "compiler leaked a trailing country code into the local address variant");
  assert(artifact.routes?.[0]?.bodyHtml?.includes('loading="eager"'), "Asset did not preserve explicit eager loading.");
  assert(artifact.routes?.[0]?.bodyHtml?.includes('fetchPriority="high"'), "Asset did not preserve explicit fetch priority.");
  assert.throws(
    () => formatLocalAddress({ street: "1 King St", city: "Toronto", region: "ON", postalCode: "M5H 1A1", country: "CA" }),
    /supports US locations only/,
    "The local address formatter silently rendered a non-US address."
  );
  assert.equal(
    summarizedLocationHours({ Monday: "Open", Wednesday: "Open" }),
    "Monday: Open; Wednesday: Open",
    "Compact hours formatting combined non-contiguous days into a false range."
  );
  process.stdout.write(`${JSON.stringify({ ok: true, sourceFiles: files.length, sdkAlias: "pass", automaticJsx: "pass", legacySdkImport: "pass", localImports: "pass", nestedCss: "pass" })}\n`);
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
