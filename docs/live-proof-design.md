# Live Proof Design — Google Rating on Generated Sites

## Problem

Reviews are the highest-conversion trust element for local services, but generated sites render zero proof. Policy (enforced by existing QA blockers `v2_google_places_static_proof_signal` and `v2_google_review_summary_rendered`) forbids persisting Google-derived rating values, review counts, or Maps URLs in stored site data. Proof must therefore be **live-resolved at render time** or owner-confirmed at claim.

## Decision

A render-time rating resolver with hard failure isolation, plus claim-time owner-confirmed review excerpts (follow-up; requires owner UI).

### Live rating resolver (`lib/live-proof.ts`)

- **Source:** official Google Places API v1 `places/{place_id}` with field mask `rating,userRatingCount`. The only persisted identifier is `googlePlaceId` on `business_locations` (already stored and policy-allowed).
- **Enablement:** `LODESTA_LIVE_PROOF_MODE=google_places` (default `off`). Requires `GOOGLE_PLACES_API_KEY` (already used by public-presence intake).
- **Failure isolation (all mandatory):**
  - Timeout: 1500 ms abort.
  - Circuit breaker: 3 consecutive failures opens the circuit for 5 minutes (per process).
  - Cache: in-memory per-process, 10-minute TTL per place_id (success and miss both cached to bound request rate).
  - Daily quota ceiling: `LODESTA_LIVE_PROOF_DAILY_QUOTA` (default 2000 resolutions/process/day); over quota → resolve as undefined.
  - **Silent omission:** any failure renders the page without the rating. Never an error state, never a placeholder.
- **No render blocking:** the rating renders inside a `<Suspense fallback={null}>` boundary in the V3 renderer, so the page shell streams immediately and the rating arrives (or doesn't) without delaying first paint. `/sites/[slug]` is already `force-dynamic`, so this adds no new dynamic rendering.
- **No persistence:** resolved values exist only in the in-memory cache. They never enter bundle JSON, artifacts, logs, or analytics payloads. Telemetry records only success/failure counters.
- **Display rule:** rating renders only when `rating >= 4.0` and `count >= 5` — below that it is omitted (a 3.2-star badge harms conversion and the omission is honest, not deceptive, since we link to the live profile via the existing directions/maps actions).

### Owner-confirmed review excerpts (follow-up, claim-flow UI)

At claim, owners select specific review excerpts they have rights to reproduce; stored as `customer_granted` content feeding `quote_wall`. Pre-claim candidates show only the live rating fact. Out of scope for this change — needs owner-facing UI.

### Trust facts (follow-up, understanding pass)

Years-in-business / family-owned / credential facts join the understanding-pass schema with provenance and render only when source-backed.

## Cost & quota

Places Details (basic + rating fields) is in the lower price tier; with the 10-minute cache, worst case is 6 calls/hour per actively-trafficked site. The daily ceiling caps a runaway crawler at `LODESTA_LIVE_PROOF_DAILY_QUOTA` calls. Circuit breaker prevents hammering during outages.

## Verification

- Unit: circuit-breaker open/close, cache TTL, quota ceiling, timeout → undefined, display-rule thresholds (mock fetch).
- Policy: assert resolved values never appear in stored bundle JSON (existing policy checks remain).
- Render: page renders identically with mode off, with resolver failing, and with resolver succeeding.
