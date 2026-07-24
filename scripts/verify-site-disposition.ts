import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSitePlatformRepository } from "@/packages/platform-data/repository";

const ownerId = "63ee1944-0c01-4ccf-ad39-4d2f02b281ac";
const otherOwnerId = "a46b99dd-d8e2-4f24-9957-fd2564cb79ec";
const directory = await mkdtemp(join(tmpdir(), "lodesta-site-disposition-"));
const repository = new LocalSitePlatformRepository(join(directory, "repository.json"));
const createdAt = new Date().toISOString();

try {
  await repository.createSite({
    id: "site_disposition_test",
    ownerUserId: ownerId,
    businessId: "business_disposition_test",
    slug: "disposition-test",
    status: "active",
    reportingTimezone: "UTC",
    publishedVersionId: "version_retained_test",
    createdAt,
    updatedAt: createdAt
  });

  assert.equal(
    await repository.disposeOwnedSite("site_disposition_test", otherOwnerId),
    undefined,
    "A non-owner disposed the site."
  );
  assert.equal((await repository.getSite("site_disposition_test"))?.ownerUserId, ownerId);

  const disposed = await repository.disposeOwnedSite("site_disposition_test", ownerId);
  assert.equal(disposed?.status, "paused");
  assert.equal(disposed?.ownerUserId, undefined);
  assert.equal(disposed?.publishedVersionId, "version_retained_test", "Disposition removed the retained published version reference.");
  assert.equal((await repository.getSitesByOwnerUserId(ownerId)).length, 0, "Disposed site remains in the owner inventory.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("Site disposition verification passed.");
