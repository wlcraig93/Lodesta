# Inquiry inbox contract correction

September 7, 2026. Correction passes full local preflight (including the repository/browser fixture) and launch-flow smoke; coordinated follow-up deployment remains pending.

The privacy-minimal owner-journey test on release `4cc3fc233e5625bec14efff8b5a2fe75eee1c4fc` created, edited and published a Lodesta-owned site. Its one authorized synthetic inquiry was accepted and retained once, with the exact published version and a matching page-load analytics event. Anonymous cookies, localStorage and sessionStorage were empty. The owner inbox then crashed with `Cannot read properties of undefined (reading 'replaceAll')`.

## Cause

The canonical database `inquiries` table has no `notification_state`, `ai_enrichment_state` or `ai_enrichment_error` columns. The Supabase repository nevertheless asserted those fields existed. With no optional enrichment document, the inbox formatted the nonexistent enrichment state. The local repository fabricated `queued` values, hiding the hosted mismatch. CSV export read the same nonexistent states and could also fail.

This is an application contract/UI defect, not an infrastructure timeout, failed form submission or lost inquiry. No notification or enrichment consumer exists to fulfill the advertised queued state. Adding columns or a worker would implement a different product decision instead of fixing the mismatch.

## Correction and verification

- Remove the phantom fields from the canonical type, both repositories and CSV. Render the original inquiry and workflow controls without a fictitious pending-triage panel. Retained optional enrichment and its timestamp remain readable; no database rows or columns are changed.
- Bind inbox timestamps to the existing site reporting timezone and a server-provided reference timestamp. The new hydration fixture also reproduced differing server/browser clock output; neither hidden client-only rendering nor suppressed hydration warnings are used.
- Exercise the actual Supabase mapper using the baseline row shape against a loopback server, then the real CSV route and server-rendered/hydrated inbox component. Test message visibility, status changes, phone layout and differing server/browser timezones. No hosted write or external notification is needed for this fixture.
- Read-only live audit: two retained inquiries, both with null enrichment. The new synthetic inquiry has exactly one submission event and one matching analytics submission. The temporary site is paused/unowned and its public route returns 404; retained history is unchanged.

The same visual check found an invisible single-interval trend path and a mobile header that mislabeled paused retained publications as live. A visible pair of single-point markers and an active-plus-published label condition fix those presentation defects without changing analytics collection or site lifecycle.

## Evidence and limitations

- Canary: `20260907T075002Z-6d56d33b`; site `site_a4d6a74c0524d03cc6559ec96e80df21`.
- Initial run `run_7d267b960d45212de74a2981311c8324` passed: three routes/five files, about 7.5 minutes, $0.15689762 catalog estimate, one rejected edit operation. This was not a perfect first pass.
- Edit run `run_3b9ce1a615ce4dc9936418f47e36079b` passed in about 94 seconds at $0.01157768 catalog estimate, after one rejected JSX syntax mutation. Published version `version_ca0402f74fbb24741289346a5861bd2b`.
- Inquiry `inquiry_2c149fdac66e464f85b89de414a88bde`; form `form_contact_8558f25cf5894ba9ba43460d`.
- Private canary result/screenshots are under `.data/owner-journey/20260907T075002Z-6d56d33b/`; `privacy-canary-delivery.json` and the `inbox-regression` captures are in the September 4 readiness evidence directory.

The end-to-end owner-journey run is **failed**, not retroactively passed by the component fix. Existing read-only platform-admin preview can inspect the retained inbox and analytics without restoring ownership or publication. That is a distinct verification mode, not a fresh owner journey. Another synthetic submission requires renewed permission. The multi-business generator quality screen remains unstarted.
