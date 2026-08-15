# Generated-site copywriting research and decision

Date: 2026-07-28

## 2026-07-29 calibration update

The original model-judged experiment substantially overrated the first
rule-heavy copy skill. The product owner correctly rejected examples that the
rubric treated as strong, including keyword piles and internal “next step”
language.

A five-vertical held-out calibration replaced that skill with a smaller direct
local-business standard and cleaned visitor-sounding route-plan language. The
new standard improved calibrated hero copy from 6.1 with 8 / 10 publishable to
6.5 with 10 / 10 publishable. A separate section-planning call and a global
copy-edit pass did not improve quality enough to justify production complexity.

The canonical decision remains one author pass, but the supporting skill is now
the compact calibrated standard. Complete-site model judging was too unstable
to establish a broad numerical win, so retained human blind review and future
field evidence remain necessary. See
`.design/local-copy-calibration-2026-07-29/RESULTS.md`.

## Original 2026-07-28 decision

Lodesta should use one capable website-authoring model with a dedicated, versioned local-business copy skill inside the existing authoring context.

The default production path should not add a top-down copy orchestrator, a per-block tournament, a multi-pass critic, or an automatic repair loop. Those approaches add cost, latency, failure surface, and message fragmentation without producing a reliable quality gain in the controlled experiment.

If Lodesta later offers an unusually high-touch or operator-assisted tier, a whole-page tournament is the only multi-candidate approach worth further study. It should compare complete, coherent pages, retain the selected original unchanged, and remain advisory until calibrated against human ratings.

## What was wrong

The current source-preparation and authoring brief are already unusually strong. They provide canonical business identity, services, locations, service areas, contacts, supported claims, business-story evidence, customer journeys, proof cautions, evidence gaps, capabilities, and route opportunities.

The copy guidance did not match that context quality:

- The website-manager prompt assigned copywriting to the general site author but supplied only broad instructions to be specific, faithful, substantive, and evidence-bound.
- The `website-authoring` skill mixed factual, visual, responsive, accessibility, and operational guidance. It had no copy-specific message standard.
- Nothing told the writer what the opening unit must communicate, how to turn source facts into a differentiating message, how to test a generic headline, how to use customer situations, or how to label capability-bound actions truthfully.
- The assessment rubric now contains useful advisory concepts such as five-second clarity and decision support, but they do not provide drafting guidance and should not become an automatic repair loop.

The retained Prime Plumbing experiment illustrates the gap. Its broad authoring pass produced “Expert help. Right when it matters.” The neighboring eyebrow and supporting line partly rescued the meaning, but the headline itself was reusable by nearly any local service business and spent the page's strongest line on an unsupported mood.

## Skill landscape

### Available locally

The installed generic `copywriting` skill is a useful SaaS and landing-page foundation. It emphasizes clarity over cleverness, benefits, specificity, customer language, scannability, honest claims, page flow, and direct calls to action.

The installed `copy-editing` skill provides seven sequential sweeps for clarity, voice, relevance, proof, specificity, emotion, and risk. Those sweeps are useful as a human editing checklist, but running them automatically as model stages would conflict with Lodesta's simplification doctrine and create exactly the kind of critic loop the production architecture is intended to avoid.

Neither skill encodes the constraints that matter most for Lodesta:

- source-evidence boundaries;
- local category, market, and service clarity;
- sparse-proof behavior;
- honest mapping from platform capability to CTA;
- the counterfactual-swap test;
- customer decision support across a complete local-business site;
- coherence between blocks and routes.

### External options

The live OpenAI curated skill catalog did not contain a copywriting skill when checked on 2026-07-28.

The broader community has many copywriting skills, but the strongest discoverable options are mostly generic landing-page or direct-response systems. For example, [Corey Haines' Marketing Skills](https://github.com/coreyhaines31/marketingskills/tree/main/skills/copywriting) is the source family for the useful generic skill already installed. [Rob Palmer's copywriting skills](https://github.com/robpalmer99/claude-code-copywriting-skills) cover direct response, ads, landing pages, and copy-chief workflows, but their long-form persuasion formulas and claim-heavy posture are a poor default for evidence-constrained local businesses.

The gap is not another generic framework. It is a small Lodesta-specific translation layer between excellent business evidence and publishable local-business copy.

## Research synthesis

### Harry Dry

I treated Harry Dry and Ramp as two separate references; the sources reviewed did not establish that Harry Dry writes for or works at Ramp.

The most transferable Harry Dry principles are:

- edit aggressively, avoid exaggeration, use active voice, write how people talk, keep sentences short, and remove vague landing-page words and adjective-led claims ([17 tips for great copywriting](https://marketingexamples.com/copywriting/tips));
- make value concrete, call out the intended reader, write to one person, and use calls to value rather than empty calls to action ([7 practical ways to write copy that converts](https://marketingexamples.com/copywriting/conversion));
- mine the customer's frustrations and ordinary words instead of guessing at a polished brand voice ([Let your customers write your copy for you](https://marketingexamples.com/copywriting/customers));
- reject titles that sound polished but say nothing, generate alternatives, and test whether the line is remembered for a specific idea ([How to write a landing-page title](https://marketingexamples.com/landing-page/titles));
- lead with a differentiator and write a title only that business can credibly use ([Rewriting landing pages with a pro copywriter](https://marketingexamples.com/landing-page/rewrites)).

For Lodesta, “only this business can sign it” becomes a counterfactual-swap test:

> If twenty nearby competitors could paste this line onto their homepage unchanged, it is not finished.

That test catches “Expert help when you need it” immediately. It also avoids prescribing a rigid headline formula: category, market, customer situation, proof, or differentiator can appear across the complete opening unit as long as the result is unmistakable.

### Ramp

Ramp is useful as a compression and rhythm reference. Its current homepage opens with “Time is money. Save both.” and immediately follows with concrete product scope and a direct action ([Ramp homepage](https://ramp.com/)).

Lodesta should borrow the discipline, not the ambiguity. Ramp has enough category awareness and supporting product language to make a compressed promise work. An unknown local business usually does not. A local-business opening still needs to establish category or service, market or audience, relevant value, and a truthful next step within the first scan.

### Local and search context

Local-business copy has a different job from a SaaS brand campaign:

- Google advises businesses to keep information complete, accurate, and detailed so customers can understand what the business does, where it is, and when it is available ([local ranking guidance](https://support.google.com/business/answer/7091?hl=en)).
- Google's people-first guidance favors useful, substantial, audience-serving content with descriptive headings and clear trust signals, not thin pages written mainly to capture search traffic ([people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)).
- Google's title-link guidance recommends descriptive, concise titles and warns against vague boilerplate and keyword stuffing ([title-link guidance](https://developers.google.com/search/docs/appearance/title-link)).

The practical local-business standard is uncertainty reduction. A visitor should be able to answer:

1. Is this the kind of business or service I need?
2. Does it serve my location or situation?
3. What exactly can it help with?
4. Why should I believe or choose it?
5. What happens when I call, visit, or submit this form?

## Controlled experiment

The experiment is retained in [`.design/copy-quality-experiment-2026-07-28`](../.design/copy-quality-experiment-2026-07-28/README.md).

### Fixtures

Three fixtures tested different evidence and buying situations:

1. Prime Plumbing & Heating: rich evidence and an urgent home-service journey.
2. Northstar Collision Repair: sparse evidence and an urgent service journey.
3. Cedar & Stone Hair Studio: moderate evidence and an appointment-led journey.

Every strategy received the same source-grounded fixture. No strategy was allowed to invent availability, response times, prices, guarantees, ratings, credentials, outcomes, service details, geography, or capabilities.

### Strategies

| Strategy | Model pattern | Production implication |
| --- | --- | --- |
| `current_direct` | One broad authoring pass | Approximation of current guidance |
| `local_copy_skill` | One pass with Lodesta-specific copy knowledge | Proposed default |
| `message_architect` | Message-plan pass, then writer pass | Top-down orchestrator |
| `whole_page_tournament` | Four complete drafts, then unchanged selection | Coherent tournament |
| `block_tournament` | Generate and choose blocks independently | Per-block tournament |
| `bounded_gauntlet` | Skill draft, critique, one revision | Critic/refine loop |

Two model judges scored anonymized candidates in different orders for factual support, five-second clarity, specificity, customer language, decision support, proof use, message coherence, economy, and distinctiveness. Scores are diagnostic, not a substitute for human conversion data.

### Aggregate result

| Strategy | Mean score / 10 | Unsupported-claim findings | Approximate relative generation cost |
| --- | ---: | ---: | ---: |
| `local_copy_skill` | **9.00** | **0** | 1.0x |
| `whole_page_tournament` | 8.71 | 0 | 4.9x |
| `message_architect` | 8.70 | 2 | 2.2x |
| `current_direct` | 8.35 | 6 | 0.7x |
| `block_tournament` | 8.35 | 0 | 3.6x |
| `bounded_gauntlet` | 8.26 | 1 | 3.2x |

The whole experiment used 46 model requests and an estimated $1.64 in model spend. One multi-pass generation returned an incomplete structured response and required a larger retry.

### What the outputs showed

The copy skill improved the baseline in every fixture:

- Prime: 8.61 to 9.17
- Northstar: 7.89 to 8.83
- Cedar & Stone: 8.56 to 9.00

It also removed all judge-identified unsupported claims. Its representative headlines were concrete:

- “Denver-area plumbing and HVAC for leaks, clogs, hot water, heating, and cooling”
- “Collision repair for Austin drivers at 701 E 5th St”
- “Wearable haircuts and color planned around your routine”

The message architect won the rich Prime case, then fell below the direct skill on the sparse Northstar case and introduced unsupported form-detail claims. Planning quality did not generalize well enough to justify a mandatory production stage.

The whole-page tournament won two individual fixtures by narrow margins, but lost badly on Prime and cost roughly five times the direct skill. It is a plausible premium experiment, not a default.

The block tournament produced individually serviceable lines but weaker complete pages. The result supports the expected failure mode: blocks repeat ideas, shift voice, and optimize local cleverness instead of one page argument.

The bounded gauntlet did not reliably improve its starting draft. On Northstar it degraded a strong skill draft into a 6.67 result with a section literally headed “test.” More passes increased drift and failure surface.

### Limitations

- Three fixtures are enough to reveal failure modes, not to estimate real conversion lift.
- Each strategy ran once per fixture.
- Both judges were language models; one shared the generator model family. Different candidate order reduced position bias but did not remove self-preference or rubric bias.
- The score does not measure visual-copy interaction, actual leads, call quality, owner preference, or long-run SEO performance.
- The direct baseline was a faithful approximation of current broad guidance, not a replay of an entire site-authoring run.

The result is still decisive for architecture because the simplest candidate was the only one that improved every fixture, produced no unsupported-claim findings, and avoided extra stages.

## Implemented production shape

The versioned `local-business-copy` skill is now nested in the existing `website-authoring` task skill and travels in the stable authoring context. Its identity is also retained in run `skillVersions`.

It adds:

- the five-second opening-unit standard;
- customer decision support as the page's job;
- the counterfactual-swap test;
- evidence-earned specificity;
- a concrete cliché exclusion list;
- customer-situation and ordinary-language guidance;
- proof placement and sparse-evidence behavior;
- truthful capability-to-CTA mapping;
- silent use of evidence gaps and capability limits instead of customer-facing internal disclaimers;
- whole-page and cross-route coherence;
- descriptive metadata and anti-thin-page guidance;
- one-pass quality criteria without a new model stage.

There is no new orchestrator, generator count, selector, critic, repair continuation, convergence rule, release blocker, or subjective quality gate.

## Measurement plan

The next evidence step should be calibration, not more orchestration:

1. Retain copy-skill identity with every generation, which the implementation now does.
2. Assemble a fixed benchmark of rich, sparse, urgent, considered, appointment-led, storefront, and multi-location businesses.
3. Blind-rate complete rendered pages with local-business operators or copy editors on factuality, five-second clarity, specificity, decision support, coherence, and action truthfulness.
4. Track severe factual/capability mistakes separately from subjective quality.
5. Use the existing assessment concepts as advisory diagnostics; do not automatically trigger rewrites.
6. Compare real downstream behavior when available: qualified calls, completed forms, wrong-service inquiries, form abandonment, and owner edits.
7. Version the skill only when benchmark and field evidence support a change.

If a later benchmark shows a consistent, material whole-page-tournament advantage, record an explicit product-owner decision before adding it to the production workflow.
