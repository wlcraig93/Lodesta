# Canonical Site Quality

Status: canonical contract implemented and verified; whole-site canonical-generator validation complete, human calibration pending, September 1, 2026.

## Decision

Lodesta uses one versioned site-quality ontology for external websites, generated artifacts, published Lodesta sites, prospect reports, internal assessment, and generator experiments. Different consumers may show smaller projections, but they do not define separate meanings of quality.

The ontology separates three questions that must not be collapsed:

1. **Release integrity:** Is the site safe, factual, accessible enough, capability-correct, and functionally publishable? Deterministic blockers answer this.
2. **Measured Website Health:** What does the available, comparable evidence say about the site? The canonical report stores the numeric diagnostic and its coverage.
3. **Production readiness:** Is the design, copy, hierarchy, route system, and customer journey strong enough to ship? Canonical anchored criteria are labeled by a human until calibration proves a reliable automated evaluator.

The numeric diagnostic is not called an overall quality score. A qualitative band is suppressed whenever dimensions are unscored or the report is provisional. Public grades remain withheld pending calibration and explicit product-owner approval.

## Canonical dimensions

The registry retains ten dimensions: business truth, functional integrity, responsive usability, performance, accessibility, search and answer discoverability, content and intent coverage, trust and proof, conversion usability, and visual/editorial craft.

Every criterion now declares:

- the unit it judges: element, page, route family, site, or capability;
- how evidence aggregates: site-wide, any failure, worst case, or fraction passing;
- evidence tier: deterministic, browser, model, or human;
- explicit pass, warning, and fail anchors;
- applicability, evaluator, control owner, release disposition, and score/public eligibility.

Raw verifier IDs remain detector implementation details. Target adapters translate retained evidence into canonical criterion IDs.

## Input readiness and causal attribution

Site quality measures the visitor-facing result. Input readiness explains why that result may be weak; it is not a bonus or penalty folded into the site score.

For generated sites, retain a separate causal record for the authority and evidence the author received: source coverage and freshness, fact normalization, destination completeness, asset pixel suitability, logo-classification confidence, route-planning quality, and capability configuration. A technically valid input can still be visibly misleading—for example, an association-heavy co-branded badge classified as a business logo, or source punctuation that produces a malformed managed address. The assessment reports the visible site problem while attributing the likely control owner to source research, control plane, authoring, trusted capability, or verification.

The author may make evidence-bound visual judgments, such as declining to use a logo-classified asset whose pixels do not credibly represent the business. It may not silently rewrite normalized authority to make a score improve. Authority defects are corrected at their owning boundary and regenerated. This preserves one definition of output quality without confusing difficult inputs with acceptable outputs or turning source quality into an excuse for a weak site.

## Evidence and comparability

One criterion definition does not make unlike observations comparable. Each report stores a comparability key derived from:

- evidence class;
- registry and scanner identities;
- the four-slot route-sampling profile and resolved-route count;
- serving-contract identity;
- frozen reference-authority identity;
- complete-inventory identity;
- evaluator identities and availability.

Formal Measured Website Health deltas require identical comparability keys and complete evidence pipelines. A private preview is not an anonymous public serving environment and can never be silently compared with a live incumbent. For a direct old-site versus generated-site comparison, assess both through the same public-URL adapter on anonymous public URLs. Artifact-authority reports may be richer, but they are not substituted into that public comparison.

The complete eligible inventory remains useful for each site's absolute health, but an inventory-wide total is not compared across materially different inventories. Head-to-head production readiness uses the canonical four-slot sample: home, primary service, a second route from the same material family when available, and a conversion or FAQ route. Missing slots remain explicitly unresolved rather than being silently replaced with incomparable evidence.

Business truth uses a separate immutable reference authority. A `SitePublicBuildInput` may supply that ruler for both an incumbent and a generated site; its ID, hash, owner revisions, and source-snapshot identities form the reference identity. Site or association IDs may locate the authority but never change evidence collection or scoring. Without a shared reference, canonical-fact criteria are not applicable on either side. Generated fact-binding remains a Lodesta-only release check and does not contribute to the cross-site health diagnostic.

`unknown` is typed:

- site evidence missing;
- collector unavailable;
- evidence not retained;
- target structurally unobservable;
- inconclusive.

Structurally unobservable criteria are excluded from coverage denominators. Criteria such as HTTPS, field performance, canonical output, robots, and sitemap are not applicable to an unpublished artifact; they are evaluated at a public or published boundary.

## Production-readiness protocol

Generator benchmarks retain the full canonical assessment, not a detached score summary. A production-readiness review is bound to that assessment and its frozen four-slot route sample, and labels every required judgment criterion exactly once, with evidence:

- five-second clarity;
- decision support and route-family distinctiveness;
- opening specificity, customer decision language, cross-route coherence, and action truthfulness;
- visual distinctiveness, density and pacing, navigation presentation, and visible polish defects.

The review records `ship`, `needs_revision`, or `reject`. Benchmark automation may summarize cost, duration, failures, measured-health deltas, and review dispositions. It may declare the evidence ready for an owner decision; it may not automatically accept a generator treatment on subjective quality.

The current visual model remains advisory. Worst-case aggregation is reserved for deterministic evidence or an evaluator that has been calibrated for that exact criterion. Uncalibrated judgment uses anchored route-level labels and fraction-passing aggregation.

Artifact visual evidence is assembled from the exact retained route frames named to the evaluator; a broader prebuilt contact sheet is never relabeled as a narrower sample. When managed mobile disclosure is present, navigation presentation requires an opened-state frame. A closed header alone cannot establish that the interactive navigation presentation passes.

The four-slot sample is a bounded visual-judgment and comparison surface, not the technical release scope. Canonical finalization browser-checks every approved live route at desktop and phone sizes and checks the homepage at tablet size. This keeps close visual comparison tractable while ensuring a route-local overflow, unreadable mobile composition, broken image, console failure, or unreachable navigation state cannot hide outside the representative sheet.

## Calibration

Calibration is intentionally not manufactured in code. The next calibration corpus must include multiple verticals, source-quality levels, route counts, and visual directions. Reviewers label the canonical criteria against frozen native-viewport evidence before seeing model labels. Promotion of an automated criterion requires criterion-level agreement, false-positive and false-negative review, opportunity precision, reviewer agreement, readiness-disposition agreement, and explicit owner approval. Calibration does not maintain a competing numeric human score.

Until then:

- visual/editorial criteria do not contribute numeric points;
- public grades remain withheld;
- internal numeric values are labeled `Measured Website Health`;
- human production-readiness labels remain the authority for generator-quality decisions.

## Consumer projections

- The public/prospect report shows a concise, plain-language projection with the public grade withheld.
- Internal assessment exposes all criteria, evidence, ownership, coverage, and methodology.
- Release uses only deterministic blocking findings.
- Generator experiments use retained canonical assessments plus bound production-readiness reviews.

These are views of one contract, not four quality systems.

## Non-goals

This change does not add an automatic critic, repair continuation, mandatory generation phase, aesthetic release blocker, or owner-edit blocker. It does not claim that the current numeric weights or bands are calibrated. It adds no attempt counters or orchestration between the authoring model and its workspace.

## Follow-up

1. Reassess a matched public-URL corpus under the canonical contract.
2. Run the production-readiness labeling protocol on varied businesses and deliberately varied source quality.
3. Retain input-readiness evidence so failures can be assigned to their actual control owner.
4. Calibrate criterion by criterion; never promote an entire model evaluator as one unit.
5. Approve public band publication only as a separate product-owner decision.

Older assessment and calibration payloads remain retained as stale, inspectable evidence. They are never rewritten into the current contract and are not deleted merely to make the new schema pass. Any future prelaunch disposal must first export human labels and their pinned evidence into a content-addressed bundle.

The August 25 stored-data report found one retained assessment: an unrelated July 24 public-URL report already classified as stale schema, with no generated-site association and no retained production-readiness or calibration label. No row was mutated or deleted. The Geiger validation evidence remains content-addressed under `.design/` and was successfully reassessed through the current contract.

## Instrument validation and treatment evidence — August 25, 2026

The fresh Geiger treatment `run_ad6ed7656e0b4514a4942927784bb3d2` validated the canonical artifact adapter against a newly authored 24-route site. It passed the hard release gate and recorded 95.7 Measured Website Health. The qualitative band remained suppressed because the visual evaluator was unavailable, and the report correctly marked the evidence ineligible for a formal comparison. The canonical route selector resolved `/`, `/services`, `/services/pest-control`, and `/contact-us`; the artifact adapter and visual-evidence assembler now use that same selector rather than maintaining independent samples.

The treatment also validated the intended evidence boundary. A retained artifact title such as `Pest Control Services in St. Petersburg | Geiger's` may use a recognizable shortened brand after the separator without being misclassified as missing the full canonical business name. Ordinary screenshots are captured with transient focus removed, while the explicit opened-navigation frame preserves the focus evidence needed for navigation review.

Local review found a sound managed menu and form, coherent typography, and intact facts and destinations, but labeled the result `needs_revision`: the 24-route system repeated sparse detail structures, used a poster-like substitute for missing hero media, retained small shared text and target warnings, and included an awkward business-name CTA. Those observations produced prompt/context improvements, not a visual release blocker.

The separate L3 Paper & Paint treatment `run_21559c483e97435ea2c65fcb88df560f` passed the hard gate with ten consolidated routes and 97.6 Measured Website Health. It removed an invented monogram, used a distinctive type-led editorial system, produced a clean managed menu and custom form, and reduced cost and duration relative to the preceding matched treatment. Human review still found retained 214x120 source images enlarged into prominent placements. Because the same source-suitability problem survived two treatment runs, authoring inspection now reports prominent raster upscaling deterministically and advises either pulling a genuinely higher-resolution retained asset or using a type-led layout. This remains advisory and does not move presentation into trusted runtime or introduce a repair loop.

No public grade, calibration claim, or universal generator-quality claim follows from these two sites. The next quality experiment should test whether the new raster-suitability evidence changes author behavior on a fresh initial build before expanding the treatment screen.

## Canonical-generator production-readiness closure — August 25, 2026

The raster-suitability and authoring-context treatment was completed on two independent business shapes. Automotive r5 and wallcovering r5 both passed the hard release gate with zero retained warnings or blockers and 97.6 Measured Website Health. Informational measurements remain retained. Their qualitative bands remain suppressed because the visual dimension is intentionally human-labeled rather than fabricated.

Human review of exact retained source plus native desktop, phone, opened-navigation, representative-route, and contact-form captures applied the pre-existing nine-category R8 ruler. Its historical labels totaled 44/45 for automotive, 43/45 for wallcovering, and 42/45 for the strongest frozen R8 control. Those totals are retained provenance only. The review was unblinded and the ruler is not calibrated finely enough to distinguish 42 from 43 or 44. The supported conclusion is that the examples occupy the same competitive production-ready tier, with the canonical generator retaining a structurally cleaner navigation and form boundary; it is not a numerical superiority claim.

The final pair also closes the material defects observed in intermediate treatments: no invented mark or imitation lockup, no prominent raster beyond its intrinsic pixel role, no repeated catch-all route copy, no internal evidence language, no inactive control, and no navigation, form, destination, or infrastructure failure. A new `functional.noninteractive_control` blocker treats a field-like search/filter promise without behavior as a functional integrity violation. All other visual/editorial judgment remains authored and advisory.

The evidence supports releasing the focused authoring and functional-integrity changes while retaining the canonical quality architecture. It does not justify public grades, an automated aesthetic critic, deterministic visual templates, or weakened final verification. Full evidence is recorded in the retained production-readiness closure report.

## Fresh canonical-generator validation — August 24, 2026

Fresh model-authored run `run_51a76b34cca246a8a1684fa447be83be` passed the hard release gate with 27 routes and no sandbox replay, recycle, or transport timeout. Its corrected report records 94.2 Measured Website Health with the qualitative band suppressed, while the bound human review remains `needs_revision`. This is the intended separation: the generated site is technically healthy and visually promising, but repeated route templates, abstract process copy, a review route without reviews, and unresolved shared readability findings keep it below production-ready quality.

The validation also caught three evidence-adapter defects. Logo advisories no longer become broken-image failures through message-text matching; primary-heading geometry no longer becomes a heading-outline failure; and visual evaluation no longer reports full coverage when a selected route lacks an exact retained frame. Final verification now includes every canonical visual-review route in its capture set, and the evaluator reports unavailable rather than silently shrinking the sample.

The next canonical-generator treatment remains prompt-led: the existing message-target architecture mode, stricter consolidation of unsupported proof/review/jobs/city routes, concrete customer-decision language, closure of repeated shared readability findings, and a palette-coherent accessible navigation focus state. No aesthetic blocker or repair orchestration is introduced.

### Improved matched replicate

The matched Geiger replicate `run_4deee7260bd048b29c94beec09557f31` validated the direction. It passed the hard gate with 19 routes, no infrastructure recovery, $0.17767559 model cost, and a 1,034,583 ms duration. Relative to the first fresh treatment, routes fell from 27 to 19, model requests from 44 to 22, final `render.vague_process_copy` findings from 25 to 6, and Measured Website Health rose from 94.2 to 97.0. Unsupported reviews, city variants, search, sitemap, and staff routes were consolidated without losing supported service, locality, contact, FAQ, or evergreen-guide jobs.

Local review of all 27 exact retained frames found a coherent production-caliber visual direction, strong responsive hierarchy, a complete managed mobile menu, and an integrated managed form. The artifact remains `needs_revision` because one internal-provenance sentence, shared form/body text sizing, two narrow mobile detail splits, a few long lines, and residual abstract process phrases remained after the final successful inspection. This exposed a feedback-closure issue rather than a runtime defect: the inspection surfaced the evidence but its closing guidance still made operability the dominant finish condition.

Canonical inspection guidance now tells the author to rewrite every named internal-provenance example, replace named vague-process language with the concrete action or decision, and repair shared form, body, tiny-text, target-size, or narrow-split declarations before finish. These remain advisory evidence rather than release blockers. The change adds no retry, repair continuation, aesthetic gate, or orchestration.

### Production-polished reference

The improved replicate was then polished directly in retained experimental source until no further evidence-backed source change was warranted. The reference now passes the production browser gate with zero blockers across 19 routes and 1,028 checked links. A whole-site 1280px/375px review, with representative 768px and opened-navigation states, found no overflow, broken visible images, console or page errors, duplicate headings, missing required destinations, failed modal containment, internal provenance copy, vague process copy, narrow mobile splits, or long-line warnings.

The polish fixed an important failure of holistic review: the contact route had passed mechanical checks while its desktop eyebrow and heading were visibly pinned to the global header. Initial-build guidance now makes every representative route's header-to-opening transition an explicit visual-review responsibility while keeping it advisory. The same guidance requires visible copy, decision support, and closing actions to remain route-specific even when route families share structure. This is a context improvement, not a new gate or authoring phase.

One remaining advisory illustrates why input readiness stays separate from output quality. The retained logo-classified file is an NPMA QualityPro association badge rather than the business identity, and several retained service-area facts are malformed source fragments. The author correctly declined to use the badge and avoided exposing the fragments in visible copy. The upstream classification and normalized authority still require correction before this exact input could become production authority; silently rewriting them in authored source would violate the ownership boundary.

This hand-polished site is the current production-reference target for the canonical generator. It proves the runtime and source surface can support the desired result. It does not by itself prove that another first-pass generation will reproduce every correction; that requires a fresh, separately approved model run using the updated guidance.
