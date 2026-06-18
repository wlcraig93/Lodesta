# Design Review: Mencia Auto Body & Paint Candidate

Reviewed against: generated site candidate `sitecand_761e84e7ef1643e6895f29eaaacae189`
Related brief: `.design/admin-generation-portal/DESIGN_BRIEF.md` for the operator review surface
Date: 2026-06-17

## Screenshots Captured

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-mencia-home-desktop-1280.png` | Desktop (1280x900) | Home page full-page render |
| `screenshots/review-mencia-home-tablet-768.png` | Tablet (768x1024) | Home page full-page render |
| `screenshots/review-mencia-home-mobile-375.png` | Mobile (375x812) | Home page full-page render |
| `screenshots/review-mencia-auto-body-repair-desktop-1280.png` | Desktop (1280x900) | Auto Body Repair service page |
| `screenshots/review-mencia-auto-body-repair-tablet-768.png` | Tablet (768x1024) | Auto Body Repair service page |
| `screenshots/review-mencia-auto-body-repair-mobile-375.png` | Mobile (375x812) | Auto Body Repair service page |
| `screenshots/review-mencia-paint-services-desktop-1280.png` | Desktop (1280x900) | Professional Paint Services page |
| `screenshots/review-mencia-paint-services-tablet-768.png` | Tablet (768x1024) | Professional Paint Services page |
| `screenshots/review-mencia-paint-services-mobile-375.png` | Mobile (375x812) | Professional Paint Services page |

All screenshots are in `.design/admin-generation-portal/screenshots/`.

## Summary

The candidate is structurally solid: the home page has a sensible local-service sequence, all primary images loaded, there is no horizontal overflow, CTAs are above the fold, and sampled text contrast passes AA. Visually, it reads as a competent generated local-business template rather than a distinctive, high-trust auto body site. The most serious issue is functional: the header and quote navigation expose pages that are not part of the generated page set.

## Must Fix

1. **Visible navigation points to missing generated pages**: The candidate only contains `/`, `/services/auto-body-repair`, and `/services/professional-paint-services`, but the header links to missing routes including `/services/scratch-repair`, `/services/paintless-dent-repair`, `/services/hail-damage-repair`, `/services/collision-repair`, `/services/free-repair-quote`, `/case-studies`, `/gallery`, `/contact`, `/locations`, and `/faq`. See `review-mencia-home-desktop-1280.png`. Fix by generating those pages or converting those items to in-page anchors that exist.

2. **Primary quote CTA in the header routes to a missing page**: `Get a Free Quote` links to `/services/free-repair-quote`, but that page is not generated. This is a conversion-critical path. Fix by linking the header CTA to `#contact` or generating a real quote page.

## Should Fix

1. **Brand expression is underdeveloped**: The navy, blush, serif, and shop imagery are polished enough, but they feel generic and interchangeable. Add stronger business-specific identity moments such as real logo treatment, sharper Austin/local context, a more distinctive hero proof line, or a branded before/after module.

2. **Proof is present but not strong enough for collision/paint trust**: The before/after section helps, but the page needs more confidence builders near CTAs: warranty language, insurance process details, real review snippets if licensed, certifications, estimate process, or turnaround expectations.

3. **Service-page first screens are sparse**: The service pages have strong headlines and CTAs, but the desktop pages spend too much vertical space before showing concrete evidence. Move a proof point, process summary, or detail image closer to the first viewport.

4. **Mobile home page is usable but long and repetitive**: The stacked service cards, process cards, FAQ, contact form, and location block all work, but the rhythm becomes monotonous. Compress secondary metadata and vary section layouts so mobile feels more guided.

## Could Improve

1. **Typography could use more hierarchy discipline**: The chunky editorial headings give character, but several sections use similarly heavy headline weights. Reserve the largest visual weight for hero and conversion sections.

2. **Form presentation could feel more premium**: The contact form is clear, but it looks utilitarian compared with the rest of the page. Slightly richer spacing, field grouping, and a stronger submit affordance would help.

3. **Map rendering note**: The full-page screenshot showed a gray map area, but the section crop loaded the map correctly. Treat this as a screenshot artifact, not a current design defect.

## Automated Render Notes

- Broken images: 0 across home and service pages.
- Horizontal overflow: 0px across desktop, tablet, and mobile.
- CTA above fold: detected on all reviewed pages.
- Minimum sampled text contrast: above AA in the render metrics.
