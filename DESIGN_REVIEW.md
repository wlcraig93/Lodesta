# Design Review: Marketing Homepage Launch Readiness

Reviewed against: `docs/design/lodesta-product-design-language.md`, the current product scope in `README.md`, the rendered local homepage, and `https://dev.lodesta.com/`

Date: 2026-07-27

## Screenshots Captured

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/homepage-launch-readiness-2026-07-27/review-homepage-live-desktop-1280-top.png` | Desktop (1280×800) | Deployed header, hero, report entry, and primary navigation |
| `screenshots/homepage-launch-readiness-2026-07-27/review-homepage-tablet-768-top.png` | Tablet (768×1024) | Header reflow, hero hierarchy, and report entry |
| `screenshots/homepage-launch-readiness-2026-07-27/review-homepage-live-mobile-375-top.png` | Mobile (375×812) | Header, hero copy, and initial report entry |
| `screenshots/homepage-launch-readiness-2026-07-27/review-homepage-desktop-1280-checks.png` | Desktop (1280×800) | Health-lens section heading |
| `screenshots/homepage-launch-readiness-2026-07-27/review-homepage-desktop-1280-lenses.png` | Desktop (1280×800) | Five health lenses and report transition |
| `screenshots/homepage-launch-readiness-2026-07-27/review-homepage-desktop-1280-report.png` | Desktop (1280×800) | Illustrative report |
| `screenshots/homepage-launch-readiness-2026-07-27/review-homepage-desktop-1280-flow.png` | Desktop (1280×800) | Managed product workflow |
| `screenshots/homepage-launch-readiness-2026-07-27/review-homepage-desktop-1280-comparison.png` | Desktop (1280×800) | Builder/agency/Lodesta comparison |
| `screenshots/homepage-launch-readiness-2026-07-27/review-homepage-desktop-1280-closing.png` | Desktop (1280×800) | Closing report CTA and footer |

The browser's automated full-page compositor produced tiled or blank captures for this page. The viewport and scrolled section captures above are the reliable visual record used for the review.

## Summary

The homepage has a credible, distinctive visual foundation: the wordmark, editorial type scale, warm paper/forest palette, report artifact, and restrained information graphics feel more considered than a generic AI-SaaS landing page. It is not ready for a broad public launch yet. The current experience is positioned primarily as a free website-audit funnel, contains a visible desktop CTA contrast failure and oversized responsive header, and waits too long to show what Lodesta actually is, how it works, and why an owner should trust it with a business-critical website.

It is suitable for a controlled acquisition test after the objective defects are fixed if the test is specifically about demand for the Website Health Report. It is not yet a strong category-defining company homepage.

## Must Fix

1. **Unreadable desktop navigation CTA.** The deployed “Check my website” link renders dark green text on a dark green background. The computed foreground is `rgb(20, 39, 30)` and the background is `rgb(23, 63, 53)`. See `review-homepage-live-desktop-1280-top.png`. The more specific `.marketing-header .app-nav a` color rule overrides `.button.primary` in `app/globals.css`. Fix the color contract and verify default, hover, focus, and active contrast.

2. **Responsive header is inheriting product-shell behavior.** At 768px and 375px the shared `.app-header` media rule changes the marketing header to a grid, stacking the logo and sign-in action. The deployed header is approximately 183px tall at tablet and 176px tall on mobile. See `review-homepage-tablet-768-top.png` and `review-homepage-live-mobile-375-top.png`. Give the marketing header an intentional mobile layout that remains compact and keeps the brand and account action on one row.

3. **The value proposition does not lead with the product.** The hero at `app/(marketing)/page.tsx:46` presents Lodesta first as a free diagnosis of customer loss. The managed website product does not become explicit until the section beginning near `app/(marketing)/page.tsx:121`, roughly 3,000 rendered pixels down the desktop page. A launch visitor should understand within the hero that Lodesta creates, improves, publishes, and manages the website under owner control.

4. **No concrete product or outcome proof.** The strongest proof object is explicitly a synthetic report. There is no real product workspace, private site preview, before/after example, founder/customer validation, or quantified outcome. Pre-launch status explains the lack of customer proof, but not the lack of product proof. Add honest evidence that exists today and label synthetic or illustrative material precisely.

## Should Fix

1. **Resolve the mismatch between fear-led acquisition and reassuring brand voice.** “May be costing you customers” and “they lose customers” create the scare frame that the page later says it is not using. Keep the urgency, but lead with the positive outcome and use the diagnostic as the low-risk entry point.

2. **Clarify the category and ideal customer.** “AI website manager for local businesses” is promising but still broad. State who gets the most value now, whether Lodesta improves an existing website or replaces it, and what “manager” owns over time.

3. **Move differentiation into the first viewport.** “Describe the outcome. Lodesta executes. You review … and publish” is the best concise expression of the model, but it appears close to the bottom of the page. Bring this owner-control distinction into the hero or immediate proof band.

4. **Show the website result, not only the diagnostic process.** The report demo is polished but makes the product feel like an auditor. Pair it with a real private preview, an owner-request interaction, and the resulting published-quality website.

5. **Reduce repeated abstractions.** “Evidence-backed,” “generic score,” “what is working,” and “what could improve” recur often. Replace some repetitions with concrete owner outcomes: accurate services and service areas, more qualified calls, easier updates, and a website that stays current.

6. **Raise mobile body copy to the documented 16px minimum.** The live mobile hero body computes to about 15px because `font-size: 0.94rem` is applied at `app/globals.css:10429`.

7. **Consolidate the marketing CSS.** The stylesheet contains an earlier marketing system near the beginning of `app/globals.css`, shared product breakpoints in the middle, and a second “evidence-led editorial direction” beginning at `app/globals.css:9602`. The cascade is already producing the CTA and header defects. Keep one canonical marketing implementation.

## Could Improve

1. Add one restrained visual moment that makes the managed-agent interaction memorable. The current system is handsome but mostly typographic and rectangular.

2. Tighten several large blank transitions on desktop. The spaciousness supports the editorial direction, but some intervals feel like separate presentations rather than one persuasive story.

3. Make the comparison section more specific. “Website builder / traditional agency / Lodesta” is useful, but the comparison would be stronger if it mapped owner effort, speed of changes, ongoing maintenance, and approval control.

4. Replace the generic “sample local service business” with a believable, clearly fictional mini-case containing a business category, location, visible before/after issue, and resulting site change.

## Recommended Homepage Quality Process

Use an adapted Gauntlet Loop as a one-off internal design and positioning process, not as new orchestration in Lodesta's customer-site authoring runtime.

1. **Lock the launch decision first.** Define the primary audience, the single launch conversion, the product promise that is true today, and claims that are off limits.

2. **Choose criterion-specific bars.** Use excellent real examples for distinct jobs rather than asking one homepage to be “better than” a single competitor:
   - outcome-led positioning and proof;
   - managed-service clarity;
   - product visualization and explanation;
   - visual identity and craft;
   - conversion and risk reduction.

3. **Explore three genuinely different narratives.** For example: managed website partner, owner-directed AI website manager, and evidence-first improvement service. Build each far enough to judge the whole story before polishing one.

4. **Split the winning direction into separately judged workstreams.** Positioning and hero, information architecture, visual system, product proof, trust/copy, conversion, and responsive/accessibility should each have a builder and a separate critic with fresh context.

5. **Make critics inspect the artifact.** Give them the live page, screenshots at 375/768/1280, the copy without styling, the product truth, and the comparison set. Do not let them grade a builder's explanation.

6. **Use a launch rubric.** Require fast comprehension of what/who/outcome, a credible reason to believe, visible differentiation, one obvious action, factual safety, responsive quality, and accessibility. Subjective preferences can guide a choice but should not masquerade as objective failures.

7. **Run an integration pass after each major wave.** One editor should make the result feel like a single brand and narrative after specialists improve individual parts.

8. **Finish with humans from the target audience.** Five short first-impression sessions will reveal category confusion and trust objections that model-on-model comparisons cannot. Ask what Lodesta does, who it is for, why it is different, what feels risky, and what they would do next.

## Launch Recommendation

Do not use the current page unchanged for a broad launch. Fix the objective rendering/accessibility defects immediately, then run the positioning-first process above. Preserve the current editorial visual DNA and report artifact as useful ingredients, but rebuild the narrative around the managed outcome and owner control.
