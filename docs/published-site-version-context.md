# Published-page version context

Status: diagnosed September 6, 2026; September 7 correction deployed in `4cc3fc233e5625bec14efff8b5a2fe75eee1c4fc`. A fresh live canary verified exact browser/form version binding and a matched analytics page load. Its subsequent inbox-rendering failure is tracked separately in [inbox contract correction](inquiry-inbox-contract.md).

The owner-journey canary on release `06e2bcbfd64a35d2f2c4ac15787611f331c998d5` successfully created, edited and published a temporary Lodesta-owned site. The anonymous form endpoint returned `accepted: true, status: received`. A read-only database check confirms exactly one synthetic inquiry under the published form. The test then failed because the outgoing browser request contained an empty `versionId`. Cleanup paused and detached the temporary site, preserving history; its public route returns 404. The authenticated owner inbox UI was not checked before cleanup.

## Cause and test gap

The finalizer creates version-independent, immutable artifact HTML with `data-lodesta-site-id` and `data-lodesta-analytics`, but no `data-lodesta-version-id`. The public HTML route serves verified artifact bytes unchanged and exposes the published version only in the `x-lodesta-site-version` response header. The trusted browser runtime reads the version from a DOM attribute, not that header. Therefore it sends an empty form version and does not start analytics, whose existing guard requires a version.

The form endpoint legitimately resolves an omitted version against the active published site and still verifies the form's retained publication reference. This explains the successful persisted inquiry; it does not establish browser-to-viewed-version binding. Analytics was enabled in this site's immutable input, but the anonymous browser recorded no cookies or localStorage keys because initialization never occurred.

The existing isolated runtime fixture supplied the version attribute manually. Its passing page-view and form checks did not test the real finalizer-to-public-serving boundary. The new regression must exercise that boundary, not add the missing attribute only to a hand-written test document or weaken the canary's version assertion.

## Minimal correction and explicit tradeoff

Supply the exact published version as trusted per-response metadata after artifact verification, preserving retained artifact and runtime bytes. Keep the public response header, DOM context and retained version consistent; test nested routes, custom-domain routing, preview exclusion and stale-version rejection. This is serving metadata, not authored presentation or another model tool/repair phase. Do not rewrite retained artifacts to bake in a later-created version ID.

The owner selected privacy-minimal analytics on September 7. The correction therefore ships with a separate audited runtime patch that removes persistent identifiers and uses in-memory page-load context only; the existing runtime's tracking must not be activated as an intermediate rollout. Reports remove unique/returning browsers and visit/landing attribution. See [storage and disclosure audit](generated-site-storage-and-disclosures.md). The empty-storage observation from the broken path is not evidence of that new implementation.

Both authorized synthetic inquiries have now been used. The second confirmed this version-context correction, but the subsequent inbox-rendering failure means the full owner journey did not pass. Another inquiry requires renewed permission. Do not reassign a disposed site's owner or reactivate it merely to complete a test.

The read-only September 7 inventory verified all 807 HTML routes across 24 retained versions before the new root assertion. The regression now exercises real finalization, verified artifact persistence, the public GET handler and the trusted browser runtime. It verifies nested routes, custom-domain serving metadata, unchanged retained bytes, exact form version context, stale-version rejection and empty local/session storage and cookies. Preview/internal exclusion remains covered by the trusted-runtime fixture.

## Evidence

- Run `run_1547974e0ffcb041ffdb8f8d23bed6bd`: initial build passed, three routes/five files, $0.17891378 catalog estimate; three rejected CSS syntax mutations and one final contrast rejection occurred before acceptance.
- Run `run_e0d623e3a50c4652b1320a292177c6f7`: ordinary footer edit passed, $0.01640898 catalog estimate; one final-verification rejection occurred before acceptance.
- Published version `version_5921f2f377ab53a72f892daf6d5905a3`; artifact `artifact_0c9b6b97f49b5387cc7b9a26d8302bc0`, hash `sha256:ffe4f7f0efd54902961c06e63e4d4c2fd21d6228873cccb275a03461cb0beb20`.
- Private `.data/owner-journey/20260906T214913Z-ab80ac00/result.json`, browser captures, and read-only inquiry/verified-artifact reproduction reports under the readiness evidence directory.

These results validate publication and one persisted inquiry, not a clean first-pass author, complete owner workflow, analytics readiness, or the separate multi-business quality screen.
