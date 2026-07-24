# Design Review: TJ Plumber Austin Candidate Site

Reviewed artifact: `artifact_f18150a900a4ef51baaaf962aea71c65`

Candidate version: `version_68dd98ad9457bdc8e878e2311030ced5`

Date: 2026-07-24

Review basis: overall quality as a US local small-business website. There is no customer-specific design brief, so this review uses a practical local-service benchmark: immediate clarity, trust, mobile usability, conversion, accessibility, content depth, and local-search readiness.

## Overall Score

**68/100**

The site has a polished, credible-looking homepage and a clear call-first conversion path. It is above average visually for a local small-business site, but it does not yet feel complete enough to be a high-performing professional plumber site: service pages are extremely thin, proof is absent, the mobile header action is visually ambiguous, the contact location component is visibly clipped, and automated review found repeated contrast and small-text issues.

| Area | Score |
| --- | ---: |
| First impression and visual polish | 17/20 |
| Clarity and navigation | 11/15 |
| Conversion path | 12/15 |
| Trust and credibility | 7/15 |
| Content depth and local SEO | 7/15 |
| Mobile and accessibility | 8/10 |
| Technical and functional completeness | 6/10 |
| **Total** | **68/100** |

## Screenshots Reviewed

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/home-desktop.png` | Desktop | Full homepage |
| `screenshots/home-tablet.png` | Tablet | Full homepage |
| `screenshots/home-mobile.png` | Mobile | Full homepage |
| `screenshots/services-water-heater-repair-desktop.png` | Desktop | Representative service page |
| `screenshots/services-water-heater-repair-tablet.png` | Tablet | Representative service page |
| `screenshots/services-water-heater-repair-mobile.png` | Mobile | Representative service page |
| `screenshots/contact-desktop.png` | Desktop | Contact and estimate form |
| `screenshots/contact-tablet.png` | Tablet | Contact and estimate form |
| `screenshots/contact-mobile.png` | Mobile | Contact and estimate form |
| `screenshots/contact-sheet.png` | Mixed | All generated route captures |

## What Works Well

1. **Strong first screen:** The homepage immediately communicates plumbing, Austin, 24-hour availability, the phone number, and an estimate path. The hero image, headline, and CTA hierarchy are effective.
2. **Cohesive visual system:** Navy, cream, pale blue, and orange are applied consistently. Serif display type gives the site more character than a generic contractor template.
3. **Clear conversion repetition:** The phone number is repeated in the utility bar, navigation, hero, confidence strip, lower CTA, and footer. The contact page includes a short, labeled estimate form.
4. **Good desktop and tablet composition:** The homepage is balanced and easy to scan at larger breakpoints. Service cards and the split image/CTA section have solid rhythm.
5. **Useful local facts:** Address, hours, phone number, and social links are present. The artifact also includes `LocalBusiness` structured data.
6. **Basic functional integrity:** The retained hard gate passed after checking 8 routes and 342 links, and axe-core completed on every mobile route.

## Must Fix Before Publishing

1. **The contact location component is visibly broken.** On desktop, the location panel clips after Monday and the directions panel appears as an unlabeled dark rectangle. On mobile, the hours are cut off partway through Thursday and the directions action is absent. See `screenshots/contact-desktop.png` and `screenshots/contact-mobile.png`. The fixed `.map` height conflicts with the full seven-day location content.
2. **The mobile header action is ambiguous.** Navigation disappears under 800px and the phone CTA becomes a plain orange square because its text is hidden. There is no phone icon or menu affordance, so a visitor cannot tell what the control does. See all mobile screenshots.
3. **Accessibility contrast failures are repeated across the entire site.** The artifact records a serious axe color-contrast finding on each of the 8 routes, plus contrast warnings at all three captured breakpoints. Common failures include white text on orange at 3.21:1, orange eyebrow text around 2.9–3.2:1, and muted body copy around 4.31:1.

## Should Fix

1. **Service pages are far too thin.** Each page consists of a headline, one generic sentence, one image, and a repeated CTA. This does not answer normal buying questions such as symptoms, what is included, service process, response area, pricing approach, or why to choose this company.
2. **Near-duplicate local-search pages dilute quality.** The site has paired routes such as `/services/water-heater-repair` and `/services/water-heater-repair-austin-tx`, with nearly identical structure and minimal unique value. Five duplicate-description warnings were retained, and several routes are not discoverable from the homepage service cards.
3. **Trust is too weak for an urgent home-service purchase.** There are no reviews, ratings, years in business, license/insurance information, warranties, guarantees, named team members, project evidence, or other proof. The canonical input contains no verified proof, so the remedy is to collect owner-confirmed proof rather than invent it.
4. **The service taxonomy feels source-derived rather than customer-centered.** Labels such as “Plumbing Company Near Me” and “Plumbing Company Near Me Austin Tx” read like SEO queries, not services. The homepage features only 3 of 12 observed offerings and omits potentially valuable items such as emergency plumbing.
5. **Page metadata is generic.** Titles such as `Home` and `Water Heater Repair`, plus descriptions such as `TJ Plumber Austin, TX.`, waste local-search and click-through opportunities.
6. **Small text is overused.** The automated review found body text below 16px and eyebrow/label text below 12px across every route and breakpoint. The dense all-week hours string is especially hard to scan.

## Could Improve

1. Increase the apparent size and quality of the logo; at present it feels small and lightly branded compared with the otherwise polished page.
2. Replace generic or inconsistent source imagery where possible. The isolated product cutout on one service page feels less credible than the on-the-job photography elsewhere.
3. Add a compact “Why choose us” or “What happens next” section once owner-confirmed facts are available.
4. Present 24/7 hours as a concise statement instead of repeating every weekday in paragraphs and the footer.
5. Improve the retained screenshot process for lazy-loaded images. Several below-the-fold images appear blank in the full-page mobile capture even though the same assets render at desktop and tablet.

## Interpretation

Visually, this is roughly an **82/100** site. As an overall local-business website, it is **68/100** because conversion quality depends on more than appearance: customers need specific service information, credible proof, accessible controls, and a contact experience with no broken-looking elements.
