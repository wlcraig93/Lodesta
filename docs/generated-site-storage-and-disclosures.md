# Generated-site storage and disclosure audit

Status: September 6, 2026 implementation audit; not a universal legal-compliance certification.

The product owner explicitly approved a labeled Lodesta-owned publication/inbox canary and correcting obsolete technology disclosures for new sites, while preserving unrelated legal terms and historical artifacts. Do not publish prospect businesses for this test.

## Current behavior

The canonical trusted runtime uses first-party local storage when analytics is enabled on a published site. It does not write document.cookie. `lodesta_analytics_visitor_<siteId>` retains a random visitor ID, first-seen time, and last non-direct attribution with an application-managed 395-day expiry renewed on each visit. `lodesta_analytics_visit_<siteId>` retains visit/landing/attribution state; a new visit begins after 30 minutes of inactivity. Local storage does not automatically delete expired entries; the runtime checks timestamps when next accessed.

The runtime sends first-party /api/analytics events for page views, engagement time/scroll depth, selected action clicks, form activity and limited performance measurements. Payloads include site/version, page and landing paths, random visitor/visit identifiers, referrer host, bounded campaign fields and device category. Server ingestion scopes/hashes visitor and visit identifiers. Form submissions separately send configured field values to the business's managed inbox.

Preview/internal inspection contexts suppress analytics. The ordinary Google rating is authored text plus an external link; it does not load a Google SDK or review widget. Assets/fonts and the trusted runtime are served locally. Owner/account authentication, protected-preview access cookies and Lodesta product theme preferences are separate from ordinary anonymous customer-site visits. Hosting-layer response cookies still require a fresh-browser check; absence of document.cookie calls does not prove their absence.

## Consequences

Do not describe published sites as having no tracking/storage simply because conventional analytics cookies are absent. Do not carry forward Google Analytics, Google Tag Manager, WordPress, Vimeo or embedded Maps descriptions unless the actual new implementation uses them. A privacy/storage disclosure and a consent interface are different questions. Requirements depend on applicable jurisdiction, purposes, configuration and exemptions; local storage is not a blanket exemption. Current source audit has not found a visitor analytics opt-out or consent gate in the canonical runtime.

California's guidance explains privacy-notice obligations for covered commercial sites collecting personal information. UK guidance explicitly covers storage/access technologies and narrow exceptions, including conditions on statistical uses. These references do not establish that every US local-business site needs a banner, or that the current implementation meets an exemption:

- https://oag.ca.gov/sites/all/files/agweb/pdfs/cybersecurity/making_your_privacy_practices_public.pdf
- https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/

## Implementation boundary

The first September6 owner-journey test authenticated successfully but performed a native GET to onboarding with a sourceUrl query rather than the creation API. A second instrumented attempt reproduced it, with no bootstrap response or created test site. WebsiteOnboardingForm now keeps the server-rendered controls disabled until hydration attaches its handler. A local browser regression exercises the actual component before/after hydration, empty validation, a single pending API submission, and a recoverable server rejection. Hosted retest is pending deployment; this must not be counted as a passed customer workflow.

The canary also separates anonymous public visitors from authenticated owner inbox review, captures creation IDs before navigation for precise cleanup, and records cookie names/storage field names without identifier values. These are test corrections, not changes to analytics collection.

Preserve immutable runtime/artifact/source history. The legal-preservation gate currently compares the original document without an explicit owner-replacement authority, so a legitimate replacement must be represented through the existing control-plane/source authority before it becomes the new comparison target. Do not weaken legal preservation globally, infer permission from scraped prose, or simply append contradictory technology paragraphs to pass similarity checks.

Prefer one accurate implementation-evidence description and explicit owner-approved source replacements over a provider registry, auto-written legal guarantees or a new consent platform. Any change to analytics collection itself must record its dashboard/attribution tradeoff and verify retained-runtime behavior separately; the disclosure correction is not evidence that analytics behavior has changed.
