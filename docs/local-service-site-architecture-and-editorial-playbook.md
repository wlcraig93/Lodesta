# Local-Service Site Architecture and Editorial Playbook

Last researched: July 31, 2026

Status: product research and recommended defaults; not an implementation specification

## Purpose

This document answers four related questions for Lodesta:

1. What should the information architecture of a local-service website look like?
2. How many service, location, service-area, and service-by-location pages should it have?
3. How should Lodesta rebuild a sparse site versus migrate a large, mature site?
4. Should Lodesta create and publish blog or resource content for owners?

The short answer is that there is no defensible universal page count. Page count is an output of the business's distinct services, markets, proof, customer questions, existing search equity, and editorial assets. It should not be a model input, a catalog quota, or a Cartesian product.

The governing rule is:

> One canonical, indexable URL should perform one distinct and useful customer job, using evidence that merits a separate page.

That rule permits an eight-page website, a 250-page website, or a 1,500-page website. It rejects both collapsing a mature 250-page source into 14 routes and inflating a thin eight-page source into hundreds of city-swapped pages.

## Executive Position

Lodesta should adopt these defaults:

- **Do not impose a universal service catalog.** `Ant control` can be a service. `Ant control Raleigh` is normally a route label combining a service with a market, not a canonical business offering.
- **Let the authoring model own information architecture.** Give it the complete inventory, retrieval, owner facts, research, and migration constraints. Do not reintroduce a capped route planner or vertical skill.
- **Preserve useful existing URLs and substantive coverage by default.** A redesign is not permission to erase accumulated content and search equity.
- **Create a dedicated page for each materially distinct service when there is enough truthful substance to answer the customer's service-specific questions.** A service name alone does not earn a URL.
- **Create one page for every real, customer-facing physical location.** A service-area page is a different thing and must not imply an office.
- **Create service-area city or regional pages selectively.** They should confirm coverage and add useful local evidence, not merely replace a place name in a template.
- **Do not generate the full service-by-location matrix.** Create an intersection only when demand, operational differences, local proof, existing equity, or a meaningfully different customer answer justifies it.
- **Do not auto-create a generic blog.** Migrate useful existing articles. For sparse sites, propose or draft new resources only when the business has a real question, expertise, evidence, or customer story worth publishing.
- **Do not impose a publishing cadence.** Search engines do not publish a preferred word count or posting frequency. Publish when there is something substantial to say; update dates only after meaningful changes.
- **Chat-driven editorial publishing is a good initial owner experience, but the current route artifact is not yet a real editorial system.** Article metadata, authorship, dates, canonical/indexing controls, topic relationships, structured data, media input, and feed behavior need first-class support.
- **Treat source-site size as evidence, not a target.** A large site may represent years of useful guides and projects, a real location network, a scaled geo program, or accumulated junk. Inventory and performance data distinguish those cases.

## Evidence Model

This playbook deliberately separates five kinds of evidence:

| Level | Meaning | How Lodesta should use it |
| --- | --- | --- |
| Official policy or platform contract | Direct guidance from Google or OpenAI | Hard constraint or strong default |
| Original research | Survey, observational dataset, or measured benchmark | Directional evidence with methodology caveats |
| Practitioner case evidence | A documented tactic or client result | Proof that something can work, not proof that it is a safe universal default |
| Live-site benchmark | Observed sitemap and page patterns | Descriptive, never causal |
| Lodesta product judgment | A conclusion drawn from the evidence and product goals | Explicit product default, open to measurement and revision |

This distinction matters because local SEO contains many tactics that can rank in an isolated case while still being a poor product standard.

## What Search Platforms Actually Say

### There is no ideal number of pages or words

Google does not specify a preferred site size or word count. Its people-first guidance asks whether content is original, substantial, complete, trustworthy, and useful to the intended audience. It explicitly warns against writing to a rumored word count, mass-producing content, or adding and removing content merely to make a site appear fresh. [Google people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)

Google's statement that a site of roughly 500 pages or fewer may be considered "small" in sitemap guidance is an operational crawling example, not a recommendation to create 500 pages. Sitemaps are discovery hints and can contain up to 50,000 URLs per file; those limits say nothing about ideal architecture. [Google sitemap overview](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview), [build a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)

### Useful structure and internal links matter

Google recommends logical site organization, descriptive URLs, reduced duplication, and crawlable links between important pages. It says every important page should be reachable through a normal `<a>` link and recommends linking important pages from other relevant pages with concise, descriptive anchor text. [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [developer guide](https://developers.google.com/search/docs/fundamentals/get-started-developers), [sitelinks guidance](https://developers.google.com/search/docs/appearance/sitelinks), [crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)

This supports topic hubs, service hubs, location finders, related-page modules, and breadcrumbs. It does not require putting every route in primary navigation.

### Local visibility is not created by city pages alone

Google says local results are primarily based on relevance, distance, and prominence. Complete business information, reviews, photos, and links contribute to visibility and confidence. A city page can improve the website's relevance for organic search, but it cannot erase the underlying distance between a searcher and the business's actual location. [Google Business Profile local ranking guidance](https://support.google.com/business/answer/7091)

This is why a service-area page and a real physical-location page must remain distinct concepts.

### Doorways and scaled content are the central risk

Google defines doorway abuse to include region or city pages that funnel users to one destination and substantially similar pages created for many closely related queries. It defines scaled-content abuse as generating many pages primarily to manipulate rankings, regardless of whether humans, automation, or both created them. [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies)

The problem is not that two pages share a header, service description, or booking module. The problem is publishing pages whose reason to exist is the query variation rather than a useful variation in the answer.

### AI does not create a second architecture playbook

Google's current AI-search guidance says existing SEO foundations still apply. It emphasizes unique, non-commodity, first-hand content and says there is no need to create exact-match pages for every possible fan-out query. High quantity does not itself make a site more relevant or useful. [Google AI optimization guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [AI features and websites](https://developers.google.com/search/docs/appearance/ai-features)

OpenAI's documented requirement for appearing in ChatGPT search is to allow `OAI-SearchBot` in `robots.txt` and permit its published IP ranges. `GPTBot` is a separate training control, while `ChatGPT-User` handles some user-initiated visits and is not the crawler that determines ChatGPT Search inclusion. OpenAI does not recommend creating more keyword routes for ChatGPT. [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots)

The product implication is simple: semantic, crawlable, factual pages are the shared foundation. "AI optimization" should not become a new justification for page multiplication.

## What Local-Search Evidence Adds

### Dedicated service pages are a credible default, not a literal catalog rule

Whitespark's 2026 Local Search Ranking Factors survey asked 47 local-search practitioners to score 187 factors. For local organic results, respondents ranked "Dedicated Page for Each Service" first, geographic relevance of content second, internal linking sixth, sitewide service-topic relevance seventh, quality content volume fourteenth, and topic-organized architecture twenty-first. [Whitespark 2026 Local Search Ranking Factors](https://whitespark.ca/local-search-ranking-factors/)

This is expert opinion based on accumulated observation, not access to Google's algorithm and not a controlled causal study; Whitespark says so in its methodology. The useful conclusion is that a real service generally deserves a focused answer. It does not follow that every anchor phrase discovered in a crawl is a service, that every variation needs a route, or that a model should be forced through a universal offering catalog.

### Consumers need fast verification, not just keyword relevance

BrightLocal's 2025 US consumer panel found that 85% considered contact information and opening hours important when researching a local business, 67% often or always went on to read reviews, and 56% often or always checked business information against other online mentions. Its 2026 follow-up found that 73% of recent local searches started on mobile and 75% involved more than one channel; most consumers who started with AI continued elsewhere to verify details. [BrightLocal consumer search behavior 2025](https://www.brightlocal.com/research/consumer-search-behavior/), [BrightLocal consumer search channels 2026](https://www.brightlocal.com/research/consumer-search-behavior-channels/)

These are self-reported consumer surveys, not observed conversions. They nevertheless reinforce the primary job of local pages: answer whether the business can help, where, when, with what proof, and how to take the next step.

### A service-area page must earn its URL

BrightLocal distinguishes a physical-location page from a service-area page. Its recommended local substance includes services actually offered in that area, local reviews, area-specific constraints, availability, neighborhoods, directions or coverage, projects, and real local imagery. It warns against city swaps, too many tiny areas, and orphan pages. [BrightLocal service-area pages](https://www.brightlocal.com/learn/service-area-pages/), [BrightLocal location pages](https://www.brightlocal.com/learn/location-pages/)

BrightLocal suggests that a new business test a few geo pages rather than launching dozens. That number is practitioner advice, not an engine rule, but the staged principle is sound when the business has no existing page equity or performance data. [BrightLocal ranking outside an area](https://www.brightlocal.com/learn/how-to-rank-outside-your-area/)

### Similar pages can rank; that does not make them Lodesta's default

Sterling Sky documents a business with 35 service-area pages whose content reportedly matched 84% on average and still produced aggregate traffic and conversions. The authors argue that local photos, reviews, projects, and landmarks can matter more than rewriting shared service prose. [Sterling Sky service-area case](https://www.sterlingsky.ca/service-area-pages-duplicate-content/)

That case is valuable because it disproves an overly simple claim that any repeated prose makes a location program fail. It is still one practitioner case without a control group, and its tactical framing conflicts with the higher product-safety bar implied by Google's doorway and scaled-content policies.

Lodesta's conclusion should be:

- shared factual and conversion modules are fine;
- repeated core service explanations can be fine;
- the route still needs a distinct customer purpose and meaningful local evidence;
- "it may rank" is not enough reason to auto-publish it;
- generated paraphrase is not unique value.

## Keep Services, Places, Problems, and Routes Separate

Most past planning errors begin by collapsing different concepts into one schema.

| Concept | Example | Authority | Does it require a route? |
| --- | --- | --- | --- |
| Owner offering | Ant control | Owner-confirmed business fact | Usually, when enough substance exists |
| Service family | Pest control | Owner facts plus source evidence | Often a hub |
| Problem or organism | Carpenter ants | Source evidence and professional knowledge | Sometimes a service detail or guide |
| Market | Raleigh | Confirmed service-area fact | Sometimes a service-area page |
| Physical location | Apex office | Confirmed address customers can visit or contact | Yes, one page per real public location |
| Audience | Residential property managers | Owner facts | Only if needs, process, and proof differ materially |
| Search-intent label | Ant control Raleigh | Derived service-plus-market phrase | Never a canonical offering merely because it appeared in a title or anchor |
| Route | `/raleigh/ant-control/` | Authoring decision | Only if the intersection earns a distinct answer |

`BusinessOffering` should remain owner-controlled. Crawled titles, headings, anchors, route prefixes, and co-occurring terms should remain cited evidence for the model to interpret. They should not silently become authoritative services.

This separation preserves model freedom without surrendering truth. The model may infer that a site needs an ant-control page, a Raleigh pest-control page, both, or a selected Raleigh ant-control page. It may not infer that the owner offers a service the owner or credible first-party evidence does not support.

## The Recommended Page Taxonomy

The taxonomy is a vocabulary for reasoning and assessment, not a required planner schema.

| Page family | Customer job | Typical evidence | Default |
| --- | --- | --- | --- |
| Home | Understand the business, coverage, trust, and primary next step | Owner facts, proof, primary services and markets | Always |
| Service hub | Browse the service system and choose the relevant need | Confirmed offerings and service relationships | Usually when multiple services exist |
| Service detail | Decide whether the business can solve one distinct need | Scope, process, exclusions, proof, FAQs, next step | One per substantial distinct service |
| Problem or diagnostic page | Understand a symptom, risk, or decision before choosing service | First-hand expertise, safety boundaries, relevant service links | Selectively |
| Physical-location page | Visit, contact, or choose a real office | NAP, hours, staff, photos, directions, accessibility, location reviews | One per real customer-facing location |
| Service-area hub | Confirm coverage in a city or region and choose a service | Confirmed coverage, local constraints, projects, reviews, neighborhoods | Priority markets only |
| Service-by-area intersection | Resolve a service need in a specific market | Distinct demand, availability, process, rules, proof, or retained equity | Zero by default; selected intersections only |
| Project or case study | Verify experience through a real completed job | Owner-approved project facts, images, place, work performed, result | One per substantive verified project |
| Guide or article | Answer an important informational question | First-hand expertise, credible sources, owner review | As evidence and demand justify |
| About, team, process, financing, contact | Resolve trust or transaction questions | Owner facts and managed capabilities | As needed |
| Legal and policy | Meet legal, privacy, messaging, or accessibility needs | Approved policy text | As required |
| Archive, tag, author, pagination | Browse a sufficiently large content collection | Stable taxonomy and enough child content | Index only when useful as a destination |

### The page-existence test

Before creating or retaining a canonical, indexable route, ask:

1. **Distinct intent:** What customer question or task does this page serve that another page does not?
2. **Business truth:** Is the service, area, location, project, or expertise supported?
3. **Distinct evidence:** What information, proof, constraint, example, or local detail makes the answer specifically useful?
4. **Complete answer:** Can the page stand on its own without functioning only as a bridge to the same generic destination?
5. **Browseability:** Is there a natural crawlable path to it from a hub, service, location, project, or related article?
6. **Conversion role:** Does the next step fit the visitor's intent rather than repeat one generic funnel?
7. **Maintenance:** Can the business keep its facts, availability, dates, and proof accurate?
8. **Non-duplication:** Is a new route better than improving an existing route, using an on-page section, or consolidating with a redirect?

These are authoring and advisory assessment questions. Lodesta should not turn them into a mandatory pre-authoring form, numeric model score, or subjective publication gate.

## How Many Pages Should a Local-Service Site Have?

### Page count is an output

A useful mental model is:

`site size = core + justified services + real locations + justified service areas + selected intersections + proof + useful resources + required utility - consolidations`

None of those terms is a fixed constant. The same pest-control company can rationally have 15 pages in its first year and 250 pages after a decade of documented projects, pest guides, market expansion, and accumulated organic traffic.

### Review bands, not generation targets

The following bands are product-review priors. They should help reviewers notice a likely mismatch; they must not be placed in the authoring prompt as quotas.

| Business/source condition | Plausible canonical site size | What usually drives it |
| --- | ---: | --- |
| New or weak single-market, single-location business | 8-20 | Core pages, 3-10 services, contact, perhaps a few real guides or projects |
| Mature single-market, multi-service business | 20-60 | Deeper services, selected problem pages, a few service areas, proof, resources |
| Regional or multi-location operator | 40-150 | Real location pages, market hubs, selected intersections, projects, resources |
| Established content-rich or multi-state operator | 100-1,500+ | Large resource corpus, real location network, project portfolio, product/service depth, and sometimes scaled geo pages |

An eight-route site is not automatically deficient. A 250-route site is not automatically strong. The mismatch matters:

- A source with eight thin routes may deserve a better 15- or 25-route architecture.
- A source with 250 substantive and linked routes should not become a 14-route candidate without a route-by-route consolidation case and redirect map.
- A source with 250 archive, parameter, duplicate, and thin city URLs may deserve far fewer canonical routes.

### Service-page quantity

Create one strong page for each materially distinct service or decision. Do not split services merely because keyword tools expose synonyms. Combine them when the customer answer, process, proof, and conversion action are essentially the same.

Examples:

- `Ant control`, `termite control`, and `rodent control` normally merit separate pages because the diagnosis, risk, treatment, proof, and urgency differ.
- `Ant exterminator`, `ant removal`, and `ant treatment` normally belong on the same ant-control page.
- `Residential ant control` and `commercial ant control` merit separate pages only if scope, process, regulations, contracts, proof, or buyer needs differ materially.

### Service-area quantity

Start with real operating geography, not a keyword list.

- Use a regional hub when many small municipalities receive the same service and there is little distinct evidence for each.
- Use city pages for priority markets where customers need coverage confirmation and the business can supply local substance.
- Use neighborhood or ZIP-code pages rarely. They are usually better expressed within a city page unless operational differences, demand, proof, or retained equity justify separate URLs.
- A real location gets a location page even if its city also has a broader service-area page; the purposes differ.

### Service-by-area quantity

The default count is zero, followed by selective creation. A full `services x cities` matrix is never the default.

An intersection becomes reasonable when at least one strong reason exists and the page can still pass the page-existence test:

- the source already has meaningful traffic, links, conversions, or rankings for that exact URL;
- the service is unusually important in that market;
- availability, seasonality, housing stock, regulation, pricing, response process, or treatment differs there;
- the business has local projects, reviews, staff, images, or data for that service;
- the city hub would otherwise become too broad to answer the service-specific need;
- live search results show distinct intent that a combined page cannot serve well.

The resulting program may contain no intersections, ten, thirty, or more. The model should choose from evidence, and Search Console should validate the program after publication.

## Architecture by Source Quality

Lodesta should improve from the source rather than simply mimic or ignore it.

| Existing source | Recommended approach |
| --- | --- |
| Strong and large | Preserve useful paths, content coverage, internal relationships, and search equity. Improve hierarchy, page experience, and duplication selectively. |
| Weak and large | Inventory everything. Preserve performance-backed or externally linked URLs; merge thin variants; redirect directly; rebuild missing hubs and customer journeys. Do not equate volume with value. |
| Strong and small | Keep the clarity and useful paths. Add only evidenced gaps such as a missing service detail, location page, project, or decision guide. |
| Weak and small | Build the strongest truthful architecture from owner facts, market research, customer questions, and proof. The source is evidence, not a ceiling. |
| New business with no source | Start compact, complete, and maintainable. Expand from owner knowledge, customer questions, projects, Search Console, and real market demand. |

This is why replacing an enforced catalog with model ownership was correct. The missing control is not another schema that predetermines the answer; it is complete evidence, source-equity data, clear universal guidance, and transparent post-authoring coverage.

## Migration and URL Preservation

### A crawl is necessary but not sufficient

A crawl reveals URLs, status, canonicals, content, link prominence, duplication, and structure. It does not reveal which pages generate leads, impressions, backlinks, branded demand, or offline value.

For a mature migration, the strongest evidence bundle includes:

- complete crawl and sitemap inventory;
- Google Search Console page/query impressions, clicks, CTR, and position;
- analytics landing pages and conversion events;
- known backlinks and important referral URLs;
- Google Business Profile landing URLs and campaign destinations;
- source canonicals, indexability, internal links, content uniqueness, and last-modified history;
- owner knowledge of important services, markets, projects, and campaigns.

When performance data is unavailable, preservation should be more conservative.

### Preserve paths by default

Google recommends creating an exact old-to-new URL mapping and using direct permanent redirects. It warns against redirecting many unrelated old URLs to the homepage. It also recommends updating internal links and sitemaps, monitoring Search Console, and expecting temporary fluctuation while old and new URLs are recrawled. [Google URL-changing site moves](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes), [hosting moves without URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-no-url-changes)

Lodesta's migration order should be:

1. Keep the exact source path when it still represents a useful destination.
2. Consolidate only when another page genuinely provides the better complete answer.
3. Redirect old to new in one direct permanent hop.
4. Retire without redirect only when no useful equivalent exists and the loss is intentional.
5. Keep only preferred canonical URLs in the generated sitemap. [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)

Every candidate should expose a source-coverage report showing preserved, redirected, canonical duplicate, intentionally retired, and unaccounted paths. Coverage is advisory for subjective quality, but broken redirects and missing destinations are functional errors.

## Blogs, Guides, and Editorial Strategy

### Do not create a blog merely to have one

An empty blog looks unfinished. A stream of generic AI articles creates maintenance cost, factual risk, and scaled-content risk without guaranteeing visibility or leads.

Lodesta should use "Resources," "Guides," "Advice," or another business-appropriate label when the collection contains durable customer answers. "Blog" is also fine when the owner actually intends ongoing editorial publishing. The label does not affect the underlying quality requirement.

### Migrate existing useful editorial content

For a mature source:

- preserve useful article slugs by default;
- retain original publication dates when known;
- set modified dates only after significant updates;
- preserve authorship where accurate;
- consolidate true duplicates with direct redirects;
- keep category, tag, author, and pagination routes only when they are useful browse destinations;
- do not place thin archives in the canonical sitemap merely because the old CMS created them.

Google recommends visible dates that agree with structured data, and it warns against artificially freshening pages without significant new information. [Google publication dates](https://developers.google.com/search/docs/appearance/publication-dates)

### Create new editorial content from real inputs

High-value local-service editorial sources include:

- recurring questions from calls, estimates, and technicians;
- decision guides covering repair versus replacement, timing, cost drivers, preparation, and what to expect;
- diagnostic guides with responsible DIY and safety boundaries;
- seasonal or locally specific conditions that materially affect the service;
- verified project and case-study material;
- changes in regulations, rebates, availability, or business operations;
- original photos, measurements, data, checklists, and professional observations.

Weak sources include generic national explainers with no first-hand contribution, local lifestyle filler unrelated to the business, rewritten competitor posts, and one article per keyword variation.

Google says AI use is not inherently disallowed; the purpose, accuracy, and usefulness of the content matter. It recommends accurate bylines and appropriate disclosure, and it says not to list an AI system as the author. [Google guidance about AI-generated content](https://developers.google.com/search/blog/2023/02/google-search-and-ai-content)

Orbit Media's 2025 survey of 808 content marketers found that only 21% reported "strong results," that more detailed and more frequent programs correlated with self-reported success, and that complete AI-written articles were the AI use least associated with strong results. The sample skews toward the researcher's US, B2B, LinkedIn-heavy network, and "strong results" was deliberately broad. It demonstrates that editorial work can compound, not that a local pest company should publish several times per week. [Orbit Media 2025 blogger survey](https://www.orbitmedia.com/blog/blogging-statistics/)

### No universal cadence

Lodesta should not promise "four posts per month" or another SEO quota. Publish when a substantial customer answer or business story is ready. Review important evergreen content periodically based on factual change, Search Console demand, traffic, leads, and decay—not a blanket timer.

Good editorial operations are event-driven:

- publish after a meaningful owner-approved draft exists;
- update when facts, methods, availability, laws, or the answer materially change;
- improve pages already receiving relevant impressions before manufacturing unrelated topics;
- merge or retire weak overlapping content with direct redirects;
- leave accurate evergreen content alone when it still performs its job.

Search Console exposes page and query performance so owners can identify relevant high- and low-performing pages and optimization opportunities. [Get started with Search Console](https://developers.google.com/search/docs/monitor-debug/search-console-start)

### Current Lodesta capability

The current Lodesta agent can create a static route that looks like an article, create a candidate, and let the owner publish that version. The authoring prompt gives the model route ownership and permits static semantic pages. [Current authoring guidance](../packages/site-agent/prompts.ts)

That is not yet a robust editorial product:

- the retained route contract contains only `path`, `title`, `description`, and `bodyHtml`; it has no content kind, stable article identity, excerpt, author, publication date, modification date, topic, hero image, canonical override, or per-page indexability; [artifact route contract](../packages/site-verification/contracts.ts)
- the sitemap gives every route the same site-version modification time rather than meaningful page dates; [public sitemap generation](../packages/site-platform/public-site.ts)
- the owner composer is text-only and the API accepts a 6,000-character instruction, so owners cannot yet attach job notes, documents, or article media through this surface; [run API](../app/api/site-agent/runs/route.ts), [owner workspace](../components/SiteAgentWorkspace.tsx)
- there is no first-class article JSON-LD, RSS or Atom feed, independent article draft, scheduled publication, content library, or editorial revision workflow.

### Recommended minimum editorial product

Lodesta does not need to build a conventional CMS before owners can publish useful articles. The simplest powerful version is chat-driven but structured:

1. Add first-class route metadata for content kind, stable content ID, slug, title, description, excerpt, author, visible publication date, modification date, hero asset, topics, canonical, and indexability.
2. Generate valid `Article` or `BlogPosting` structured data with accurate headline, author, dates, and representative images. [Google Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article)
3. Auto-maintain the resource index, related links, breadcrumbs, sitemap inclusion, and accurate per-page `lastmod`. [Google breadcrumb structured data](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)
4. Let an owner request an article in chat, provide facts and attachments, answer essential questions, review the candidate, and press Publish.
5. Never auto-publish recurring AI content without owner review.
6. Add RSS/Atom when Lodesta presents the feature as an ongoing blog or when syndication becomes useful; scheduling and a separate editorial calendar can wait for demonstrated demand.

An entire-site immutable version can remain the atomic publication unit initially. Independent article records become more important when owners need parallel drafts, scheduled posts, multiple editors, or high publication frequency.

## Live Sitemap Benchmarks

On July 31, 2026, Lodesta fetched the robots-declared public sitemaps for four service businesses. These counts describe what the sites exposed as sitemap URLs; they do not establish how many pages Google indexed, how many generated leads, or whether the architecture is ideal.

| Site | Sitemap inventory | Observed architecture |
| --- | ---: | --- |
| [Triangle Pest Control](https://www.trianglepest.com/) | 200 | 42 general pages, 90 blog posts, 28 learning-center entries, and 40 location pages; the general set includes roughly 25 selected service-by-city landing pages |
| [Morris-Jenkins](https://morrisjenkins.com/) | 464 | 99 `/blog` URLs, broad service families, two regional site sections, and 97 URLs in service-area hierarchies that selectively descend into service-by-city detail |
| [A1 Garage Door Service](https://a1garage.com/) | 1,671 unique same-origin URLs | The sitemap labels 995 service-area URLs, 262 posts, 388 pages, 25 category pages, and 11 author pages; it is an extreme scaled-geo example, not a default target |
| [Baker Roofing](https://bakerroofing.com/) | 197 | 46 posts, 36 pages, 91 project pages, 21 location pages, and 3 campaign pages; project proof contributes more routes than generic editorial content |

The benchmark shows four different ways a site becomes large:

- a knowledge library and city hubs;
- a selective multi-region service hierarchy;
- a scaled geographic program;
- a verified project portfolio and real office network.

It does not support the proposition that every local business should have hundreds of pages.

### Rough repetition diagnostic

As a descriptive check, Lodesta stripped scripts, styles, SVG, and markup from the main/body content of public location-page samples and compared seven-word shingles. This is sensitive to repeated navigation and template text and is not a search-engine quality score.

| Page family | Pages fetched | Median words | Median pairwise shingle similarity |
| --- | ---: | ---: | ---: |
| Triangle Pest location pages | 40 of 40 | 594 | 0.529 |
| A1 current `/areas-served/` sample | 40 of 81 matching routes | 2,798 | 0.718 |
| Baker location pages | 21 of 21 | 338 | 0.359 |

All fetched normalized bodies were distinct, yet the A1 sample remained highly repetitive. That is exactly why uniqueness cannot be reduced to an exact hash, a word count, or paraphrasing. Distinct value is semantic.

## Kind Pest Internal Case Study

The Kind Pest test site `site_ca76b16e4e0626f8c56e0279d7edd5ce` is a useful failure case for architecture, not for crawling.

The July 31, 2026 crawl recorded:

- 404 discovered URLs;
- 403 eligible document URLs;
- 394 fetched pages;
- 9 failed and 0 unfinished URLs;
- 352 indexable crawl rows representing 334 unique indexable paths;
- 259 substantive content paths after removing archive/pagination and utility routes;
- 208 substantive pages with at least 500 words, with an approximately 803-word median;
- 259 unique raw hashes among those substantive paths.

The candidate contained only 14 routes. Its source-coverage report recorded 19 preserved source pages, 8 canonical duplicates, 377 unaccounted source pages, no redirects, and no intentional retirements. The authoring run read only four source pages and did not use the inventory-listing or source-search tools.

The conclusion is not that every one of the 404 discovered URLs should remain indexable. The conclusion is that 14 routes is not a defensible interpretation of this source. The crawl succeeded, but the model did not use enough of the retained corpus and the candidate did not account for the migration.

Without Search Console, analytics, and backlink data, an offline reconstruction target would likely remain in the rough range of 230-280 canonical routes, composed approximately of:

- 6-10 core and company routes;
- 15-25 core service or pest routes;
- 12-15 city or regional hubs;
- 10-30 selected, evidenced service-by-market intersections;
- 170-220 retained or improved useful guides and articles;
- 3-6 browseable resource-category hubs.

Those are case-specific inventory estimates, not a pest-control template and not a product quota. Search-performance data could justify keeping more, while duplication and zero-value archives could justify keeping fewer.

## Concrete Lodesta Product Recommendations

### Authoring and architecture

1. Keep the full-crawl, immutable replayable capture, compact inventory, and page-level lexical retrieval direction.
2. Keep owner-controlled offerings and model-owned route architecture. Do not restore catalogs, vertical modules, fixed route plans, or numeric targets.
3. Make the initial inventory communicate source scale unmistakably: complete path tree, page-family-neutral groupings, substantive counts, canonical/duplicate state, and link prominence.
4. Keep every source page retrievable, with citations and metadata filters.
5. Add first-party performance inputs—especially Search Console and analytics—before making aggressive mature-site consolidation decisions.
6. Keep the route-by-route candidate source-coverage report visible to owners and operators.
7. Evaluate corpus use and architecture quality in canaries. Low retrieval use, unexplained source omissions, and a dramatic source/candidate scale mismatch should be prominent advisory failures, not new mandatory tool sequences or subjective publish gates.
8. Assess generated routes by inferred customer purpose and evidence, not a service catalog or prewritten page requirements.

The current universal authoring prompt already tells the model to review the complete inventory, preserve useful paths, avoid collapsing substantial sources, and avoid automatic service-by-location permutations. The Kind result shows that guidance and tool availability alone do not guarantee good corpus use. The next improvement should make source scale and uncovered content harder to overlook and measure the result, not reduce model ownership.

### Editorial

1. Migrate useful existing articles and slugs by default.
2. Do not manufacture a blog for every new customer.
3. Let the model propose topics and drafts from owner knowledge, source evidence, actual customer questions, and search-performance opportunities.
4. Require owner review before publication, especially for technical, safety, legal, medical, financial, price, guarantee, or outcome claims.
5. Add structured article metadata and attachment intake before marketing chat as a complete blogging solution.
6. Keep the initial owner experience conversational; add traditional CMS surfaces only when scheduling, parallel drafts, permissions, or editorial volume make them necessary.

## Decision Table

| Decision | Lodesta default | Evidence level |
| --- | --- | --- |
| Universal page count | None | Hard default |
| Universal service catalog | None | Product default |
| Dedicated page for a substantive distinct service | Yes | Product default |
| Every synonym as a service page | No | Avoid by default |
| One page per real public location | Yes | Hard default |
| Service-area city pages | Priority markets with distinct usefulness | Product default |
| Full service-by-city matrix | No | Avoid by default |
| Selected service-by-city pages | Yes when evidence and intent justify them | Product default |
| Preserve an existing useful path | Yes | Hard migration default |
| Redirect many old routes to home | No | Hard default |
| Auto-create a generic blog | No | Product default |
| Migrate useful existing articles | Yes | Hard migration default |
| Auto-publish recurring AI articles | No | Avoid by default |
| Chat-driven article drafting and owner-reviewed publication | Yes | Product default |
| Fixed publishing cadence or word count | None | Hard default |
| Index thin tags, archives, and pagination by default | No | Product default |
| Put every route in primary navigation | No | Product default |
| Make every important route crawlably reachable | Yes | Hard default |

## Open Questions to Measure

- Does clearer source-scale framing materially increase the number and diversity of source pages the author retrieves?
- Which service-area page inputs—local reviews, projects, technician notes, local constraints, or search demand—best predict leads and durable indexation?
- How often do selected service-by-market pages outperform a strong city hub plus service page enough to justify maintenance?
- For sparse sites, do a few owner-informed guides outperform a larger AI-assisted launch corpus on leads, indexed pages, and owner satisfaction?
- At what editorial volume do owners need independent drafts and scheduling rather than whole-site candidate publication?
- Which archive and resource-taxonomy patterns help visitors browse versus merely create crawlable low-value URLs?
- How much source preservation changes when Search Console and analytics data are available compared with crawl-only inference?

## Primary Sources

### Official search and platform guidance

- [Google people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Google developer guide](https://developers.google.com/search/docs/fundamentals/get-started-developers)
- [Google site moves with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)
- [Google site moves without URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-no-url-changes)
- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google local ranking guidance](https://support.google.com/business/answer/7091)
- [Google LocalBusiness structured data](https://developers.google.com/search/docs/appearance/structured-data/local-business)
- [Google Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article)
- [Google publication-date guidance](https://developers.google.com/search/docs/appearance/publication-dates)
- [Google AI-content guidance](https://developers.google.com/search/blog/2023/02/google-search-and-ai-content)
- [Google AI optimization guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots)

### Local-search and editorial evidence

- [Whitespark 2026 Local Search Ranking Factors](https://whitespark.ca/local-search-ranking-factors/)
- [BrightLocal service-area pages](https://www.brightlocal.com/learn/service-area-pages/)
- [BrightLocal location pages](https://www.brightlocal.com/learn/location-pages/)
- [BrightLocal consumer search behavior 2025](https://www.brightlocal.com/research/consumer-search-behavior/)
- [BrightLocal consumer search channels 2026](https://www.brightlocal.com/research/consumer-search-behavior-channels/)
- [Sterling Sky similar service-area page case](https://www.sterlingsky.ca/service-area-pages-duplicate-content/)
- [Orbit Media 2025 blogger survey](https://www.orbitmedia.com/blog/blogging-statistics/)

### Related Lodesta research

- [Local Business CRO Research Playbook](local-business-cro-research-playbook.md)
