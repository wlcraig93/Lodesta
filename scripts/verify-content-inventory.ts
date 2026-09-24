import assert from "node:assert/strict";
import {
  contentInventoryModule,
  contentInventoryPath,
  createArchitectureEvidenceFiles,
  createFirstPartyContentInventory,
  maximumApprovedSourceIndexCharacters,
  type FirstPartyContentInventory
} from "../packages/site-agent";
import type { PublicFact, SiteArchitecturePlan, SourceSnapshotPage } from "../packages/site-contracts";
import { reviewAttributionName, reviewAttributionPageTopicWords } from "../lib/review-attribution";

// Site chrome repeated on every page must never read as content.
const chrome = ["Home", "Services", "Reviews", "Paint Protection Film", "A screen protector for your car's paint", "Call 555-201-3344"];

const reviews = page("/reviews", "Reviews", [
  "Reviews",
  "Happy With Our Service?",
  "Alex and his team did a great job today! I had a huge tree very close to the house and they removed it cleanly.",
  "Ted L.",
  "Called around to several companies. These folks were polite and professional and took care of two dead trees with a quickness.",
  "Hilda H.",
  "We had a limb hanging over the fence. The crew arrived on time and they guarantee every job at no extra cost, which sold us.",
  "Wendy P.",
  "Kept us informed the whole way and the crew cleaned up every twig before leaving the property.",
  "Mo",
  "When our basement flooded at midnight they sent an emergency crew, explained every safety step, and the price was exactly what they quoted.",
  "Dana R.",
  "“They are licensed and insured and guarantee the lowest price in town, so call us anytime day or night.”"
], ["Reviews", "Happy With Our Service?", "Ted L.", "Hilda H.", "Wendy P.", "Dana R."]);

const collapsedTestimonials = page("/what-our-customers-say-about-us", "What our customers say", [
  "What our customers say about us",
  "\"I've done business with Mike for years. I would highly recommend Mike because he is honest and careful.\" - Jim\"Proper electrical function is vital to my business, and HD is the company I trust with it.\" - Sharon\"Mike - you made me look great to my buyers! Thank you for everything you did on the house.\" - Lorrie Westberry, Realtor"
]);

const googleWidget = page("/testimonials", "Testimonials", [
  "See what our customers say about us:",
  "A & T Well and Pump",
  "4.7",
  "Based on 83 reviews",
  "Tim",
  "12:25 22 Sep 26",
  "When our well failed the crew arrived the same day and I had water again by evening. I highly recommend them.",
  "Mary Ramsey",
  "14:32 02 May 26",
  "Stewart came very quickly and fixed the issue perfectly. I highly recommend them to anyone on a well."
]);

const service = page("/services/tree-removal", "Tree Removal", [
  "Tree Removal",
  "Dangerous Trees",
  "Dangerous trees include:",
  "trees too close to a building;",
  "trees with dead limbs overhanging driveways or streets;",
  "large trees growing too close to power lines.",
  "Tree Removal Cost",
  "Stump grinding",
  "Small trees $400",
  "Large trees $5,000",
  "We do not bring heavy machinery onto your lawn, and we haul all debris to an offsite recycling yard.",
  "Great experience. I had been trimming the tree myself and this was the first time I hired a tree service.",
  "Kevin S.",
  "Soil Drenches",
  "Our team applies each treatment with attention to species and season, and we follow the label.",
  "Mulching Basics"
], ["Tree Removal", "Dangerous Trees", "Tree Removal Cost", "Kevin S.", "Soil Drenches", "Mulching Basics"]);

const faq = page("/faq", "FAQ", [
  "Frequently Asked Questions",
  "What should I do to prepare my car for a detailing appointment?",
  "Please remove all personal belongings and make sure there is enough fuel to move the vehicle around the shop.",
  "How long is the warranty on window film?",
  "We offer a 10 year warranty on our paint protection film and a lifetime warranty on our window film.",
  "Are you licensed and insured?",
  "We are fully insured and carry general liability and automobile coverage.",
  "What are your operating hours?",
  "Pristine Auto Detailing operates Monday through Saturday by appointment only.",
  "Do you price match?",
  "We will gladly match the price on an identical service sold by our closest competitor."
], ["Frequently Asked Questions", "What should I do to prepare my car for a detailing appointment?"]);

const inlineFaq = page("/common-questions", "Common Questions", [
  "COMMON ELECTRICAL QUESTIONS:Q: How do I reset my breaker?A: Push the breaker handle all the way to the off position and then turn it back on.Q: Is Grounding really important?A: YES"
]);

const about = page("/about-us", "About Us", [
  "About Us",
  "Tracy – owner of A Good Morning Tree Service",
  "Tracy leads a diverse team of dedicated women, including Kayla, Lizann, Lanie, and Yanet.",
  "Owner and operator, Tyler Nichols has over 10 years of experience with well pumps and is licensed by the state of North Carolina.",
  "If you are planning a construction project, call us to schedule an arborist consultation."
]);

const portfolio = page("/portfolio/2024-ford-f-150-raptor", "2024 Ford F-150 Raptor | Pristine Auto Detailing", [
  "2024 Ford F-150 Raptor",
  "Background:We recently worked on a 2024 Ford F-150 Raptor, delivering our protection and detailing services.",
  "Challenge:The client wanted robust protection for the front end.",
  "Solution:We applied a full front-end PPF using XPEL Fusion with a Level 2 ceramic coating. The package normally costs $2,400.",
  "Results:The Raptor was delivered in top condition.",
  "Services used:",
  "Paint Correction",
  "Paint Protection Film",
  "No items found.",
  "Packages used:"
], ["2024 Ford F-150 Raptor"]);

const projectHub = page("/projects", "Projects", [
  "Tree Service Projects",
  "Fiber Optic Line Clearing Project",
  "A Good Morning Tree Service was contracted to clear limbs around utility communication lines across several Austin neighborhoods.",
  "Tuesday April 7, 2026",
  "Buildings five through eight – all parking spaces need to be cleared before the crew arrives."
], ["Tree Service Projects", "Fiber Optic Line Clearing Project", "Tuesday April 7, 2026"]);

const contact = page("/contact-info", "Reach Us", [
  "Reach the office:",
  "Call 555-201-3344",
  "Email us any time",
  "Message us online"
]);

const pages = [reviews, collapsedTestimonials, googleWidget, service, faq, inlineFaq, about, portfolio, projectHub, contact, page("/legal/privacy-policy", "Privacy", ["We never sell your data and I promise that is true. - Owner"])];
const facts: PublicFact[] = [
  proofFact("fact_proof_1", "Observed testimonial from Hilda H.", "Called around to several companies. These folks were polite and professional and took care of two dead trees with a quickness."),
  proofFact("fact_proof_credential_1", "Observed license or certification", "ISA Certified Arborist TX-5204A")
];

const inventory = createFirstPartyContentInventory({
  pages,
  publicFacts: facts,
  routeForSourcePath: (path) => (path === "/reviews" ? "/reviews" : path.startsWith("/portfolio") ? "/our-work" : undefined),
  imagesForSourcePath: (path) => (path.startsWith("/portfolio/") ? ["resource_raptor_1", "resource_raptor_2"] : [])
});
const quotes = inventory.testimonials.map((testimonial) => testimonial.quote);

// Testimonials: verbatim, attributed, provenance-bound.
const ted = inventory.testimonials.find((testimonial) => testimonial.attribution === "Ted L.");
assert.equal(ted?.quote, "Alex and his team did a great job today! I had a huge tree very close to the house and they removed it cleanly.");
assert.equal(ted?.sourcePath, "/reviews");
assert.equal(ted?.routePath, "/reviews");
assert.equal(inventory.testimonials.find((testimonial) => testimonial.attribution === "Hilda H.")?.publicFactId, "fact_proof_1");
assert.ok(inventory.testimonials.some((testimonial) => testimonial.attribution === "Mo"), "a proof-page card with a short name is kept");
assert.equal(inventory.testimonials.find((testimonial) => testimonial.attribution === "Jim")?.quote,
  "I've done business with Mike for years. I would highly recommend Mike because he is honest and careful.");
assert.ok(inventory.testimonials.some((testimonial) => testimonial.attribution === "Lorrie Westberry, Realtor"));
assert.ok(inventory.testimonials.some((testimonial) => testimonial.attribution === "Kevin S." && testimonial.sourcePath === "/services/tree-removal"));
// Business copy under a section heading is not a testimonial.
assert.ok(!inventory.testimonials.some((testimonial) => testimonial.attribution === "Soil Drenches" || testimonial.attribution === "Mulching Basics"));
assert.ok(!quotes.some((quote) => /heavy machinery/.test(quote)));
// Review-platform widget text is never collected.
assert.deepEqual(inventory.thirdPartyReviewSurfaces, ["/testimonials"]);
assert.ok(!quotes.some((quote) => /same day|Stewart/.test(quote)));
// A customer's attributed words are kept verbatim whatever they mention
// (guarantee, emergency, safety, price): they are quoted speech, not a claim.
assert.equal(inventory.testimonials.find((testimonial) => testimonial.attribution === "Wendy P.")?.quote,
  "We had a limb hanging over the fence. The crew arrived on time and they guarantee every job at no extra cost, which sold us.");
assert.equal(inventory.testimonials.find((testimonial) => testimonial.attribution === "Dana R.")?.quote,
  "When our basement flooded at midnight they sent an emergency crew, explained every safety step, and the price was exactly what they quoted.");
// An unattributed, unconfirmed quotation that states a sensitive claim is still withheld.
assert.ok(!quotes.some((quote) => /lowest price in town/.test(quote)));
// Legal pages are not mined.
assert.ok(!quotes.some((quote) => /sell your data/.test(quote)));

// FAQs: verbatim Q/A; sensitive answers withheld.
assert.deepEqual(inventory.faqs.find((entry) => entry.question.startsWith("What should I do"))?.answer,
  "Please remove all personal belongings and make sure there is enough fuel to move the vehicle around the shop.");
assert.equal(inventory.faqs.find((entry) => entry.question === "How do I reset my breaker?")?.answer,
  "Push the breaker handle all the way to the off position and then turn it back on.");
assert.equal(inventory.faqs.find((entry) => entry.question === "Is Grounding really important?")?.answer, "YES");
for (const withheldQuestion of [/warranty/i, /licensed/i, /operating hours/i, /price match/i]) {
  assert.ok(!inventory.faqs.some((entry) => withheldQuestion.test(entry.question)), `withheld FAQ ${withheldQuestion}`);
}

// People: names and roles; credential statements withheld while the name stays.
assert.deepEqual(inventory.people.find((person) => person.name === "Tracy")?.role, "owner");
assert.ok(inventory.people.some((person) => person.role === "team members" && person.name === "Kayla, Lizann, Lanie, Yanet"));
const tyler = inventory.people.find((person) => person.name === "Tyler Nichols");
assert.equal(tyler?.role, "owner and operator");
assert.equal(tyler?.statement, undefined);
assert.ok(!inventory.people.some((person) => /consultation/i.test(person.name)));

// Projects: case-study structure, services used, documented photos; prices withheld.
const raptor = inventory.projects.find((project) => project.title === "2024 Ford F-150 Raptor");
assert.ok(raptor?.summary?.includes("XPEL Fusion"));
assert.ok(!raptor?.summary?.includes("$"));
assert.deepEqual(raptor?.servicesUsed, ["Paint Correction", "Paint Protection Film"]);
assert.deepEqual(raptor?.imageResourceIds, ["resource_raptor_1", "resource_raptor_2"]);
assert.equal(raptor?.routePath, "/our-work");
assert.ok(inventory.projects.some((project) => project.title === "Fiber Optic Line Clearing Project"));
assert.ok(!inventory.projects.some((project) => /April 7/.test(project.title)), "schedule notices are not projects");

// Service lists: inclusions kept verbatim; priced lists and contact rows are not.
const dangerous = inventory.serviceLists.find((list) => list.lead === "Dangerous Trees");
assert.deepEqual(dangerous?.items, [
  "Dangerous trees include:",
  "trees too close to a building;",
  "trees with dead limbs overhanging driveways or streets;",
  "large trees growing too close to power lines."
]);
assert.ok(!inventory.serviceLists.some((list) => list.items.some((item) => /\$/.test(item))));
assert.ok(!inventory.serviceLists.some((list) => /Reach the office/.test(list.lead)));

// Fact references carry non-testimonial proof by public fact ID.
assert.deepEqual(inventory.factReferences, [{ publicFactId: "fact_proof_credential_1", label: "Observed license or certification", value: "ISA Certified Arborist TX-5204A" }]);

// Fact safety: no withheld sensitive statement reaches the author-facing module.
const module = contentInventoryModule(inventory);
for (const sensitive of [
  "lowest price in town",
  "10 year warranty",
  "fully insured",
  "Monday through Saturday",
  "match the price",
  "licensed by the state",
  "$2,400",
  "$5,000",
  "same day"
]) {
  assert.ok(!module.includes(sensitive), `sensitive text leaked: ${sensitive}`);
}
const topics = new Set(inventory.withheld.map((entry) => entry.topic));
for (const topic of ["guarantee", "credential", "availability", "price"] as const) assert.ok(topics.has(topic), `withheld topic ${topic}`);
assert.ok(inventory.withheld.every((entry) => entry.sourcePaths.length > 0 && entry.count >= entry.sourcePaths.length));
assert.match(module, /^\/\*\*[\s\S]*export const contentInventory = \{/);
assert.doesNotThrow(() => JSON.parse(module.slice(module.indexOf("{"), module.lastIndexOf("} as const") + 1)) as FirstPartyContentInventory);

// Bounded: category caps hold on a large mirror.
const manyFaqPage = page("/faq-large", "FAQ", ["Frequently Asked Questions", ...Array.from({ length: 60 }, (_, index) => [
  `How does option number ${index + 1} work for my yard?`,
  `Option number ${index + 1} covers the front beds and the back fence line with ordinary seasonal care for plants.`
]).flat()]);
const large = createFirstPartyContentInventory({ pages: [manyFaqPage] });
assert.equal(large.faqs.length, 20);
assert.equal(large.omitted?.faqs, 40);

// Delivered as a read-only workspace module beside the source index, with approved routes.
const plan: SiteArchitecturePlan = {
  strategy: "Keep proof and work routes.",
  primaryNavigation: [{ label: "Home", path: "/" }, { label: "Reviews", path: "/reviews" }],
  routes: [
    { path: "/", label: "Home", purpose: "Introduce the business.", pageType: "home", parentPath: null, navigation: "primary", sourcePaths: ["/about-us"] },
    { path: "/reviews", label: "Reviews", purpose: "Show what customers say.", pageType: "proof", parentPath: null, navigation: "primary", sourcePaths: ["/reviews"] },
    { path: "/our-work", label: "Our Work", purpose: "Show finished jobs.", pageType: "portfolio", parentPath: null, navigation: "secondary", sourcePaths: ["/portfolio/2024-ford-f-150-raptor"] }
  ],
  sourceDispositions: {},
  authoringGuidance: []
} as unknown as SiteArchitecturePlan;
const files = createArchitectureEvidenceFiles([reviews, about, portfolio], plan, {
  retainedContentMode: "indexed-pull-preview-readable",
  publicFacts: facts
});
const inventoryFile = files.find((file) => file.path === contentInventoryPath);
assert.ok(inventoryFile, "readable evidence mode emits the content inventory");
assert.match(inventoryFile.content, /"routePath": "\/our-work"/);
assert.match(inventoryFile.content, /"routePath": "\/"/);
assert.equal(files[1]?.path, "src/approved-source-index.ts");
const emptyFiles = createArchitectureEvidenceFiles([page("/", "Home", ["Welcome to the shop."])], plan, { retainedContentMode: "indexed-pull-preview-readable" });
assert.ok(!emptyFiles.some((file) => file.path === contentInventoryPath), "no module when nothing was found");

// Arceneaux regression: ~700 consolidated source pages must not produce a
// source index over the 1,000,000-character workspace file limit. Excerpts are
// bounded and every omitted mapped source is named.
{
  const blogPages = Array.from({ length: 700 }, (_, index) => page(`/blog/post-${index}`, `Pest tip ${index}`,
    Array.from({ length: 30 }, (_line, line) => `Post ${index} explains local pest habit number ${line} in enough plain detail for homeowners to act on it.`),
    Array.from({ length: 20 }, (_heading, heading) => `Post ${index} heading ${heading}`)));
  const largePlan = {
    ...plan,
    routes: [
      { path: "/", label: "Home", purpose: "Introduce the business.", pageType: "home", parentPath: null, navigation: "primary", sourcePaths: blogPages.slice(0, 350).map((entry) => entry.path) },
      { path: "/pest-control", label: "Pest control", purpose: "Explain services.", pageType: "service", parentPath: null, navigation: "primary", sourcePaths: blogPages.slice(350).map((entry) => entry.path) }
    ]
  } as unknown as SiteArchitecturePlan;
  const largeFiles = createArchitectureEvidenceFiles(blogPages, largePlan, { retainedContentMode: "indexed-pull-preview-readable" });
  const largeIndex = largeFiles.find((file) => file.path === "src/approved-source-index.ts")!;
  assert.ok(largeIndex.content.length <= maximumApprovedSourceIndexCharacters, `source index is ${largeIndex.content.length} characters`);
  const parsed = JSON.parse(largeIndex.content.slice(largeIndex.content.indexOf("{"), largeIndex.content.lastIndexOf("} as const") + 1)) as {
    routes: Array<{ sources: unknown[]; answer: { distinctions: unknown[]; omittedDistinctions?: { count: number; sourcePaths: string[] } } }>;
  };
  for (const route of parsed.routes) {
    assert.equal(route.sources.length, 350, "every mapped source keeps its contentFiles pointer");
    assert.ok(route.answer.omittedDistinctions, "bounded excerpts name their omissions");
    assert.equal(route.answer.distinctions.length + route.answer.omittedDistinctions.count, 350);
  }
}

if (process.env.CONTENT_INVENTORY_DEBUG) console.log(module);
console.log("content inventory verification passed");

// Review attribution is vertical-neutral: names that share a trade, city or
// state word are real reviewers; only the page's own topic words and
// generic entity/interface labels are rejected.
{
  const reviewsTopic = reviewAttributionPageTopicWords({ title: "Reviews", path: "/reviews" });
  for (const reviewer of ["Austin T.", "Tree Wellington", "Carol Pump", "Dallas Roofing-Smith"]) {
    assert.ok(reviewAttributionName(reviewer, reviewsTopic), `${reviewer} was rejected by a vertical or geographic word list.`);
  }
  const serviceTopic = reviewAttributionPageTopicWords({ title: "Tree Removal", path: "/services/tree-removal" });
  assert.equal(reviewAttributionName("Tree Removal", serviceTopic), undefined, "A page's own service title was read as a reviewer.");
  for (const label of ["Acme Services", "Smith Company", "Read More", "Google"]) {
    assert.equal(reviewAttributionName(label, reviewsTopic), undefined, `${label} was read as a reviewer.`);
  }
}

function page(path: string, title: string, lines: string[], headings: string[] = [title]): SourceSnapshotPage {
  const extractedText = [...chrome, ...lines, ...chrome].join("\n");
  const hash = Buffer.from(path).toString("hex").padEnd(64, "0").slice(0, 64);
  return {
    schemaVersion: 1,
    id: `page_${hash.slice(0, 16)}`,
    sourceSnapshotId: "source_test",
    resourceId: `resource_${hash.slice(0, 16)}`,
    requestedUrl: `https://example.com${path}`,
    finalUrl: `https://example.com${path}`,
    path,
    outcome: "fetched",
    status: 200,
    contentType: "text/html",
    indexability: "indexable",
    title,
    headings,
    wordCount: extractedText.split(/\s+/).length,
    internalLinks: [],
    externalLinks: [],
    rawContentHash: `sha256:${hash}`,
    linkProminence: 1,
    extractedText,
    textContentHash: `sha256:${hash}`,
    producer: "test",
    inputHash: `sha256:${"e".repeat(64)}`,
    createdAt: "2026-09-23T00:00:00.000Z"
  };
}

function proofFact(id: string, label: string, value: string): PublicFact {
  return {
    id,
    kind: "proof",
    label,
    value,
    source: {
      factId: id,
      sourceSnapshotId: "source_test",
      sourceUrl: "https://example.com/reviews",
      evidenceClass: "first_party",
      observedAt: "2026-09-23T00:00:00.000Z",
      confidence: 0.65,
      ownerConfirmed: false
    },
    publicEligible: true
  } as PublicFact;
}
