import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSitePlatformRepository } from "../packages/platform-data";

// Owners take a published site offline and back online without a new build;
// the same published version returns, and nobody else can change it.
const directory = await mkdtemp(join(tmpdir(), "lodesta-site-online-"));
try {
  const path = join(directory, "repository.json");
  const owner = "00000000-0000-4000-8000-000000000001";
  const site = (id: string, status: string, publishedVersionId?: string) => ({ id, ownerUserId: owner, slug: id.replace("_", "-"), status, publishedVersionId, updatedAt: "2026-09-25T00:00:00.000Z" });
  await writeFile(path, JSON.stringify({
    sites: { site_live: site("site_live", "active", "version_live"), site_draft: site("site_draft", "draft") },
    versions: { version_live: { id: "version_live", siteId: "site_live", status: "published" } }
  }));
  const repository = new LocalSitePlatformRepository(path);
  const status = async (id: string) => (JSON.parse(await readFile(path, "utf8")) as { sites: Record<string, { status: string; publishedVersionId?: string }> }).sites[id]!;

  await assert.rejects(repository.setSiteOnline("site_live", "00000000-0000-4000-8000-000000000002", false), /site_owner_required/);
  assert.equal((await status("site_live")).status, "active");

  await repository.setSiteOnline("site_live", owner, false);
  assert.deepEqual(await status("site_live"), { ...(await status("site_live")), status: "offline", publishedVersionId: "version_live" });
  await repository.setSiteOnline("site_live", owner, false);
  assert.equal((await status("site_live")).status, "offline", "Taking an offline site offline again is a no-op.");

  await repository.setSiteOnline("site_live", owner, true);
  assert.equal((await status("site_live")).status, "active");
  assert.equal((await status("site_live")).publishedVersionId, "version_live", "Going back online serves the same version.");

  await assert.rejects(repository.setSiteOnline("site_draft", owner, false), /site_not_published/);
  await assert.rejects(repository.setSiteOnline("site_draft", owner, true), /site_not_published/);

  // Visitors of an offline site get a plain unavailable page, kept out of search.
  const { sitePlatformRepository } = await import("../packages/platform-data");
  const originalGetSiteBySlug = sitePlatformRepository.getSiteBySlug.bind(sitePlatformRepository);
  sitePlatformRepository.getSiteBySlug = async (slug: string) => slug === "site-off"
    ? site("site_off", "offline", "version_live") as never
    : undefined;
  try {
    const { GET } = await import("../app/sites/[slug]/[[...path]]/route");
    const offline = await GET(new Request("http://localhost/sites/site-off"), { params: Promise.resolve({ slug: "site-off" }) });
    assert.equal(offline.status, 503);
    assert.equal(offline.headers.get("x-robots-tag"), "noindex");
    assert.match(await offline.text(), /temporarily unavailable/);
    assert.equal((await GET(new Request("http://localhost/sites/missing"), { params: Promise.resolve({ slug: "missing" }) })).status, 404);
  } finally {
    sitePlatformRepository.getSiteBySlug = originalGetSiteBySlug;
  }

  console.log(JSON.stringify({ ok: true, offline: "keeps-published-version", online: "same-version", nonOwner: "rejected", unpublished: "rejected" }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
