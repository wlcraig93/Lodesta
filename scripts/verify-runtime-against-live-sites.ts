import "./load-env";

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { generatedSiteContentSecurityPolicy } from "../lib/generated-site-security";
import { sha256 } from "../packages/business-data";
import { sitePlatformRepository } from "../packages/platform-data";
import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "../packages/site-artifacts";
import { bindPublishedDocumentContext } from "../packages/site-platform/public-document-context";
import { buildSiteRuntimeBytes } from "../packages/trusted-runtime";

/*
 * Before a trusted-runtime patch goes live, every published site is loaded
 * with the candidate runtime under the production content security policy.
 * Pages must load without console or page errors, forms must be bound by the
 * runtime, and the mobile navigation toggle must open. The evidence file is
 * what scripts/promote-site-runtime.ts requires while any site is live.
 *
 *   node --import tsx scripts/verify-runtime-against-live-sites.ts --series-id=site-runtime-v4 --evidence=.data/runtime-evidence.json
 */
const seriesId = process.argv.find((value) => value.startsWith("--series-id="))?.slice("--series-id=".length) ?? "site-runtime-v4";
const evidencePath = process.argv.find((value) => value.startsWith("--evidence="))?.slice("--evidence=".length);
if (!evidencePath) throw new Error("Pass --evidence=<path> for the evidence file.");

const runtimeBytes = await buildSiteRuntimeBytes(seriesId);
const runtimeContentHash = sha256(runtimeBytes);
const store = configuredArtifactBlobStore();
const live = (await sitePlatformRepository.listSites()).filter((site) => site.publishedVersionId && (site.status === "active" || site.status === "offline"));
const browser = await chromium.launch();
const sites: Array<{ siteId: string; versionId: string; routes: number; failures: string[] }> = [];
try {
  for (const site of live) {
    const failures: string[] = [];
    const version = await sitePlatformRepository.getSiteVersion(site.publishedVersionId!);
    const artifact = version ? await sitePlatformRepository.getBuildArtifact(version.artifactId) : undefined;
    const input = version ? await sitePlatformRepository.getPublicBuildInput(version.publicBuildInputId) : undefined;
    if (!version || !artifact || !input) {
      sites.push({ siteId: site.id, versionId: site.publishedVersionId!, routes: 0, failures: ["published version, artifact or build input is missing"] });
      continue;
    }
    const files = new Map<string, { bytes: Buffer; contentType: string }>();
    for (const file of artifact.files) {
      const blob = await readVerifiedArtifactFile({ artifact, path: file.path, store });
      if (!blob) failures.push(`artifact file ${file.path} failed verification`);
      else files.set(file.path, { bytes: blob.bytes, contentType: blob.contentType });
    }
    const assetKeys = new Map(input.business.assets.map((asset) => [asset.revisionId, asset.storageKey]));
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const send = (status: number, body: Buffer | string, contentType: string, headers: Record<string, string> = {}) => {
        response.writeHead(status, { "content-type": contentType, ...headers });
        response.end(body);
      };
      if (url.pathname.startsWith("/_lodesta/runtime/")) return send(200, runtimeBytes, "application/javascript; charset=utf-8");
      if (url.pathname === "/site.css" && files.has("site.css")) return send(200, files.get("site.css")!.bytes, "text/css; charset=utf-8");
      const font = url.pathname.match(/^\/_lodesta\/fonts\/([^/]+)$/)?.[1];
      if (font) return send(200, await readFile(resolve(process.cwd(), "public", "_lodesta", "fonts", decodeURIComponent(font))).catch(() => Buffer.alloc(0)), "font/woff2");
      const assetId = url.pathname.match(/^\/_lodesta\/assets\/([^/]+)$/)?.[1];
      if (assetId) {
        const key = assetKeys.get(decodeURIComponent(assetId));
        const blob = key ? await store.get(key) : undefined;
        return blob ? send(200, blob.bytes, blob.contentType) : send(404, "", "text/plain");
      }
      if (url.pathname === "/api/analytics") return send(204, "", "application/json");
      if (url.pathname === "/api/forms/submit") return send(200, JSON.stringify({ accepted: true }), "application/json");
      const route = artifact.routes.find((candidate) => candidate.path === (url.pathname.replace(/\/+$/, "") || "/"));
      const html = route ? files.get(route.htmlFile) : undefined;
      if (!html) return send(404, "Not found", "text/plain");
      return send(200, bindPublishedDocumentContext(html.bytes.toString("utf8"), { siteId: site.id, versionId: version.id }), "text/html; charset=utf-8", {
        "content-security-policy": generatedSiteContentSecurityPolicy("self")
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    try {
      for (const route of artifact.routes) {
        for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
          const page = await browser.newPage({ viewport });
          const errors: string[] = [];
          page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(`${origin}${route.path}`, { waitUntil: "load" });
          await page.waitForTimeout(250);
          const unboundForms = await page.locator("form[data-lodesta-form-id]:not([data-lodesta-rendered-at])").count();
          if (unboundForms) errors.push(`${unboundForms} form(s) not bound by the runtime`);
          if (viewport.width === 375) {
            const toggle = page.locator("[data-lodesta-menu-toggle]").first();
            if (await toggle.count() && await toggle.isVisible()) {
              await toggle.click();
              await page.waitForTimeout(150);
              if (await toggle.getAttribute("aria-expanded") !== "true") errors.push("mobile navigation toggle did not open");
            }
          }
          failures.push(...errors.map((error) => `${route.path} @${viewport.width}px: ${error}`));
          await page.close();
        }
      }
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
    sites.push({ siteId: site.id, versionId: version.id, routes: artifact.routes.length, failures });
  }
} finally {
  await browser.close();
}

const evidence = { seriesId, runtimeContentHash, checkedAt: new Date().toISOString(), sites };
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
const failed = sites.filter((site) => site.failures.length);
console.log(JSON.stringify({ ok: failed.length === 0, runtimeContentHash, liveSites: sites.length, failedSites: failed.map((site) => site.siteId) }));
if (failed.length) process.exit(1);
