# Generated-site storage and disclosure audit

Status: September 7, 2026 owner-approved privacy-minimal implementation deployed on Railway in `4cc3fc233e5625bec14efff8b5a2fe75eee1c4fc`. Local checks, CI and coordinated release passed. Live collection/storage checks passed; the owner journey found a separate inbox-rendering defect. This is a technical audit, not a universal legal-compliance certification.

## Decision and canonical behavior

The owner chose privacy-minimal analytics rather than activating the old persistent-identifier design. The candidate trusted runtime uses no analytics cookies, localStorage, sessionStorage, fingerprint or cross-page visitor identifier. A random in-memory page-load ID connects only that document's activity. Reloads, full navigations and new tabs start fresh. No returning-browser count, session/visit count, cross-page landing attribution or last-non-direct attribution remains in the current authoring/reporting contract.

The runtime sends first-party /api/analytics events for page views, engagement time/scroll depth, selected action clicks, form activity and limited performance measurements. Payloads include site/version, page path without query/hash, event ID, page-load ID, referrer host, bounded campaign fields, coarse viewport/device category and elapsed time. Ingestion scopes the page-load ID to the site and rejects obsolete visitor/visit fields; it does not create identity from IP or user agent. Campaign values reuse the existing sensitive-value sanitizer. Referrer paths and arbitrary URL queries are not analytics dimensions.

Reports show observed page views, tracked inquiries, action counts and page action rate—not unique people. Page action rate counts observed page loads with an action once, even if several actions occur. An action whose page-view beacon is missing still counts as an action but cannot inflate that fraction. Form starts/submissions are independent counts, not a matched completion funnel. The Inbox is authoritative for all received inquiries; analytics can undercount when requests are blocked or context is unavailable.

Managed form submission remains independent of analytics. Configured field values go to the managed inbox, with existing abuse-prevention metadata (including a server-side IP hash and user agent) and retained form provenance. Authentication and abuse prevention are separate from website analytics; this change does not remove those security controls. Existing raw analytics retention remains 14 months through the operator retention command; this change does not add a retention scheduler or consent platform.

Preview/internal inspection contexts suppress analytics. The ordinary Google rating is authored text plus an external link; it does not load a Google SDK or review widget. Assets/fonts and the trusted runtime are served locally. Owner/account authentication, protected-preview access cookies and Lodesta product theme preferences are separate from ordinary anonymous customer-site visits. Hosting-layer response cookies still require a fresh-browser check.

## Disclosure boundary

Describe the actual limited collection, not "no data collection" or guaranteed anonymity. Do not carry forward Google Analytics, Google Tag Manager, WordPress, Vimeo or embedded Maps descriptions unless the new implementation actually uses them. A privacy/storage disclosure and a consent interface are different questions. Requirements depend on jurisdiction, purpose and configuration. There is no visitor consent manager or per-visitor opt-out in this implementation, and no universal banner exemption is claimed.

The earlier legal references were California's guidance on notices and UK guidance on storage/access technologies. They do not establish universal compliance:

- https://oag.ca.gov/sites/all/files/agweb/pdfs/cybersecurity/making_your_privacy_practices_public.pdf
- https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/

Lodesta's own public privacy notice has been updated in this change: the analytics, storage and retention descriptions no longer describe the removed persistent visitor identifiers; unrelated provisions are preserved and the effective date is updated. This is a factual implementation correction, not a new legal-compliance claim.

For prospect/customer source documents, the legal-preservation gate still compares retained originals. A legitimate owner-approved replacement must become the comparison authority through the existing control plane. Do not weaken preservation globally, infer permission from scraped prose, append contradictory technology paragraphs, or add a provider registry or automatically generated legal guarantees. Updating obsolete technology disclosures on those existing source documents remains separate work; analytics changes alone do not correct every copied privacy policy.

## Stored-data and release evidence

The September 7 read-only preflight found zero active published sites and zero hosted analytics events; local analytics was also empty. A forward migration rechecks emptiness under a short exclusive lock before removing obsolete identity/landing columns. It contains no data deletion. The migration and report calculations were exercised with seven synthetic events in one transaction and rolled back; no events or inquiries were retained. Local and Postgres report totals, comparisons, trends and dimensions agree.

The public-serving metadata audit verified 807 routes across 24 retained versions, with zero invalid root/site bindings. New response metadata supplies the exact published version after artifact verification; immutable artifacts are not rewritten. The real finalizer → public route → browser fixture verifies nested/custom-domain output, form version binding, stale-version rejection, empty anonymous browser storage and paused-site exclusion.

The guarded empty-data migration was applied under maintenance and the storage-free runtime patch `runtime_patch_8ee451f837e2495789de46745ff73104` is active. Both its public bytes and the prior immutable runtime bytes were verified. Coordinated release `34096252811` deployed compatible controllers and passed required health. Preserving the historical patch is not permission to reactivate its retired analytics contract or roll an incompatible controller back against the clean-cut schema. No historical artifact, source snapshot or runtime patch was rewritten.

## Owner-journey status

The September 6 onboarding hydration correction and publication timestamp correction are deployed. The latest Lodesta-owned canary successfully created, edited and published a site and retained one approved synthetic inquiry. It then found the missing browser version-context defect; analytics never initialized and authenticated inbox UI verification did not complete. Its empty storage observation was caused by that bug, not proof of privacy-minimal analytics.

That temporary site was disposed through the owner API and its public route returns 404; history remains retained. The owner-authorized additional test ran on a fresh Lodesta-owned site after confirming disabled notifications in web and worker. It verified empty anonymous storage, exact browser version binding, one retained inquiry and one analytics submission matched to a counted page view. It then found a separate [inbox-rendering defect](inquiry-inbox-contract.md). This test site was also disposed without changing retained history. All four live analytics views were checked at desktop/phone widths using existing read-only platform-admin preview; that is not a re-executed owner journey. Another inquiry requires renewed permission; do not reassign or republish either disposed site.
