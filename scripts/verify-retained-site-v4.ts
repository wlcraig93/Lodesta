import "./load-env";
import { chromium } from "playwright";
import { sitePlatformRepository } from "../packages/platform-data";

const slug = process.argv.find((arg) => arg.startsWith("--slug="))?.slice("--slug=".length) ?? "mencia-auto-body-paint";
const baseUrl = (process.argv.find((arg) => arg.startsWith("--base-url="))?.slice("--base-url=".length)
  ?? "http://127.0.0.1:4330").replace(/\/$/, "");
const adminToken = process.env.LODESTA_ADMIN_TOKEN;
if (!adminToken) throw new Error("LODESTA_ADMIN_TOKEN is required to verify a retained private candidate.");

const site = await sitePlatformRepository.getSiteBySlug(slug);
if (!site) throw new Error(`Retained V4 site ${slug} was not found.`);
const versions = await sitePlatformRepository.listSiteVersions(site.id);
const version = versions.find((candidate) => candidate.status === "candidate")
  ?? versions.find((candidate) => candidate.status === "published")
  ?? versions[0];
if (!version) throw new Error(`Retained V4 site ${slug} does not have a version.`);
const [artifact, buildInput] = await Promise.all([
  sitePlatformRepository.getBuildArtifact(version.artifactId),
  sitePlatformRepository.getPublicBuildInput(version.publicBuildInputId)
]);
if (!artifact || artifact.artifactHash !== version.artifactHash) throw new Error("Retained version does not resolve to its immutable artifact.");
if (!buildInput) throw new Error("Retained version does not resolve to its public build input.");
const nested = artifact.routes.find((route) => route.path !== "/");
if (!nested) throw new Error("Retained artifact does not include a nested route for verification.");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  extraHTTPHeaders: { "x-lodesta-admin-token": adminToken },
  serviceWorkers: "block"
});
const results = [];
try {
  for (const route of [artifact.routes.find((candidate) => candidate.path === "/")!, nested]) {
    const page = await context.newPage();
    const managedResponses: Array<{ path: string; status: number; contentType: string }> = [];
    const managedFailures: string[] = [];
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith("/_lodesta/")) {
        managedResponses.push({ path, status: response.status(), contentType: response.headers()["content-type"] ?? "" });
      }
    });
    page.on("requestfailed", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/_lodesta/")) managedFailures.push(`${path}: ${request.failure()?.errorText ?? "failed"}`);
    });
    const artifactUrl = `${baseUrl}/api/site-versions/${encodeURIComponent(version.id)}/artifact${route.path === "/" ? "/" : `${route.path}/`}`;
    const response = await page.goto(artifactUrl, { waitUntil: "networkidle" });
    if (!response?.ok()) throw new Error(`${route.path} returned ${response?.status() ?? "no response"}.`);
    const images = await page.locator("img").evaluateAll((nodes) => nodes.map((node) => {
      const image = node as HTMLImageElement;
      return { src: image.currentSrc || image.src, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
    }));
    if (!images.length || images.some((image) => image.naturalWidth <= 0 || image.naturalHeight <= 0)) {
      throw new Error(`${route.path} contains an absent or zero-dimension rendered image: ${JSON.stringify(images)}.`);
    }
    if (managedFailures.length) throw new Error(`${route.path} has failed managed requests: ${managedFailures.join(", ")}.`);
    const badManaged = managedResponses.filter((item) => item.status < 200 || item.status >= 400);
    if (badManaged.length) throw new Error(`${route.path} has failed managed responses: ${JSON.stringify(badManaged)}.`);
    const assetResponses = managedResponses.filter((item) => item.path.startsWith("/_lodesta/assets/") && item.status === 200);
    if (!assetResponses.length || assetResponses.some((item) => !item.contentType.startsWith("image/webp"))) {
      throw new Error(`${route.path} did not resolve its managed WebP assets.`);
    }
    const runtimeSeries = managedResponses.find((item) => item.path.startsWith("/_lodesta/runtime/") && !item.path.includes("/patches/"));
    const runtimePatch = managedResponses.find((item) => item.path.includes("/_lodesta/runtime/patches/") && item.status === 200);
    if (!runtimeSeries || ![200, 307, 308].includes(runtimeSeries.status) || !runtimePatch || !runtimePatch.contentType.includes("javascript")) {
      throw new Error(`${route.path} did not resolve its trusted runtime series to an audited JavaScript patch.`);
    }
    results.push({ route: route.path, images, managedResponses });
    await page.close();
  }
} finally {
  await context.close();
  await browser.close();
}

const after = await sitePlatformRepository.getSiteBySlug(slug);
if (!after || after.currentWorkspaceRevisionId !== site.currentWorkspaceRevisionId
  || after.currentPublicBuildInputId !== site.currentPublicBuildInputId
  || after.publishedVersionId !== site.publishedVersionId) {
  throw new Error("Read-only retained-site verification changed the site authority pointers.");
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  slug,
  siteId: site.id,
  versionId: version.id,
  artifactId: version.artifactId,
  workspaceRevisionId: version.workspaceRevisionId,
  publicBuildInputId: version.publicBuildInputId,
  assetRevisionIds: version.assetRevisionIds,
  mediaRights: buildInput.business.assets.map((asset) => ({ revisionId: asset.revisionId, rightsStatus: asset.rightsStatus })),
  routes: results
})}\n`);
