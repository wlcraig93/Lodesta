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
import { Fact, ManagedForm } from "../platform/sdk";
import { LocalIntro } from "./components/LocalIntro";
export const siteDefinition = {
  siteName: "Multi-file sandbox verification",
  routes: [{ path: "/", title: "Multi-file sandbox verification", description: "Multi-file verification",
    element: <main><LocalIntro /><h1><Fact id="${input.publicFacts.find((fact) => fact.kind === "business_name")?.id}" /></h1><ManagedForm id="${input.forms[0]?.id}" /></main> }]
};`
  },
  { path: "src/styles.css", content: "body{margin:0;font:16px Arial,sans-serif}" },
  { path: "src/components/LocalIntro.tsx", content: `import React from "react"; export function LocalIntro(){ return <p className="intro">Multi-file component rendered.</p>; }` },
  { path: "src/components/local-intro.css", content: ".intro{font-weight:700;letter-spacing:.01em}" }
];

try {
  await Promise.all([
    cp(join(scaffold, "platform"), join(workspace, "platform"), { recursive: true }),
    cp(join(scaffold, "package.json"), join(workspace, "package.json")),
    cp(join(scaffold, "vite.config.ts"), join(workspace, "vite.config.ts")),
    cp(join(scaffold, "version-manifest.ts"), join(workspace, "version-manifest.ts")),
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
    schemaVersion?: string;
    compilerManifest?: Record<string, unknown>;
    sharedCss?: string;
    routes?: Array<{ path?: string; bodyHtml?: string }>;
    factDeclarations?: unknown[];
    capabilityBindings?: unknown[];
  };
  assert.equal(artifact.schemaVersion, "agent-authored-artifact-v2", "sandbox emitted the retired artifact contract");
  assert.deepEqual(artifact.compilerManifest, expectedSiteSandboxManifest, "artifact omitted or drifted from the actual compiler manifest");
  assert.deepEqual(artifact.factDeclarations, [], "omitted fact declarations were not compiler-normalized");
  assert.deepEqual(artifact.capabilityBindings, [{
    id: "capability_form___1",
    kind: "form",
    route: "/",
    config: { formId: "form_estimate" }
  }], "compiler did not derive SDK capabilities from rendered markup");
  assert(artifact.sharedCss?.includes(".intro{font-weight:700"), "nested CSS module was not included in the artifact");
  assert(artifact.routes?.[0]?.bodyHtml?.includes("Multi-file component rendered."), "local TSX module was not rendered");
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
