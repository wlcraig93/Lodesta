import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePublicFetchUrl } from "@/lib/url-safety";
import { applyProviderExecutionFailure, applyProviderObservation, newDomainVerification } from "@/lib/domains";
import { isDomainReconciliationDue } from "@/lib/domain-reconciliation";
import { getWebsiteSetupView, websiteSetupOwnerMessage } from "@/lib/website-setups";
import { websiteSetupSourceFailureCode } from "@/lib/website-setup-jobs";
import type { DomainRecord, WebsiteSetupFailureCode } from "@/packages/platform-operations/contracts";
import {
  ConcurrentProjectLimitError,
  IdempotencyKeyConflictError,
  LocalPlatformOperationsRepository,
  type PlatformOperationsRepository
} from "@/packages/platform-operations/repository";
import { resolveManifestPreviewPath } from "@/packages/site-artifacts";
import type { SiteBuildArtifact } from "@/packages/site-contracts";

const directory = await mkdtemp(join(tmpdir(), "lodesta-account-setup-domain-"));
const repository: PlatformOperationsRepository = new LocalPlatformOperationsRepository(join(directory, "operations.json"));
const hashA = `sha256:${"a".repeat(64)}`;
const baseInput = {
  ownerUserId: "owner-a",
  sourceUrl: "https://example.com/",
  normalizedSource: "https://example.com/",
  reportingTimezone: "America/Chicago",
  idempotencyKey: "request-0001",
  creationRequestHash: hashA
};

const first = await repository.createWebsiteSetup(baseInput);
assert.equal((await repository.createWebsiteSetup(baseInput)).id, first.id, "Matching idempotency replay did not return the original setup.");
await assert.rejects(
  repository.createWebsiteSetup({ ...baseInput, sourceUrl: "https://other.example/", creationRequestHash: `sha256:${"b".repeat(64)}` }),
  IdempotencyKeyConflictError
);
const duplicate = await repository.createWebsiteSetup({ ...baseInput, idempotencyKey: "request-0002" });
assert.notEqual(duplicate.id, first.id, "A confirmed same-source project was not independent.");
const third = await repository.createWebsiteSetup({
  ...baseInput,
  sourceUrl: "https://third.example/",
  normalizedSource: "https://third.example/",
  idempotencyKey: "request-0003",
  creationRequestHash: `sha256:${"c".repeat(64)}`
});
await assert.rejects(
  repository.createWebsiteSetup({
    ...baseInput,
    sourceUrl: "https://fourth.example/",
    normalizedSource: "https://fourth.example/",
    idempotencyKey: "request-0004",
    creationRequestHash: `sha256:${"d".repeat(64)}`
  }),
  ConcurrentProjectLimitError
);
const crossUser = await repository.createWebsiteSetup({ ...baseInput, ownerUserId: "owner-b", idempotencyKey: "request-0005" });
assert.notEqual(crossUser.id, first.id, "Source awareness leaked across accounts.");

await repository.cancelWebsiteSetup({ setupId: duplicate.id, ownerUserId: "owner-a" });
await repository.cancelWebsiteSetup({ setupId: third.id, ownerUserId: "owner-a" });
const claimed = await repository.claimNextWebsiteSetup("worker-a");
assert.equal(claimed?.id, first.id);
const revised = await repository.updateWebsiteSetupSource({
  setupId: first.id,
  ownerUserId: "owner-a",
  sourceUrl: "https://changed.example/",
  normalizedSource: "https://changed.example/"
});
assert.equal(revised?.sourceRevision, 2);
assert.equal(await repository.linkWebsiteSetup({
  setupId: first.id,
  sourceRevision: 1,
  siteId: "stale-site",
  sessionId: "stale-session",
  runId: "stale-run"
}), null, "A stale source revision linked worker output.");
assert.equal((await repository.cancelWebsiteSetup({ setupId: first.id, ownerUserId: "email-only-match" })), null);
await repository.claimNextWebsiteSetup("worker-b");
const failed = await repository.failWebsiteSetup({
  setupId: first.id,
  sourceRevision: 2,
  failureCode: "crawl_temporarily_unavailable",
  failureReason: "Synthetic failure"
});
assert.equal(failed?.status, "failed");
const failedOwnerView = await getWebsiteSetupView(failed!);
assert(!("failureReason" in failedOwnerView.setup), "Owner setup response exposed stored diagnostics.");
assert.equal(failedOwnerView.message, "We couldn’t read this website right now. Try again.");
const capacityBlockers = await Promise.all([1, 2, 3].map((index) => repository.createWebsiteSetup({
  ...baseInput,
  sourceUrl: `https://capacity-${index}.example/`,
  normalizedSource: `https://capacity-${index}.example/`,
  idempotencyKey: `capacity-${index}`,
  creationRequestHash: `sha256:${String(index).repeat(64)}`
})));
await assert.rejects(
  repository.retryWebsiteSetup({ setupId: first.id, ownerUserId: "owner-a" }),
  ConcurrentProjectLimitError,
  "Retry bypassed the combined active-operation cap."
);
for (const blocker of capacityBlockers) await repository.cancelWebsiteSetup({ setupId: blocker.id, ownerUserId: "owner-a" });
assert.equal((await repository.retryWebsiteSetup({ setupId: first.id, ownerUserId: "owner-a" }))?.status, "queued");

const artifact = { routes: [{ path: "/", htmlFile: "index.html" }, { path: "/about", htmlFile: "about/index.html" }] } as SiteBuildArtifact;
assert.equal(resolveManifestPreviewPath({ artifact }), "index.html");
assert.equal(resolveManifestPreviewPath({ artifact, path: ["about"] }), "about/index.html");
for (const path of [[".."], ["."], ["\\etc"], ["/etc"], ["a\0b"], ["%2Fetc"], ["%5cetc"], ["%2e%2e"]]) {
  assert.equal(resolveManifestPreviewPath({ artifact, path }), undefined, `Unsafe preview path was accepted: ${path.join("/")}`);
}

for (const value of ["http://user:pass@example.com", "http://localhost", "http://127.0.0.1", "http://10.0.0.1", "http://169.254.169.254", "http://[::1]", "http://[fd00::1]", "ftp://example.com"]) {
  assert.equal((await validatePublicFetchUrl(value, { resolveDns: false })).ok, false, `Unsafe source URL was accepted: ${value}`);
}
const ownerFailureCopy = new Map<WebsiteSetupFailureCode, string>([
  ["source_invalid", "This address is no longer a valid public website. Use a different URL."],
  ["crawl_temporarily_unavailable", "We couldn’t read this website right now. Try again."],
  ["crawl_robots_disallowed", "This website doesn’t allow automated reading. Try a different website."],
  ["crawl_unsupported_content", "This address didn’t return a readable website. Try a different URL."],
  ["crawl_primary_unavailable", "This address didn’t return a readable website. Try a different URL."],
  ["bootstrap_failed", "We couldn’t finish creating this website. Try again."],
  ["worker_interrupted", "We couldn’t finish creating this website. Try again."]
]);
for (const [code, copy] of ownerFailureCopy) {
  assert.equal(websiteSetupOwnerMessage(code), copy, `Owner copy drifted for ${code}.`);
}
assert.equal(websiteSetupSourceFailureCode("dns_unavailable"), "crawl_temporarily_unavailable");
for (const code of ["invalid_url", "unsupported_protocol", "credentials_forbidden", "hostname_missing", "private_hostname", "private_address"] as const) {
  assert.equal(websiteSetupSourceFailureCode(code), "source_invalid", `${code} was not treated as a permanent source failure.`);
}

const domain = newDomainVerification({ siteId: "site-a", hostname: "www.example.com", now: new Date("2026-01-01T00:00:00Z") });
const failure = applyProviderExecutionFailure(domain, new Error("provider unavailable"), new Date("2026-01-02T00:00:00Z"));
assert.equal(failure.status, "pending_verification", "Provider execution failure changed routing state.");
let invalid: DomainRecord = { ...domain, ownershipProofStatus: "verified", routingStatus: "active", status: "provisioning" };
invalid = applyProviderObservation(invalid, { kind: "invalid", note: "provider reported invalid" }, new Date("2026-01-01T00:00:00Z"));
invalid = applyProviderObservation(invalid, { kind: "invalid", note: "provider reported invalid" }, new Date("2026-01-02T12:00:00Z"));
assert.notEqual(invalid.status, "attention_required", "Domain unrouted before three invalid observations spanning 72 hours.");
invalid = applyProviderObservation(invalid, { kind: "invalid", note: "provider reported invalid" }, new Date("2026-01-04T00:00:00Z"));
assert.equal(invalid.status, "attention_required");
assert.equal(isDomainReconciliationDue({ ...domain, status: "active", updatedAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-01-02T12:00:00.000Z")), true);
assert.equal(isDomainReconciliationDue({ ...domain, status: "expired", updatedAt: "2025-01-01T00:00:00.000Z" }, new Date("2026-01-02T12:00:00.000Z")), false);

const [setupRoute, setupUpdateRoute, setupAuth, setupWorker, setupHelpers, previewTokenRoute, onboardingPage, setupPage, workspacePage, workspaceClient, accountContext, ownerWorkspace, workflow, domainRoute, domainSettings, adminSites, baseline, typedFailureMigration] = await Promise.all([
  readFile("app/api/website-setups/route.ts", "utf8"),
  readFile("app/api/website-setups/[id]/route.ts", "utf8"),
  readFile("app/api/website-setups/auth.ts", "utf8"),
  readFile("lib/website-setup-jobs.ts", "utf8"),
  readFile("lib/website-setups.ts", "utf8"),
  readFile("app/preview/[previewId]/[[...path]]/route.ts", "utf8"),
  readFile("app/(owner)/account/onboarding/page.tsx", "utf8"),
  readFile("app/(owner)/account/onboarding/[setupId]/page.tsx", "utf8"),
  readFile("app/(owner-workspace)/workspace/[slug]/page.tsx", "utf8"),
  readFile("components/SiteAgentWorkspace.tsx", "utf8"),
  readFile("lib/account-context.ts", "utf8"),
  readFile("lib/owner-workspace.ts", "utf8"),
  readFile("packages/site-platform/workflow.ts", "utf8"),
  readFile("app/api/domains/route.ts", "utf8"),
  readFile("app/(owner-workspace)/workspace/[slug]/settings/page.tsx", "utf8"),
  readFile("app/admin/sites/page.tsx", "utf8"),
  readFile("supabase/migrations/202607230001_canonical_baseline.sql", "utf8"),
  readFile("supabase/migrations/202607230002_typed_website_setup_failures.sql", "utf8")
]);
assert(setupRoute.includes("duplicate_source_confirmation_required") && setupRoute.includes("confirmDuplicate"), "Private duplicate confirmation is missing.");
assert(setupRoute.includes("idempotency_key_conflict") && !setupRoute.includes("after("), "Setup idempotency or request/worker boundary is missing.");
assert(setupRoute.includes("validateWebsiteSetupSource") && setupUpdateRoute.includes("validateWebsiteSetupSource") && setupHelpers.includes("resolveDns: true"), "Creation and source replacement must resolve DNS before queueing.");
assert(setupAuth.includes("setup.ownerUserId !== auth.user.id") && !setupAuth.includes("ownerEmail"), "Setup access is not exact user-ID equality.");
assert(setupWorker.includes("bootstrapFromUrl") && !setupWorker.includes("ExistingSourceCollision"), "Setup worker retains collision reuse.");
await assert.rejects(access("app/api/website-setups/[id]/preview/[[...path]]/route.ts"), "Obsolete setup-preview route remains.");
assert(
  previewTokenRoute.includes("readVerifiedManifestPreviewFile") &&
    previewTokenRoute.includes("hasValidPreviewSession") &&
    previewTokenRoute.includes("location.hash.slice(1)") &&
    previewTokenRoute.includes('"x-lodesta-preview": "1"') &&
    previewTokenRoute.includes('"cache-control": "private, no-store"'),
  "Private preview routes lost their fragment exchange, verified reader, or response contract."
);
assert(onboardingPage.includes("Sign in to create a website") && onboardingPage.includes("authentication is disabled"), "Local-open setup does not fail closed with an actionable notice.");
assert(setupPage.includes('redirect(view.openPath)') && !setupPage.includes("<iframe") && !setupPage.includes("failureReason"), "Linked setup redirect or safe progress rendering is incomplete.");
assert(!workspacePage.includes("failed.failureReason") && !workspaceClient.includes("failedRun.failureReason"), "Stored authoring diagnostics leak into owner surfaces.");
assert(accountContext.includes("getOwnerSiteInventory") && ownerWorkspace.includes("getSitesByOwnerUserId") && ownerWorkspace.includes("getBusinessStatesByIds"), "Account inventory is not owner-scoped and bulk-loaded.");
assert(!workflow.includes("existingSourcePolicy") && !workflow.includes("findExistingBootstrap"), "Global source collision logic remains.");
assert(workflow.includes("bootstrapWithUniqueSlug") && workflow.includes("duplicate key.*sites.*slug") && workflow.includes("input.site.id.replace"), "Concurrent slug creation does not use unique-insert retry with a site-ID suffix.");
assert(!domainRoute.includes("getDomainByHostname") && domainSettings.includes("TXT ownership record") && domainSettings.includes("CNAME or ALIAS"), "Proof-first domain instructions are incomplete.");
assert(adminSites.includes("Abandoned setup") && adminSites.includes('setup.status === "canceled"'), "Canceled linked drafts are not visible to administrators.");
assert(baseline.includes("pg_advisory_xact_lock") && baseline.includes("private_user_active_operation_count"), "Combined database capacity is not atomic.");
assert(baseline.includes("active_domains") && baseline.includes("claim_domain_ownership"), "Verified hostname exclusivity is missing.");
assert(typedFailureMigration.includes("where failure_code = 'website_crawl_failed'") && typedFailureMigration.includes("crawl_temporarily_unavailable"), "Retired crawl failures are not remapped to a retriable typed code.");

console.log(JSON.stringify({ ok: true, reusableSources: true, capacity: 3, directWorkspaceHandoff: true, proofFirstDomains: true }));
