# Local Business CRO Research Playbook

Last researched: May 29, 2026

## Purpose

This document turns current conversion, UX, accessibility, SEO, local-search, and reputation research into Lodesta defaults for local-business websites. The goal is not to claim that every website has one universal optimum. The goal is to start with high-confidence defaults, avoid known failure modes, and define the parts Lodesta should test over time.

The working thesis:

> Local-business conversion is mostly uncertainty reduction. A visitor is trying to decide whether the business is real, nearby, trusted, available, competent, and easy to contact.

## Evidence Levels

- **Hard default:** grounded in accessibility standards, Google policies, platform rules, or repeated usability findings. These should rarely vary by site.
- **Product default:** a strong starting point, but not a law. Use unless business context suggests otherwise.
- **Experiment variable:** plausible but context-dependent. Use as an A/B or cohort-learning candidate.
- **Avoid by default:** carries enough UX, SEO, trust, or performance risk that Lodesta should not ship it unless there is a specific reason.

## Executive Defaults

| Area | Lodesta default | Evidence level | Main sources |
| --- | --- | --- | --- |
| Logo placement | Top-left, linked to home | Product default | [NN/g logo placement](https://www.nngroup.com/articles/logo-placement-brand-recall/) |
| Desktop navigation | Visible nav, not hamburger-only | Hard default | [NN/g hamburger menus](https://www.nngroup.com/articles/hamburger-menus/) |
| Mobile conversion action | Persistent or repeated access to call/book/directions, with no content obstruction | Product default | [WCAG 2.2 target size](https://www.w3.org/TR/WCAG22/), [Android touch targets](https://support.google.com/accessibility/android/answer/7101858?hl=en), [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| Button color | Brand-derived accessible accent; no universal best color | Product default | [PLOS color-in-context study](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0040333), [Labrecque and Milne color marketing](https://cir.nii.ac.jp/crid/1361137043491048448?lang=en) |
| Red CTAs | Allowed when action is positive and context is not destructive/anxious | Experiment variable | [PLOS color-in-context study](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0040333) |
| Text contrast | Body text at least WCAG AA, preferably stronger for core copy | Hard default | [WCAG 2.2 contrast](https://www.w3.org/TR/WCAG22/) |
| Touch targets | 44-48px practical target for primary controls | Hard default | [WCAG 2.2 target size](https://www.w3.org/TR/WCAG22/), [Android touch target size](https://support.google.com/accessibility/android/answer/7101858?hl=en), [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| Chat | Available, user-initiated by default; proactive only after intent signals | Product default | [Production and Operations Management live chat study](https://journals.sagepub.com/doi/abs/10.1111/poms.13320), [Baymard live chat UX](https://baymard.com/blog/live-chat-usability-issues) |
| Entry popups | No promotional full-screen or content-blocking entry popups | Avoid by default | [Google intrusive interstitial guidance](https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials), [Baymard live chat UX](https://baymard.com/blog/live-chat-usability-issues) |
| Location pages | One page per real location; service-area pages only when substantively local | Hard default | [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies) |
| Google reviews | Use Places UI Kit Query as the default live Google proof module; do not expect self-serving LocalBusiness review rich snippets | Hard default | [Social Proof Agent Brief](social-proof-agent-brief.md), [Google review snippet rules](https://developers.google.com/search/docs/appearance/structured-data/review-snippet?hl=en), [Places UI Kit overview](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview?hl=en) |
| Agent-readable publishing | Generate crawlable semantic HTML plus `/llms.txt` and Markdown alternates for key pages, but do not treat them as proven AI ranking signals | Product default | [llms.txt proposal](https://llmstxt.org/), [Cloudflare Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/), [Profound Markdown vs HTML test](https://www.tryprofound.com/blog/does-markdown-increase-ai-bot-traffic) |
| Performance | Pass Core Web Vitals on real-user 75th percentile where possible | Hard default | [web.dev Core Web Vitals](https://web.dev/articles/vitals?hl=en), [T-Mobile web performance case study](https://web.dev/case-studies/t-mobile-case-study) |

## Conversion Model For Local Businesses

Local websites convert when they answer these questions quickly:

1. Is this business relevant to my need?
2. Is it near me or able to serve me?
3. Is it open or available soon?
4. Can I trust it?
5. What will happen if I call, book, request a quote, order, or visit?
6. How much friction is between me and that next step?

Lodesta should treat conversion as a layered system:

- **Clarity:** plain service description, area served, pricing/availability cues where possible.
- **Trust:** reviews, photos, real staff/location signals, business age, licenses, awards, press, community mentions.
- **Action:** one obvious primary next step per page.
- **Speed:** fast loading, stable layout, no intrusive scripts.
- **Local intent:** maps, directions, hours, neighborhoods, parking, service constraints, local proof.
- **Measurement:** first-party event tracking and experiments by vertical and page type.

## Visual Design And Color

### No Universal Best CTA Color

The common claim that one color always converts better is weak. Color works through contrast, context, brand fit, attention, and cultural meaning.

Research on red is a useful warning. In a PLOS One experiment, red changed approach behavior differently depending on psychological context: participants moved faster toward a dating-related interview when the interviewer wore red, but slower toward an intelligence-related interview when the interviewer wore red. The practical implication is not "red is good" or "red is bad." It is that color meaning depends on context.

Sources:

- [Color in Context: Psychological Context Moderates the Influence of Red on Approach- and Avoidance-Motivated Behavior](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0040333)
- [Exciting Red and Competent Blue: The Importance of Color in Marketing](https://cir.nii.ac.jp/crid/1361137043491048448?lang=en)

Lodesta default:

- Generate the primary CTA from the brand palette, but adjust shade for accessibility and salience.
- Use a single dominant action color per site.
- Keep destructive/error states visually distinct from positive CTAs.
- Allow red, orange, green, blue, black, or other CTA colors when the action label and page context make the meaning clear.

Test candidates:

- Red/orange urgency CTAs versus brand-color CTAs for food, emergency services, fitness, entertainment, and retail.
- Calm blue/green CTAs versus warmer CTAs for medical, financial, legal, and wellness verticals.
- CTA color contrast delta, not just hue.

### Contrast Beats Hue

WCAG 2.2 requires:

- Normal text contrast: at least 4.5:1.
- Large text contrast: at least 3:1.
- UI component and graphical-object contrast: at least 3:1.

Source:

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

Lodesta default:

- Body copy should use dark neutral text on light surfaces by default.
- Avoid pale gray body text. It may look "premium" in a design mockup and still perform poorly in real usage.
- Use high-contrast CTAs with visible hover, focus, disabled, and loading states.
- Never use color alone to convey status or action meaning.

Practical token defaults:

- Body text: near-black such as `#111827`, `#18181B`, or equivalent.
- Muted text: no lighter than a contrast-passing gray against the actual background.
- Primary CTA: brand-derived accessible color with text contrast at least 4.5:1.
- Focus ring: visible, 3:1 contrast against adjacent colors.

### Brand Match Matters, But Brand Color Is Not Sacred

Color can affect perceived brand personality, familiarity, likability, and purchase intent. Labrecque and Milne found that logo and package color can shift brand personality perceptions and purchase intent.

Source:

- [Exciting Red and Competent Blue: The Importance of Color in Marketing](https://cir.nii.ac.jp/crid/1361137043491048448?lang=en)

Lodesta default:

- Preserve brand recognition through logo, primary palette, typography tone, photography style, and repeated identity cues.
- If the logo color is inaccessible or weak as a button color, create an accessible action shade rather than forcing the raw logo color.
- For local businesses with poor or inconsistent branding, generate a restrained palette that feels credible in the vertical instead of over-amplifying a weak logo color.

## Typography And Layout

### There Is No Exact Universal Header Size

Research and standards support readability, hierarchy, resizing, contrast, and scannability. They do not prove that every local-business H1 should be a specific pixel size.

Lodesta default type scale:

- Body: 16-18px.
- Small supporting text: 14-15px minimum, used sparingly.
- Mobile H1: 32-40px.
- Desktop H1: 40-56px.
- Mobile H2: 24-30px.
- Desktop H2: 28-36px.
- Body line-height: 1.5-1.65.
- UI/button line-height: stable and compact, with adequate vertical padding.

Sources:

- [WCAG 2.2 resize text and contrast](https://www.w3.org/TR/WCAG22/)
- [HHS Research-Based Web Design and Usability Guidelines PDF](https://www.hhs.gov/sites/default/files/research-based-web-design-and-usability-guidelines_book.pdf)

### Text Should Be Scannable

Users often scan rather than read linearly. The practical takeaway is that local-business pages should not bury the conversion case in long prose.

Source:

- [How Users Read on the Web](https://mmcis.com/MMCIS/readingOnWeb.html)

Lodesta default:

- Use clear section headings.
- Put the primary service/location/value statement near the top.
- Break benefits and proof into short, scannable blocks.
- Use bullets for service lists, process steps, and included features.
- Put contact actions near the relevant proof and service sections.

### Line Length And Spacing

HHS usability guidance notes tradeoffs: longer lines can improve reading speed, while shorter lines can be preferred. Extremely narrow text columns slow reading. For local-business marketing pages, preference, scanning, and comprehension matter more than maximizing raw reading speed.

Source:

- [HHS Research-Based Web Design and Usability Guidelines PDF](https://www.hhs.gov/sites/default/files/research-based-web-design-and-usability-guidelines_book.pdf)

Lodesta default:

- Cap long-form copy around 60-75 characters per line.
- Avoid paragraphs that span the full desktop viewport.
- Use consistent spacing scale, preferably 8px-based, for predictable density.
- Avoid arbitrary decorative offsets that make scanning harder.

Experiment candidates:

- Compact versus spacious hero density by vertical.
- Left-aligned hero content versus centered hero content.
- One-column mobile service cards versus condensed list layout.

## Navigation And Header

### Logo Placement

NN/g research found stronger brand recall for left-aligned logos than right-aligned logos. Top-left placement also matches common web convention.

Source:

- [Logo Placement for Maximum Brand Recall](https://www.nngroup.com/articles/logo-placement-brand-recall/)

Lodesta default:

- Put the logo top-left.
- Link the logo to the homepage.
- Keep logo size large enough to identify the business, but do not let it crowd the primary CTA.

### Desktop Nav

NN/g has consistently found hidden navigation reduces discoverability and can make tasks harder. Desktop hamburger-only navigation is usually a bad default.

Source:

- [Hamburger Menus and Hidden Navigation Hurt UX Metrics](https://www.nngroup.com/articles/hamburger-menus/)

Lodesta default:

- Desktop header should expose the main sections or actions.
- Mobile can use a menu, but the primary conversion action should remain visible outside the menu.
- Header order should usually be: logo, nav, trust/contact cue, primary CTA.

### Mobile Header

Mobile local intent is often immediate: call, book, order, directions, hours. A mobile website should not force users to open a menu to act.

Sources:

- [WCAG 2.2 target size](https://www.w3.org/TR/WCAG22/)
- [Android touch target size](https://support.google.com/accessibility/android/answer/7101858?hl=en)
- [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)

Lodesta default:

- Mobile header should include logo, menu, and one direct action where space allows.
- For high-intent businesses, add a bottom action bar with 2-3 actions: call, book/order, directions.
- The bar must not cover form buttons, chat, cookie controls, or other core content.
- Use at least 44-48px hit areas.

Experiment candidates:

- Sticky top CTA versus sticky bottom CTA.
- Single action bar versus two-action split.
- Phone-first CTA versus booking-first CTA by vertical and open-hours state.

## Buttons, Forms, And Action Design

### Touch Targets

WCAG 2.2 defines a 24x24 CSS pixel minimum target size with exceptions. Apple recommends 44x44pt on iOS/iPadOS. Android accessibility guidance recommends 48x48dp and at least 8dp separation.

Sources:

- [WCAG 2.2 Target Size Minimum](https://www.w3.org/TR/WCAG22/)
- [Android touch target size](https://support.google.com/accessibility/android/answer/7101858?hl=en)
- [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)

Lodesta default:

- Primary buttons: 48-56px height on mobile.
- Secondary icon buttons: 44-48px hit area, even when icon is 20-24px.
- Form fields: 44-52px minimum height on mobile.
- Avoid placing two high-stakes tap targets too close together.

### Button Copy

Button clarity matters more than cleverness.

Lodesta default:

- Use action-specific labels: "Call now", "Book appointment", "Get a quote", "Order online", "Get directions".
- Avoid vague CTAs like "Submit" or "Learn more" when the next action can be named.
- On forms, set expectations: "Request a quote" is better than "Submit" when that is the real outcome.

### Forms

Forms convert when they ask only for the information needed to complete the next step.

Lodesta default:

- Ask for name, contact method, requested service, and message only when necessary.
- Use `autocomplete` and appropriate input types.
- Keep labels visible, not placeholder-only.
- Explain response time and next step near the submit button.
- Track form start, validation errors, abandon, and submit.

Sources:

- [WCAG 2.2 input purpose and labels](https://www.w3.org/TR/WCAG22/)

Experiment candidates:

- Short form versus qualified form.
- Phone-first versus email-first contact.
- Multi-step form versus single-page form for quote-heavy businesses.

## Chatbots And Live Chat

### Do Chatbots Improve Conversion?

There is credible evidence that live chat can improve conversion in some contexts. A 2021 Production and Operations Management study using Taobao marketplace data found live chat had a positive impact on conversion, especially when page information was less comprehensive and when product value cues were favorable.

Source:

- [Effect of Live Chat on Traffic-to-Sales Conversion](https://journals.sagepub.com/doi/abs/10.1111/poms.13320)

Intercom reports strong conversion lifts among visitors who chatted, but those numbers should be treated carefully because high-intent visitors are more likely to initiate chat in the first place.

Source:

- [Intercom live chat conversion data](https://www.intercom.com/blog/why-live-chat/)

Lodesta interpretation:

- Chat is valuable when it removes uncertainty at a high-intent moment.
- Chat is not a substitute for clear page content.
- AI chat should route users to actions, answer factual questions, and capture leads after hours.

### Chat UX Risks

Baymard found overlay dialogs, popups, and sticky chat widgets can be disruptive, especially on mobile where sticky chat can block key content or actions.

Source:

- [Baymard live chat usability issues](https://baymard.com/blog/live-chat-usability-issues)

Google also warns against intrusive dialogs and interstitials because they can hurt user trust and search performance.

Source:

- [Google intrusive interstitial guidance](https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials)

Lodesta default:

- User-initiated chat by default.
- Desktop: bottom-right launcher can be acceptable if small, dismissible, and not auto-expanded.
- Mobile: avoid persistent chat bubbles that cover content or CTA controls.
- Put chat links in footer, help/contact areas, and relevant service pages.
- Proactive chat only after intent signals, such as long dwell on pricing/service pages, repeated visits, form hesitation, or after-hours contact attempts.
- Never use fake human identity, fake typing, fake scarcity, sound, or repeated interruptions.
- Lazy-load chat after the main content and conversion actions are usable.

Experiment candidates:

- Chat launcher only versus inline "Ask a question" blocks.
- Proactive chat after 30-60 seconds on a service page.
- After-hours AI receptionist versus standard contact form.
- Chat-to-booking flow versus chat-to-lead-capture flow.

## Reviews, Ratings, And Trust

### Google Reviews And Ratings

Google Business Profile prominence is influenced by information such as review count and review score, among other factors. Google states local ranking is primarily based on relevance, distance, and prominence.

Source:

- [Google: Improve your local ranking](https://support.google.com/business/answer/7091/improve-your-local-ranking-on-google)

BrightLocal's Local Consumer Review Survey is not a platform rule, but it is useful market research showing that consumers continue to rely heavily on reviews for local businesses.

Source:

- [BrightLocal Local Consumer Review Survey 2025](https://www.brightlocal.com/research/local-consumer-review-survey-2025/)

Lodesta default:

- Surface rating and review count near high-intent areas when the rating is strong enough.
- Use real review excerpts with attribution where licensing/API rules permit.
- Show recent review themes, not just stars.
- Pair review proof with relevant service or location pages.
- Include "Read more reviews" or "Review us on Google" links where appropriate.

### Structured Data And Review Snippets

Google says LocalBusiness or Organization pages are ineligible for star review rich results when the reviewed entity controls the reviews about itself, including embedded third-party review widgets.

Source:

- [Google review snippet structured data rules](https://developers.google.com/search/docs/appearance/structured-data/review-snippet?hl=en)

Lodesta default:

- Use LocalBusiness structured data for business facts.
- Do not promise organic SERP review stars for self-serving local-business review markup.
- Use visible reviews for user trust, not as a rich-snippet hack.

### Google Places API And Attribution

Google Places Place Details can provide rating, reviews, address, phone, website, hours, and other business facts. Usage must follow field-mask, attribution, display, and caching requirements.

Sources:

- [Google Places API Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details)
- [Google Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Places UI Kit overview](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview?hl=en)
- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing?hl=en)

Lodesta default:

- Prefer Places UI Kit Query for live Google-powered rating/review display.
- Use custom Places API rendering only when the customer tier and conversion value justify the higher cost and implementation policy surface.
- Fetch only fields needed for custom rendered features.
- Display required Google attribution.
- Respect caching and display rules.
- Store provenance for all externally sourced facts.
- See [Social Proof Agent Brief](social-proof-agent-brief.md) before implementing review or rating modules.

## Maps, Directions, Hours, And Local Action

Local intent often requires physical-world action: call, visit, directions, parking, entrance, pickup, delivery, service area, or appointment.

Sources:

- [Google Maps URLs directions documentation](https://developers.google.com/maps/documentation/urls/get-started)
- [Google Business Profile local ranking guidance](https://support.google.com/business/answer/7091/improve-your-local-ranking-on-google)

Lodesta default:

- Put NAP, hours, and directions in the contact/location section and footer.
- Use a directions CTA when location matters.
- Use a map when it helps the decision, but do not let a map slow or dominate the page.
- For mobile, expose directions as a direct action.
- If the business has multiple locations, provide a location selector and individual location pages.

Experiment candidates:

- Map visible by default versus "Get directions" button only.
- Directions in mobile bottom action bar for restaurants, retail, venues, and clinics.
- Parking/entrance notes on location pages.

## External Proof Discovery

### YouTube Mentions

The YouTube Data API `search.list` endpoint can search for videos by query and filter by video type. Lodesta can search business name, city, owner name, known aliases, and high-intent terms.

Source:

- [YouTube Data API search.list](https://developers.google.com/youtube/v3/docs/search/list)

Lodesta default:

- Treat YouTube as external proof discovery.
- Classify mentions as positive, neutral, negative, or irrelevant.
- Surface only relevant positive/neutral mentions with clear attribution.
- Prefer embedding or linking only when the video is public, appropriate, and useful to the business.

### Reddit And Community Mentions

Reddit provides API/search capabilities, but Reddit content should be handled carefully. A positive mention can be useful social proof; an isolated or unverifiable comment should not become a major claim.

Sources:

- [Reddit API documentation](https://www.reddit.com/dev/api/)
- [Reddit Data API wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)

Lodesta default:

- Search for business name, common misspellings, location, and category terms.
- Classify recommendation strength.
- Surface as "Community mentions" or internal owner insight, not as guaranteed endorsement.
- Do not copy large user comments into pages without careful attribution and permissions review.

### Other Proof Sources

Lodesta should also search for:

- Local news mentions.
- Chamber of commerce listings.
- Awards.
- Licenses and certifications.
- Local sponsorships.
- Podcast appearances.
- Instagram/TikTok posts if publicly available and relevant.
- Industry directories.

Product opportunity:

- Build an external proof inventory that business owners usually do not have.
- Convert proof into website modules: review strips, "As mentioned in", community recommendation cards, case studies, before/after galleries, local trust badges, and FAQ answers.

## Technical SEO Defaults

### Titles, Meta Descriptions, Headings, And Links

Google's SEO Starter Guide emphasizes helpful content, clear titles, snippets/meta descriptions, meaningful links, and high-quality images near relevant text.

Source:

- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)

Lodesta default:

- Unique title and meta description for every indexable page.
- Title pattern should include service/category, business name, and location when relevant.
- One clear H1 per page.
- Use descriptive internal links.
- Do not rely on the keywords meta tag.

### Images And Alt Text

Google states that alt text, page content, and computer vision help it understand images. Google also recommends high-quality images near relevant text and modern responsive image optimization.

Sources:

- [Google Image SEO best practices](https://developers.google.com/search/docs/appearance/google-images)
- [Google mobile-first indexing best practices](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing)

Lodesta default:

- Descriptive filenames where Lodesta controls generated/exported assets.
- Descriptive alt text for meaningful images.
- Empty alt for decorative images.
- Responsive images, modern formats, and correct dimensions to reduce layout shift.
- Same meaningful content and metadata on mobile and desktop.

### Structured Data

Lodesta should include structured data where it accurately reflects visible page content.

Sources:

- [Google structured data general guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Google Local Business structured data](https://developers.google.com/search/docs/appearance/structured-data/local-business)

Lodesta default:

- LocalBusiness schema for business facts.
- Breadcrumb schema for navigable hierarchy.
- Organization schema where appropriate.
- Product/service-like structured data only where content and eligibility genuinely match Google's guidelines.
- Validate generated structured data in QA.

## Agent-Readable Publishing, Markdown, And llms.txt

AI-mediated discovery is moving quickly, but the evidence does not support treating `llms.txt` as a guaranteed ranking, citation, or indexing mechanism. The accurate position is narrower: Markdown and agent-readable content are useful infrastructure because agents can parse them cheaply and reliably, while `llms.txt` is an emerging convention that may help user-triggered agents and future retrieval systems find the right content.

The `llms.txt` proposal recommends a Markdown file at `/llms.txt` with a short site summary and curated links to detailed Markdown resources. It also proposes clean Markdown versions of useful pages, such as appending `.md` to page URLs.

Source:

- [The `/llms.txt` file proposal](https://llmstxt.org/)

Evidence is mixed:

- Ramp ran an experiment across roughly 50 marketing pages with three bot-facing formats: pure Markdown, stripped semantic HTML, and schema-heavy pages. Ramp reported that Markdown was the only format that reliably surfaced its tracked agent-facing offer in LLM responses, especially Claude, while ChatGPT did not surface it during the observed window.
- Profound ran a more controlled A/B test across 381 pages on six websites. Markdown pages saw a directional advantage of roughly one extra median bot visit over three weeks and a mean lift around 16%, but the result was not statistically significant and was driven mainly by pages that already had high bot activity.
- Cloudflare launched Markdown for Agents, which lets agents request `Accept: text/markdown` and receive Markdown-converted pages on enabled zones. Cloudflare reported a large token reduction on its own blog example and said it sees agents such as Claude Code and OpenCode sending Markdown accept headers.
- OpenAI's crawler documentation describes GPTBot, OAI-SearchBot, ChatGPT-User, and robots.txt behavior, but does not document `llms.txt` as a supported crawl or ranking signal.

Sources:

- [Ramp: We Tested Marketing Incentives to AI Agents](https://builders.ramp.com/post/marketing-to-ai-agents)
- [Profound: Markdown vs HTML for AI bots](https://www.tryprofound.com/blog/does-markdown-increase-ai-bot-traffic)
- [Cloudflare: Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/)
- [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots)

Lodesta default:

- Serve excellent semantic HTML first. Core business content must be present in server-rendered HTML and visible to users.
- Generate `/llms.txt` for each published site with a concise business summary and curated links to important pages.
- Generate Markdown alternates for high-value pages, such as the homepage, service pages, location pages, FAQ pages, and contact/location pages.
- Support `Accept: text/markdown` where practical, or provide predictable `.md` alternates.
- Keep Markdown equivalent to the human-visible page. Do not insert AI-only offers, hidden claims, or content that meaningfully differs from the public page unless it is a deliberately tracked experiment with policy review.
- Add canonical HTTP `Link` headers from Markdown alternates back to the canonical HTML page to reduce duplicate-content ambiguity.
- Include source/provenance notes where external facts, reviews, ratings, or business-profile data appear in Markdown.

Sources:

- [Google canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google spam policies on cloaking](https://developers.google.com/search/docs/essentials/spam-policies)

Experiment candidates:

- HTML only versus HTML plus `/llms.txt` and Markdown alternates.
- `.md` page alternates versus `Accept: text/markdown` content negotiation.
- Full-page Markdown versus concise agent summaries for high-intent pages.
- Different `llms.txt` curation strategies: all core pages, only high-intent pages, or vertical-specific guides.
- Agent-facing FAQ blocks that are fully visible to humans versus standard FAQ layout only.

Measurement requirements:

- Track `/llms.txt` requests.
- Track `.md` alternate requests.
- Track `Accept: text/markdown` requests.
- Track AI crawler/user-agent family, verified bot status where available, IP/ASN, response status, and whether the request reached useful content or a firewall/challenge page.
- Track AI referrals and citations separately from traditional organic search.
- Run recurring prompt tests across ChatGPT, Claude, Perplexity, and Gemini for priority local-intent queries.

## Performance And Core Web Vitals

Core Web Vitals measure loading, responsiveness, and layout stability. Google/web.dev recommends evaluating at the 75th percentile of page visits.

Source:

- [web.dev Web Vitals](https://web.dev/articles/vitals?hl=en)

Good thresholds:

- LCP: 2.5 seconds or less.
- INP: 200 milliseconds or less.
- CLS: 0.1 or less.

Business impact evidence:

- T-Mobile reported a 60% improvement in visit-to-order rate after Core Web Vitals improvements.
- Rakuten 24 reported a 33.13% conversion-rate increase and 53.37% revenue-per-visitor increase after Core Web Vitals work.

Sources:

- [T-Mobile web performance case study](https://web.dev/case-studies/t-mobile-case-study)
- [Rakuten 24 Core Web Vitals case study](https://web.dev/case-studies/rakuten?hl=en)

Lodesta default:

- Performance budget before third-party scripts.
- Lazy-load nonessential widgets, including chat and maps.
- Avoid render-blocking scripts.
- Optimize hero images aggressively.
- Reserve image/map/video dimensions to prevent layout shift.
- Track Web Vitals as first-party analytics events.

## Interstitials, Popups, And Overlays

Google warns that intrusive interstitials and dialogs can make content harder to understand and may harm search performance. Baymard's live-chat testing also found user frustration with overlays and sticky interruptions.

Sources:

- [Google intrusive interstitial guidance](https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials)
- [Baymard live chat UX](https://baymard.com/blog/live-chat-usability-issues)

Lodesta default:

- No full-page promotional overlay on entry.
- No newsletter or offer popup before the user has seen the page content.
- Legal/consent dialogs should be as small and unobtrusive as allowed.
- Use inline prompts, banners, or exit-intent tests only when they do not block core content.

Experiment candidates:

- Small inline offer banner after service proof.
- Exit-intent quote prompt on desktop only.
- Returning-visitor prompt tied to specific page history.

## Location And Service Landing Pages

### The Risk: Doorway And Scaled Content Abuse

Google defines doorway abuse as pages created to rank for similar queries that lead users to intermediate or less useful pages. It gives examples including multiple region/city pages that funnel users to one destination and substantially similar pages closer to search results than a browsable hierarchy. Google also flags keyword stuffing, including blocks of city/region names, and scaled content abuse where many pages are generated primarily to manipulate rankings.

Source:

- [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies)

There is no public "safe number" of location pages. The issue is not count alone. The issue is whether pages are useful, differentiated, accurate, and part of a coherent site hierarchy.

### Lodesta Default Rules

For real multi-location businesses:

- Create one indexable page per physical location.
- Each location page should include NAP, hours, map/directions, local reviews, staff/location photos, parking/entrance notes, local services, and location-specific FAQs.
- Connect the matching Google Business Profile location to the matching page.

For service-area businesses:

- Create city/service pages only for priority markets with real local substance.
- Each page needs unique proof: projects, reviews, service constraints, travel fees, neighborhoods served, local photos, local FAQs, or locally specific offers.
- Do not publish pages that only swap the city name.
- Use a service-area hub when individual pages would be thin.
- Noindex or merge thin experimental pages until they have enough value.

Avoid:

- City keyword blocks.
- Hundreds of generated pages with near-identical copy.
- Pages that all push users to the same generic form without unique local value.
- Fake offices, fake local addresses, or misleading proximity claims.

Experiment candidates:

- One service-area hub versus city-specific pages.
- Service-first URL structure versus location-first URL structure.
- Local proof density by page type.

## Local SEO And Business Profile Alignment

Google describes local ranking around relevance, distance, and prominence. Complete and accurate business information, review management, photos, and hours matter for the local presence.

Source:

- [Google: Improve your local ranking](https://support.google.com/business/answer/7091/improve-your-local-ranking-on-google)

Lodesta default:

- Ensure website NAP matches Google Business Profile.
- Keep hours and holiday hours consistent.
- Use the same primary service/category language across site, GBP, and structured data where true.
- Link to booking/order/menu/profile destinations consistently.
- Track mismatches as action-list findings.

## UX From Tech Applied To Local Businesses

Local websites often fail because they lack product-level UI discipline. Lodesta should import the best parts of modern tech UI without making local sites feel like SaaS landing pages.

Tech practices to adopt:

- Design tokens for color, spacing, type, elevation, and radius.
- Componentized CTAs, review cards, forms, maps, galleries, FAQs, and service sections.
- Clear loading, error, success, and empty states.
- First-party analytics and event taxonomy.
- Performance budgets.
- Accessibility QA.
- Versioning and rollback.
- Experiment management.
- Consistent responsive behavior.

Tech practices to avoid:

- Overly abstract hero copy.
- Huge SaaS-style hero sections that bury local action.
- Decorative gradients/orbs that reduce trust.
- Generic stock visuals.
- Feature-heavy pages without proof.

## Lodesta Product Opportunities

Beyond building better websites, Lodesta can give business owners intelligence they usually do not have:

- Review theme mining across Google and other platforms.
- Positive YouTube/Reddit/local-media mention discovery.
- Competitor comparison by reviews, site quality, speed, offers, and conversion paths.
- Google Business Profile consistency checks.
- Local landing-page quality scoring.
- Core Web Vitals monitoring.
- Broken form/phone/booking detection.
- CTA and lead attribution.
- Monthly action list with one-click fixes.
- Vertical playbooks learned across the Lodesta fleet.

## Default Page Patterns

### Homepage

Default structure:

1. Hero with service/category, location/service area, primary CTA, secondary CTA, and trust cue.
2. Review/rating strip or proof bar.
3. Core services.
4. Why choose us or proof differentiators.
5. Gallery/project/product/menu highlights.
6. Process or what to expect.
7. Reviews/testimonials.
8. Location, hours, map/directions.
9. FAQ.
10. Final CTA.

### Service Page

Default structure:

1. Service-specific H1 and CTA.
2. Who it is for / problem solved.
3. Service details.
4. Relevant proof: reviews, projects, before/after, certifications.
5. Pricing/availability cues where possible.
6. FAQ.
7. Contact or quote CTA.

### Location Page

Default structure:

1. Location-specific H1.
2. NAP, hours, call, directions.
3. Location-specific services.
4. Local reviews.
5. Map, parking, entrance, neighborhood details.
6. Staff or location photos.
7. Location FAQ.
8. Final CTA.

## Measurement Plan

Track:

- Pageview.
- Landing page.
- Referrer and UTM.
- CTA impressions and clicks.
- Phone clicks.
- Directions clicks.
- Booking/order/menu clicks.
- Form starts, errors, abandons, and submits.
- Chat opens, first message, qualified lead, and assisted conversion.
- Review/profile clicks.
- Section views.
- Scroll depth.
- Engagement time.
- Core Web Vitals.
- Experiment assignment.
- AI crawler requests by user agent, IP/ASN, response status, and target path.
- `/llms.txt`, Markdown alternate, and `Accept: text/markdown` requests.
- AI/LLM referral source and landing page.
- AI answer/citation presence for priority prompts.

Fleet learning:

- Analyze by vertical, page type, device, traffic source, business size, rating band, and conversion goal.
- Use cross-site directional learning for low-traffic SMBs.
- Promote patterns to defaults only after repeated evidence.

## Recommended Experiment Backlog

High priority:

- Mobile bottom action bar versus no bottom action bar.
- Call-first versus book-first CTA by vertical.
- Brand-color CTA versus high-contrast generated CTA.
- Hero with review proof near CTA versus proof lower on page.
- Short form versus qualified form.
- Chat launcher versus inline help only.
- Agent-readable publishing: HTML only versus HTML plus `/llms.txt` and Markdown alternates.

Medium priority:

- Map visible versus directions button only.
- Sticky header CTA versus repeated inline CTA.
- Review cards near services versus single review section.
- Staff photo/social proof in hero versus service imagery in hero.
- City-specific page versus service-area hub.
- `.md` alternates versus `Accept: text/markdown` content negotiation.

Low priority:

- CTA corner radius.
- Minor shade differences within the same accessible color family.
- Centered versus left-aligned secondary sections.
- Decorative icons versus no icons.

## Guardrails

Lodesta should not ship:

- Low-contrast text.
- Tiny buttons or tap targets.
- Desktop hamburger-only navigation.
- Entry popups that block content.
- Chat widgets that cover mobile CTAs.
- Fake urgency.
- Fake local addresses.
- Review schema intended to force self-serving local-business stars.
- Thin city pages.
- Copied reviews or third-party content without attribution and policy review.
- Heavy third-party scripts that break performance budgets.
- AI-only claims, offers, or hidden content that materially differ from what human visitors can see.
- Markdown alternates without canonical headers or measurement.

## Source Index

- [Apple Human Interface Guidelines: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Android Accessibility Help: Touch target size](https://support.google.com/accessibility/android/answer/7101858?hl=en)
- [Baymard: Live chat usability issues](https://baymard.com/blog/live-chat-usability-issues)
- [BrightLocal Local Consumer Review Survey 2025](https://www.brightlocal.com/research/local-consumer-review-survey-2025/)
- [Cloudflare: Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/)
- [Google Business Profile: Improve your local ranking](https://support.google.com/business/answer/7091/improve-your-local-ranking-on-google)
- [Google canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google Image SEO best practices](https://developers.google.com/search/docs/appearance/google-images)
- [Google intrusive interstitial guidance](https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials)
- [Google Local Business structured data](https://developers.google.com/search/docs/appearance/structured-data/local-business)
- [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)
- [Google mobile-first indexing best practices](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing)
- [Google Places API Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details)
- [Google Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Google Places UI Kit overview](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview?hl=en)
- [Google Places UI Kit Place Details Elements](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details)
- [Google Places UI Kit custom styling](https://developers.google.com/maps/documentation/javascript/places-ui-kit/custom-styling)
- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing?hl=en)
- [Google review snippet structured data rules](https://developers.google.com/search/docs/appearance/structured-data/review-snippet?hl=en)
- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- [Google structured data general guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [HHS Research-Based Web Design and Usability Guidelines PDF](https://www.hhs.gov/sites/default/files/research-based-web-design-and-usability-guidelines_book.pdf)
- [Intercom live chat conversion data](https://www.intercom.com/blog/why-live-chat/)
- [Labrecque and Milne: Exciting Red and Competent Blue](https://cir.nii.ac.jp/crid/1361137043491048448?lang=en)
- [llms.txt proposal](https://llmstxt.org/)
- [NN/g: Hamburger Menus and Hidden Navigation Hurt UX Metrics](https://www.nngroup.com/articles/hamburger-menus/)
- [NN/g: Logo Placement for Maximum Brand Recall](https://www.nngroup.com/articles/logo-placement-brand-recall/)
- [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots)
- [PLOS One: Color in Context](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0040333)
- [Profound: Markdown vs HTML for AI bots](https://www.tryprofound.com/blog/does-markdown-increase-ai-bot-traffic)
- [Production and Operations Management: Effect of Live Chat on Traffic-to-Sales Conversion](https://journals.sagepub.com/doi/abs/10.1111/poms.13320)
- [Ramp: We Tested Marketing Incentives to AI Agents](https://builders.ramp.com/post/marketing-to-ai-agents)
- [Rakuten 24 Core Web Vitals case study](https://web.dev/case-studies/rakuten?hl=en)
- [Reddit API documentation](https://www.reddit.com/dev/api/)
- [Reddit Data API wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)
- [T-Mobile web performance case study](https://web.dev/case-studies/t-mobile-case-study)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [web.dev Web Vitals](https://web.dev/articles/vitals?hl=en)
- [YouTube Data API search.list](https://developers.google.com/youtube/v3/docs/search/list)
