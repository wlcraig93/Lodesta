import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sitePlatformRepository } from "../packages/platform-data";
import { LocalPlatformOperationsRepository, type PlatformOperationsRepository } from "../packages/platform-operations";
import type { PlatformSiteRecord } from "../packages/site-contracts";

// Claim links hand an unowned prospect project to the account that redeems
// them: once, before expiry, unless revoked or replaced, never for an owned or
// disposed project. The atomic SQL path is exercised by the migration test.
const directory = await mkdtemp(join(tmpdir(), "lodesta-claim-links-"));
const original = { getSite: sitePlatformRepository.getSite, assign: sitePlatformRepository.assignSiteOwnerIfUnowned };
try {
  const alice = "00000000-0000-4000-8000-00000000000a";
  const bob = "00000000-0000-4000-8000-00000000000b";
  const sites: Record<string, Partial<PlatformSiteRecord>> = {
    site_prospect: { id: "site_prospect", status: "draft" },
    site_owned: { id: "site_owned", status: "active", ownerUserId: alice },
    site_disposed: { id: "site_disposed", status: "paused" }
  };
  sitePlatformRepository.getSite = async (id) => sites[id] as PlatformSiteRecord | undefined;
  sitePlatformRepository.assignSiteOwnerIfUnowned = async (id, owner) => {
    const site = sites[id];
    if (!site || site.ownerUserId || site.status === "paused") return undefined;
    site.ownerUserId = owner;
    return site as PlatformSiteRecord;
  };
  const operations: PlatformOperationsRepository = new LocalPlatformOperationsRepository(join(directory, "operations.json"));
  const later = new Date(Date.now() + 86_400_000).toISOString();

  await operations.createSiteClaimLink({ siteId: "site_prospect", tokenHash: "first", expiresAt: later });
  await operations.createSiteClaimLink({ siteId: "site_prospect", tokenHash: "second", expiresAt: later });
  assert.equal((await operations.inspectClaimLink("first")).state, "revoked", "A new link replaces the earlier open link.");
  assert.equal((await operations.inspectClaimLink("second")).state, "valid");
  assert.equal((await operations.inspectClaimLink("never-issued")).state, "unknown");
  assert.equal(await operations.consumeAdoptionInvitation({ tokenHash: "first", ownerUserId: bob }), null);

  assert.equal((await operations.consumeAdoptionInvitation({ tokenHash: "second", ownerUserId: alice }))?.consumedByUserId, alice);
  assert.equal(sites.site_prospect!.ownerUserId, alice);
  assert.equal((await operations.inspectClaimLink("second")).state, "used");
  assert.equal(await operations.consumeAdoptionInvitation({ tokenHash: "second", ownerUserId: bob }), null, "A link works once.");
  assert.equal(sites.site_prospect!.ownerUserId, alice, "A used link never moves an owned project.");

  await assert.rejects(operations.createSiteClaimLink({ siteId: "site_owned", tokenHash: "owned", expiresAt: later }), /site_not_claimable/);
  await assert.rejects(operations.createSiteClaimLink({ siteId: "site_disposed", tokenHash: "disposed", expiresAt: later }), /site_not_claimable/);

  sites.site_fresh = { id: "site_fresh", status: "draft" };
  await operations.createSiteClaimLink({ siteId: "site_fresh", tokenHash: "expired", expiresAt: new Date(Date.now() - 1_000).toISOString() });
  assert.equal((await operations.inspectClaimLink("expired")).state, "expired");
  assert.equal(await operations.consumeAdoptionInvitation({ tokenHash: "expired", ownerUserId: bob }), null);
  await operations.createSiteClaimLink({ siteId: "site_fresh", tokenHash: "revoke-me", expiresAt: later });
  assert.equal(await operations.revokeSiteClaimLinks("site_fresh"), 1);
  assert.equal(await operations.consumeAdoptionInvitation({ tokenHash: "revoke-me", ownerUserId: bob }), null);
  assert.equal(sites.site_fresh.ownerUserId, undefined);

  console.log(JSON.stringify({ ok: true, singleUse: "pass", replaced: "revoked", expiry: "pass", revocation: "pass", ownedOrDisposed: "not-claimable" }));
} finally {
  sitePlatformRepository.getSite = original.getSite;
  sitePlatformRepository.assignSiteOwnerIfUnowned = original.assign;
  await rm(directory, { recursive: true, force: true });
}
