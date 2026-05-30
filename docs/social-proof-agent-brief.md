# Social Proof Agent Brief

Last updated: May 30, 2026

## Purpose

This is the implementation brief for social proof on Lodesta-generated local-business sites. Share this with agents working on review, rating, testimonial, trust, Google Maps, or conversion modules.

## Core Decision

Use **Google Places UI Kit Query** for Google-powered rating/review display by default. Do not build custom Google review cards from raw Places API data unless the customer tier and conversion value justify the higher cost and policy surface.

Keep **Lodesta-native UI** for the broader social-proof system: owner testimonials, review themes, press mentions, project photos, awards, certifications, YouTube/Reddit/local-media mentions, and service-specific proof blocks.

## Why This Default

Google Places UI Kit is the lowest-friction way to display live Google place proof while keeping attribution and policy handling closer to Google's own components.

Sources:

- [Places UI Kit overview](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview?hl=en)
- [Place Details Elements](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details)
- [Places UI Kit custom styling](https://developers.google.com/maps/documentation/javascript/places-ui-kit/custom-styling)

Pricing is also the practical driver. Google's pricing page currently lists **Places UI Kit Query** at 10,000 free monthly events, then **$1 per 1,000**. Custom Places API Place Details calls that include rating/review fields can be much more expensive.

Source:

- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing?hl=en)

## Product Default

### Free Or Unclaimed Sites

- Do not show a fake or stale Google rating.
- If a Google Business Profile URL or Place ID is known, show a link-only CTA:
  - "Read reviews on Google Maps"
  - "See us on Google Maps"
- Do not call Places API for every anonymous preview by default.

### Claimed Sites With Google Place ID

- Render a compact Google-powered trust module using Places UI Kit.
- Prefer compact placement near high-intent areas:
  - Below hero CTA.
  - Near contact/quote form.
  - On location pages near address, hours, and directions.
  - In footer/contact band for persistent local trust.
- Lazy-load the component so Google JS does not block the hero or Core Web Vitals.
- Track impressions and clicks.

### Premium Or High-Value Sites

Use custom Places API rendering only when all are true:

- The customer has high enough lead value or traffic to justify API cost.
- The design needs cannot be met by Places UI Kit.
- The implementation will fetch live data and follow Google attribution/caching rules.
- The review display has an experiment or conversion hypothesis.

## Display Guidance

Recommended compact copy around the Google module:

```text
Trusted locally
[Google Places UI Kit rating/review component]
```

or:

```text
See why customers choose [Business Name]
[Google Places UI Kit compact details/reviews component]
```

For link-only fallback:

```text
Read our reviews on Google Maps
```

Do not overbuild the Google widget. Let the Google-powered component be a trust cue, then use Lodesta-native sections for more contextual proof.

## Lodesta-Native Social Proof

Use custom Lodesta UI for proof we can legally and productively control:

- Review themes: "Customers mention fast response, clear pricing, and clean work."
- Owner-provided testimonials.
- First-party testimonials collected through Lodesta.
- Before/after galleries.
- Project or case-study cards.
- Awards and certifications.
- Local press.
- Chamber of commerce or directory listings.
- YouTube mentions.
- Reddit/community mentions when attributable and appropriate.

Custom social proof should be placed near the decision it supports:

- Service proof near service descriptions.
- Location proof near location pages.
- Speed/availability proof near call or booking CTAs.
- Trust/legal/certification proof near quote forms for regulated or high-anxiety verticals.

## Implementation Requirements

- Store `place_id` permanently.
- Do not store or cache Google review text, rating, or review count in Lodesta site JSON, generated Markdown, static HTML, or CDN output.
- Do not scrape Google reviews.
- Do not copy Google reviews into custom cards unless policy review explicitly approves the implementation.
- Do not add self-serving Google review/rating schema to local-business pages for rich snippets.
- Use Google attribution exactly as required by the component or API policy.
- Use a browser-restricted Google Maps key for frontend Places UI Kit usage. Do not expose an unrestricted server key in the browser.
- If the current environment only has `GOOGLE_PLACES_API_KEY`, add a separate browser-safe public key before client-side implementation.
- Lazy-load the UI Kit module.
- Provide a link-only fallback when API key, Place ID, billing, or component loading is unavailable.

Sources:

- [Google Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Google review snippet structured data rules](https://developers.google.com/search/docs/appearance/structured-data/review-snippet?hl=en)

## Analytics

Track:

- Google proof module impression.
- Google proof module load failure.
- Google Maps profile clicks.
- Directions clicks.
- Review CTA clicks.
- Form starts/submits after Google proof exposure.
- Phone clicks after Google proof exposure.
- Experiment variant if testing Google proof placement.

Do not store raw Google review content in analytics events.

## Experiment Backlog

High priority:

- Link-only Google reviews CTA versus Places UI Kit compact module.
- Places UI Kit under hero CTA versus contact-section placement.
- Google proof plus review themes versus Google proof alone.

Medium priority:

- Compact Google module versus full review component.
- Google proof in footer/contact band versus location page only.
- Lazy-load immediately after first paint versus load on scroll.

Low priority:

- Minor styling token adjustments inside Places UI Kit.
- CTA wording variations around the Google proof module.

## Acceptance Criteria For Agents

- The site never shows fake or stale Google rating/review data.
- The Google module renders only when a valid Place ID and browser-safe API key are available.
- There is always a graceful link-only fallback.
- Google attribution remains visible.
- The component is responsive and does not cover CTAs, forms, chat, or maps controls.
- The module is lazy-loaded and does not block primary content.
- Analytics events capture impressions, failures, clicks, and downstream conversions.
- No Google review data is written into static site JSON, Markdown alternates, or generated structured data.
