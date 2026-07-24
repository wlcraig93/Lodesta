import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const scaffold = resolve("workers/site-sandbox/scaffold");
const workspace = await mkdtemp(join(tmpdir(), "lodesta-multifile-sandbox-"));
const input = buildSyntheticSiteInput();
const files = [
  {
    path: "src/site.tsx",
    content: `import React from "react";
import { BusinessName, Fact, ManagedForm } from "../platform/sdk";
import { LocalIntro } from "./components/LocalIntro";
export const siteDefinition = {
  routes: [{ path: "/",
    element: <main><LocalIntro /><h1><BusinessName /></h1><Fact id="fact_phone" /><Fact id="fact_hours" /><ManagedForm id="${input.forms[0]?.id}" /></main> }]
};`
  },
  { path: "src/styles.css", content: "html{scroll-behavior:smooth}body{margin:0;font:16px Arial,sans-serif}" },
  { path: "src/components/LocalIntro.tsx", content: `import React from "react"; export function LocalIntro(){ return <p className="intro">Multi-file component rendered.</p>; }` },
  { path: "src/components/local-intro.css", content: ".intro{font-weight:700;letter-spacing:.01em}" }
];

try {
  await Promise.all([
    cp(join(scaffold, "platform"), join(workspace, "platform"), { recursive: true }),
    cp(join(scaffold, "package.json"), join(workspace, "package.json")),
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
  assert(artifact.routes?.[0]?.bodyHtml?.includes("Multi-file component rendered."), "local TSX module was not rendered");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("(512) 555-0142"), "compiler did not render the canonical formatted phone");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("Monday: 8:00 AM-5:30 PM"), "compiler did not render labeled canonical hours");
  process.stdout.write(`${JSON.stringify({ ok: true, sourceFiles: files.length, localImports: "pass", nestedCss: "pass" })}\n`);
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
