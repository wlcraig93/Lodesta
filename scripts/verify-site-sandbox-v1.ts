import { configuredSiteSandboxClient } from "../packages/site-sandbox";
import { sitePlatformVersionManifest } from "../packages/site-contracts/platform-versions";
import { sandboxSourcePolicyVersion } from "../workers/site-sandbox/scaffold/version-manifest";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import { chromium } from "playwright";

const input = buildSyntheticSiteInput();
const client = configuredSiteSandboxClient();
const sessionId = `verify-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;

const files = [
  {
    path: "src/site.tsx",
    content: `import React from "react";
import { Fact, ManagedForm, ManagedMap } from "../platform/sdk";
export const siteDefinition = {
  siteName: "Sandbox verification",
  designRationale: "A deterministic synthetic case used only to verify the production sandbox bridge.",
  claims: [], capabilityBindings: [],
  routes: [{ path: "/", title: "Sandbox verification", description: "Production sandbox protocol verification",
    element: <main><p>Production sandbox verification</p><h1><Fact id="${input.publicFacts.find((fact) => fact.kind === "business_name")?.id}" /></h1><p><Fact id="${input.publicFacts.find((fact) => fact.kind === "phone")?.id}" /></p><ManagedMap locationId="${input.business.locations[0]?.id}" /><ManagedForm id="${input.forms[0]?.id}" /></main> }]
};`
  },
  {
    path: "src/styles.css",
    content: `:root{font-family:Arial,sans-serif;color:#17211b;background:#fff}body{margin:0}main{width:min(900px,calc(100% - 32px));margin:0 auto;padding:64px 0}h1{font-size:48px;letter-spacing:0}form{display:grid;gap:12px;max-width:520px}label{display:grid;gap:6px}input,textarea,select,button{min-height:44px;font:inherit}`
  }
] as const;

try {
  const bootstrapped = await client.bootstrap(sessionId, input);
  const preBuildPreview = await fetch(client.previewUrl(sessionId), { headers: { authorization: `Bearer ${process.env.LODESTA_SANDBOX_TOKEN}` } });
  assert(preBuildPreview.status === 409 && (await preBuildPreview.json() as { error?: string }).error === "preview_not_ready", "pre-build preview did not fail promptly with preview_not_ready");
  const diagnostics = await client.diagnostics(sessionId);
  assert(diagnostics.ok, "live sandbox diagnostics failed");
  assert(
    JSON.stringify(diagnostics.lodestaVersions) === JSON.stringify({ ...sitePlatformVersionManifest, sourcePolicy: sandboxSourcePolicyVersion }),
    `deployed sandbox versions do not match code-owned versions: ${JSON.stringify(diagnostics.lodestaVersions)}`
  );
  const hostileResponse = await fetch(`${process.env.LODESTA_SANDBOX_URL?.replace(/\/$/, "")}/v1/sessions/${sessionId}/apply`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.LODESTA_SANDBOX_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision: bootstrapped.revision,
      files: [
        { path: "src/site.tsx", content: `import React from "react"; import { Fact } from "../platform/sdk"; import fs from "node:fs"; fetch("https://example.com"); export const siteDefinition = {};` },
        { path: "src/styles.css", content: "body{margin:0}" }
      ]
    })
  });
  const hostileResult = await hostileResponse.json() as { error?: string };
  assert(hostileResponse.status === 422 && hostileResult.error === "source_policy_violation", "live worker executed source outside the generated-code allowlist");
  const applied = await client.apply(sessionId, bootstrapped.revision, [...files]);
  const postBuildDiagnostics = await client.diagnostics(sessionId);
  assert(!postBuildDiagnostics.processes.some((process) => process.status === "running" && process.command.includes("--port 4173")), "successful build eagerly started Vite");
  const source = await client.getSource(sessionId);
  assert(source.files.length === 2, "source endpoint did not return both allowlisted files");
  const artifact = await client.getArtifact(sessionId);
  assert(artifact.routes.some((route) => route.path === "/"), "artifact did not include the home route");
  assert(!artifact.routes.some((route) => route.bodyHtml.includes("data-lodesta-rendered-at")), "build embedded a nondeterministic form timestamp");
  const artifactHomepage = artifact.routes.find((route) => route.path === "/")?.bodyHtml ?? "";
  assert(artifactHomepage.includes("(512) 555-0142"), "built artifact did not format a canonical US phone for display");
  assert(artifactHomepage.includes("data-lodesta-location-verified") && artifactHomepage.includes("Verified location"), "built artifact did not render the managed location panel");
  const rebased = await client.rebase(sessionId, applied.revision, input);
  assert(rebased.revision !== applied.revision, "rebase did not advance the sandbox revision");
  const backup = await client.backup(sessionId);
  const restoredSession = `${sessionId}-restore`;
  try {
    const secondBootstrap = await client.bootstrap(restoredSession, input);
    const restored = await client.restore(restoredSession, backup.backup.id, secondBootstrap.revision, backup.backup.contentHash);
    const restoredSource = await client.getSource(restoredSession);
    assert(restored.revision === rebased.revision, "restore did not recover the exact backed-up revision");
    assert(restoredSource.files.length === source.files.length, "restore did not recover source files");
  } finally {
    await client.destroy(restoredSession).catch(() => undefined);
  }
  const [preview, concurrentPreview] = await Promise.all([
    fetch(client.previewUrl(sessionId), { headers: { authorization: `Bearer ${process.env.LODESTA_SANDBOX_TOKEN}` } }),
    fetch(client.previewUrl(sessionId), { headers: { authorization: `Bearer ${process.env.LODESTA_SANDBOX_TOKEN}` } })
  ]);
  assert(preview.ok && concurrentPreview.ok, `concurrent lazy preview returned ${preview.status}/${concurrentPreview.status}`);
  const previewDiagnostics = await client.diagnostics(sessionId);
  assert(previewDiagnostics.processes.filter((process) => process.status === "running" && process.command.includes("--port 4173")).length === 1, "concurrent first preview requests started more than one Vite process");
  const csp = preview.headers.get("content-security-policy") ?? "";
  assert(csp.includes("default-src 'none'") && csp.includes("form-action 'none'"), "fast preview CSP is not restrictive");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ extraHTTPHeaders: { authorization: `Bearer ${process.env.LODESTA_SANDBOX_TOKEN}` } });
  const page = await context.newPage();
  await page.goto(client.previewUrl(sessionId), { waitUntil: "networkidle" });
  const previewHtml = await page.content();
  await browser.close();
  assert(previewHtml.includes("(512) 555-0142"), "fast preview did not format a canonical US phone for display");
  assert(previewHtml.includes("data-lodesta-location-verified") && previewHtml.includes("Verified location"), "fast preview did not render the managed location panel");
  assert(previewHtml.indexOf("Monday</dt>") < previewHtml.indexOf("Tuesday</dt>") && previewHtml.indexOf("Sunday</dt>") < previewHtml.indexOf("By appointment</dt>"), "managed location hours are not rendered Monday-first with unknown labels last");
  assert(previewHtml.includes("--lodesta-location-background") && previewHtml.indexOf("--lodesta-location-background") < previewHtml.indexOf(":root{font-family"), "fast preview does not apply canonical platform styles before agent CSS");
  console.log(JSON.stringify({ ok: true, sessionId, buildDurationMs: applied.buildDurationMs, rebaseDurationMs: rebased.buildDurationMs, sourcePolicy: "pass", imageProtocol: "site-sandbox-v1", lodestaVersions: diagnostics.lodestaVersions }));
} finally {
  await client.destroy(sessionId).catch(() => undefined);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
