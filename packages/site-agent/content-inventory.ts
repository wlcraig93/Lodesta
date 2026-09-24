import { reviewAttributionName, reviewAttributionPageTopicWords } from "@/lib/review-attribution";
import type { SitePublicBuildInput, SourceSnapshotPage } from "@/packages/site-contracts";
import { classifySourcePagePath, isLegalSourcePagePath } from "@/packages/business-data/source-page-classification";
import { sensitiveFirstPartyTopics, type SensitiveFirstPartyTopic } from "@/packages/business-data/first-party-support";

/**
 * A compact, category-organized index of the business's own first-party
 * content across the whole retained mirror: customer quotations, FAQs, named
 * people, projects, and service lists. Every entry is a verbatim excerpt with
 * its source page and the approved live route that consolidates that page.
 *
 * It is source material for the author, never render-time data, and it does
 * not widen fact authority. First-party content on a sensitive topic
 * (credentials, guarantees, prices, ratings, availability, offers, cadence,
 * safety) is shown, never withheld, tagged with sensitiveTopics beside its
 * sourcePath: the author may quote it verbatim as the business's own words,
 * but a new sensitive claim in the author's voice still needs an exact
 * publicFact. Text rendered by third-party review widgets is never collected.
 */
export type FirstPartyContentInventory = {
  schemaVersion: 1;
  kind: "first-party-content-inventory";
  producer: typeof contentInventoryProducer;
  pagesRead: number;
  testimonials: Array<{
    quote: string;
    attribution?: string;
    sourcePath: string;
    routePath?: string;
    publicFactId?: string;
    sensitiveTopics?: SensitiveFirstPartyTopic[];
  }>;
  faqs: Array<{ question: string; answer: string; sourcePath: string; routePath?: string; sensitiveTopics?: SensitiveFirstPartyTopic[] }>;
  people: Array<{ name: string; role?: string; statement?: string; sourcePath: string; routePath?: string; sensitiveTopics?: SensitiveFirstPartyTopic[] }>;
  projects: Array<{
    title: string;
    summary?: string;
    servicesUsed?: string[];
    imageResourceIds?: string[];
    sourcePath: string;
    routePath?: string;
    sensitiveTopics?: SensitiveFirstPartyTopic[];
  }>;
  serviceLists: Array<{ lead: string; items: string[]; sourcePath: string; routePath?: string; sensitiveTopics?: SensitiveFirstPartyTopic[] }>;
  factReferences: Array<{ publicFactId: string; label: string; value: string }>;
  thirdPartyReviewSurfaces: string[];
  /** Where tagged sensitive-topic first-party content appears, by topic. */
  sensitiveTopicIndex: Array<{ topic: SensitiveFirstPartyTopic; sourcePaths: string[]; count: number }>;
  omitted?: Partial<Record<"testimonials" | "faqs" | "people" | "projects" | "serviceLists", number>>;
};

export const contentInventoryProducer = "first-party-content-inventory@1" as const;
export const contentInventoryPath = "src/content-inventory.ts" as const;

const limits = {
  testimonials: 24,
  faqs: 20,
  people: 10,
  projects: 20,
  serviceLists: 16,
  listItems: 12,
  quoteCharacters: 2_000,
  answerCharacters: 900,
  summaryCharacters: 300,
  topicPaths: 6
} as const;

type InventoryPage = {
  page: SourceSnapshotPage;
  path: string;
  lines: string[];
  headings: Set<string>;
};

export function createFirstPartyContentInventory(input: {
  pages: readonly SourceSnapshotPage[];
  publicFacts?: SitePublicBuildInput["publicFacts"];
  routeForSourcePath?: (sourcePath: string) => string | undefined;
  imagesForSourcePath?: (sourcePath: string) => string[];
}): FirstPartyContentInventory {
  const pages = inventoryPages(input.pages);
  const lineFrequency = new Map<string, number>();
  for (const entry of pages) {
    for (const line of new Set(entry.lines.map(normalizeLine))) lineFrequency.set(line, (lineFrequency.get(line) ?? 0) + 1);
  }
  const chromeThreshold = Math.max(3, Math.ceil(pages.length * 0.3));
  const isChrome = (line: string) => pages.length >= 3 && (lineFrequency.get(normalizeLine(line)) ?? 0) >= chromeThreshold;
  const route = (sourcePath: string) => {
    const routePath = input.routeForSourcePath?.(sourcePath);
    return routePath ? { routePath } : {};
  };
  const topicPaths = new Map<SensitiveFirstPartyTopic, Set<string>>();
  const topicCounts = new Map<SensitiveFirstPartyTopic, number>();
  // Tag, never withhold: returns the topics for the item and indexes them.
  const tag = (texts: Array<string | undefined>, sourcePath: string) => {
    const topics = [...new Set(texts.flatMap((text) => text ? sensitiveFirstPartyTopics(text) : []))];
    for (const topic of topics) {
      topicPaths.set(topic, (topicPaths.get(topic) ?? new Set()).add(sourcePath));
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
    return topics.length ? { sensitiveTopics: topics } : {};
  };
  const proofFacts = (input.publicFacts ?? []).flatMap((fact) => fact.kind === "proof" && typeof fact.value === "string"
    ? [{ id: fact.id, label: fact.label, value: fact.value }]
    : []);
  const thirdPartyReviewSurfaces = pages.filter((entry) => isThirdPartyReviewSurface(entry.lines)).map((entry) => entry.path);
  const thirdParty = new Set(thirdPartyReviewSurfaces);
  const omitted: NonNullable<FirstPartyContentInventory["omitted"]> = {};
  const capped = <T>(key: keyof typeof omitted, values: T[], limit: number) => {
    if (values.length > limit) omitted[key] = values.length - limit;
    return values.slice(0, limit);
  };

  const testimonials = extractTestimonials(pages.filter((entry) => !thirdParty.has(entry.path)), isChrome)
    .map((testimonial) => {
      const fact = proofFacts.find((candidate) => sameQuotation(candidate.value, testimonial.quote));
      // A customer's words are quoted exactly whatever they mention; sensitive
      // topics are tagged so the author never restates them as its own claim.
      return {
        quote: truncateAtSentence(testimonial.quote, limits.quoteCharacters),
        ...(testimonial.attribution ? { attribution: testimonial.attribution } : {}),
        sourcePath: testimonial.sourcePath,
        ...route(testimonial.sourcePath),
        ...(fact ? { publicFactId: fact.id } : {}),
        ...tag([testimonial.quote], testimonial.sourcePath)
      };
    });

  const faqs = extractFaqs(pages).map((faq) => ({
    ...faq,
    answer: truncateAtSentence(faq.answer, limits.answerCharacters),
    ...route(faq.sourcePath),
    ...tag([faq.question, faq.answer], faq.sourcePath)
  }));

  const people = extractPeople(pages, isChrome).map((person) => ({
    ...person,
    ...route(person.sourcePath),
    ...tag([person.statement], person.sourcePath)
  }));

  const projects = extractProjects(pages, isChrome).map((project) => {
    const imageResourceIds = input.imagesForSourcePath?.(project.sourcePath).slice(0, 4) ?? [];
    return {
      ...project,
      ...(imageResourceIds.length ? { imageResourceIds } : {}),
      sourcePath: project.sourcePath,
      ...route(project.sourcePath),
      ...tag([project.title, project.summary], project.sourcePath)
    };
  });

  const serviceLists = extractServiceLists(pages, isChrome).map((list) => ({
    ...list,
    ...route(list.sourcePath),
    ...tag([list.lead, ...list.items], list.sourcePath)
  }));

  const factReferences = proofFacts
    .filter((fact) => !testimonials.some((testimonial) => testimonial.publicFactId === fact.id))
    .map((fact) => ({ publicFactId: fact.id, label: fact.label, value: fact.value }));

  return {
    schemaVersion: 1,
    kind: "first-party-content-inventory",
    producer: contentInventoryProducer,
    pagesRead: pages.length,
    testimonials: capped("testimonials", testimonials, limits.testimonials),
    faqs: capped("faqs", faqs, limits.faqs),
    people: capped("people", people, limits.people),
    projects: capped("projects", projects, limits.projects),
    serviceLists: capped("serviceLists", serviceLists, limits.serviceLists),
    factReferences,
    thirdPartyReviewSurfaces,
    sensitiveTopicIndex: [...topicPaths].map(([topic, paths]) => ({
      topic,
      sourcePaths: [...paths].sort().slice(0, limits.topicPaths),
      count: topicCounts.get(topic) ?? paths.size
    })).sort((left, right) => left.topic.localeCompare(right.topic)),
    ...(Object.keys(omitted).length ? { omitted } : {})
  };
}

export function contentInventoryIsEmpty(inventory: FirstPartyContentInventory) {
  return !inventory.testimonials.length && !inventory.faqs.length && !inventory.people.length
    && !inventory.projects.length && !inventory.serviceLists.length && !inventory.factReferences.length;
}

export function contentInventoryModule(inventory: FirstPartyContentInventory) {
  return `/**
 * Read-only first-party content inventory. Verbatim excerpts of this business's
 * own pages, grouped by kind, each with its sourcePath and the approved
 * routePath that consolidates it. Source material, never render-time data:
 * do not import this module. Quote testimonials and FAQ answers exactly with
 * their attribution; paraphrase the rest into customer copy. A testimonial may
 * mention an emergency, safety, a guarantee, a license or a price: quote it
 * exactly as that customer's attributed words (a blockquote with its cite or
 * figcaption), never restate it as a claim in the business's voice.
 * Entries tagged sensitiveTopics state credentials, guarantees, prices,
 * ratings, availability, offers, cadence or safety in the business's own
 * published words: reuse such a sentence only verbatim. A new or reworded
 * sensitive claim in your own voice needs an exact publicFact
 * (factReferences names the ones that exist).
 */
export const contentInventory = ${JSON.stringify(inventory, null, 2)} as const;
`;
}

export function contentInventorySummary(inventory: FirstPartyContentInventory) {
  const parts = [
    [inventory.testimonials.length, "first-party testimonials"],
    [inventory.faqs.length, "FAQs"],
    [inventory.people.length, "named people"],
    [inventory.projects.length, "projects"],
    [inventory.serviceLists.length, "service lists"],
    [inventory.factReferences.length, "proof fact references"]
  ].filter(([count]) => Number(count) > 0).map(([count, label]) => `${count} ${label}`);
  return parts.join(", ");
}

function inventoryPages(pages: readonly SourceSnapshotPage[]): InventoryPage[] {
  const byPath = new Map<string, SourceSnapshotPage>();
  for (const page of pages) {
    if (page.outcome !== "fetched" || !page.extractedText.trim() || page.exactDuplicateOf) continue;
    const path = canonicalPath(page.path);
    const current = byPath.get(path);
    if (!current || page.wordCount > current.wordCount) byPath.set(path, page);
  }
  const seenText = new Set<string>();
  return [...byPath.entries()]
    .sort(([left], [right]) => pagePriority(left) - pagePriority(right) || left.localeCompare(right))
    .flatMap(([path, page]) => {
      if (isLegalSourcePagePath(page.path) || classifySourcePagePath(page.path) !== "customer_content") return [];
      if (/(?:^|\/)(?:site-?map|search|thank-you|cart|checkout|login|account)(?:\/|$)/i.test(path)) return [];
      if (seenText.has(page.textContentHash)) return [];
      seenText.add(page.textContentHash);
      return [{
        page,
        path: page.path,
        lines: splitLines(page.extractedText),
        headings: new Set(page.headings.map(normalizeLine))
      }];
    });
}

/** Proof, FAQ, about and project pages first so their copies win deduplication. */
function pagePriority(path: string) {
  if (/review|testimonial/i.test(path)) return 0;
  if (/faq|question/i.test(path)) return 1;
  if (/about|team|story|staff|people|who-we-are/i.test(path)) return 2;
  if (/project|portfolio|case-stud|our-work|gallery/i.test(path)) return 3;
  if (path === "/") return 4;
  if (/blog|article|post|news/i.test(path)) return 6;
  return 5;
}

function isProofPage(entry: InventoryPage) {
  return /\b(?:reviews?|testimonials?|customers? say|what (?:our )?customers|happy customers?|kind words)\b/i
    .test(`${entry.path.replace(/[-/]/g, " ")} ${entry.page.title ?? ""}`);
}

function isThirdPartyReviewSurface(lines: string[]) {
  const text = lines.join("\n");
  if (/\bbased on \d[\d,]* reviews\b/i.test(text)) return true;
  const timestamps = lines.filter((line) => /^\d{1,2}:\d{2}\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{2,4}$/.test(line)).length;
  const platformLines = lines.filter((line) => /^(?:on\s+)?(?:google|yelp|facebook|nextdoor|angi|homeadvisor|thumbtack)$/i.test(line)).length;
  return timestamps >= 2 || platformLines >= 2;
}

type ExtractedTestimonial = { quote: string; attribution?: string; sourcePath: string };

function extractTestimonials(pages: InventoryPage[], isChrome: (line: string) => boolean) {
  const results: ExtractedTestimonial[] = [];
  const accept = (candidate: ExtractedTestimonial, requireFirstPerson: boolean) => {
    const quote = candidate.quote.replace(/^[“"]+|[”"]+$/g, "").replace(/\s+/g, " ").trim();
    if (quote.length < 40 || quote.split(" ").length < 7 || isChrome(quote)) return;
    if (businessVoice(quote) || (requireFirstPerson && !firstPersonSingular(quote))) return;
    const identity = normalizeLine(quote);
    if (results.some((existing) => {
      const other = normalizeLine(existing.quote);
      return other.includes(identity) || identity.includes(other);
    })) return;
    results.push({ ...candidate, quote });
  };
  for (const entry of pages) {
    const proofPage = isProofPage(entry);
    const topicWords = reviewAttributionPageTopicWords({ title: entry.page.title, path: entry.path });
    // Inline cards collapsed into one line: "quote" - Name "quote" - Name
    for (const line of entry.lines) {
      for (const match of line.matchAll(inlineQuotationPattern)) {
        const attribution = match[2]?.trim().replace(/[,;]+$/, "");
        if (!attribution || !reviewAttribution(attribution.split(",")[0]!.trim(), topicWords)) continue;
        accept({ quote: match[1]!, attribution, sourcePath: entry.path }, !proofPage);
      }
    }
    // A prose run followed by a standalone attribution line. Off proof pages
    // the attribution must be a review card heading shaped like a reviewer
    // ("Ted L.", "DK") or the quote must be in a customer's first person.
    for (let index = 1; index < entry.lines.length; index += 1) {
      const attribution = entry.lines[index]!;
      const name = reviewAttribution(attribution, topicWords);
      if (!name || isChrome(attribution)) continue;
      const card = entry.headings.has(normalizeLine(attribution));
      if (!proofPage && !card) continue;
      const quote: string[] = [];
      for (let previous = index - 1; previous >= 0 && quote.length < (proofPage ? 4 : 1); previous -= 1) {
        const line = entry.lines[previous]!;
        if (reviewAttribution(line, topicWords) || line.length < 30 || /\?$/.test(line) || isChrome(line)) break;
        if (entry.headings.has(normalizeLine(line))) break;
        quote.unshift(line);
      }
      if (!quote.length) continue;
      accept({ quote: quote.join(" "), attribution: name, sourcePath: entry.path }, !proofPage && !reviewerShapedName(name));
    }
    // Visibly quoted standalone lines on proof pages.
    if (proofPage) {
      for (const line of entry.lines) {
        if (/^[“"][^”"]{30,}[”"]$/.test(line)) accept({ quote: line, sourcePath: entry.path }, false);
      }
    }
  }
  return results;
}

function firstPersonSingular(quote: string) {
  return /\b(?:I|I'm|I’m|I've|I’ve|I'd|I’d|my|me)\b/.test(quote);
}

/** The business's own copy speaks as "we" to "you" and never about "them". */
function businessVoice(quote: string) {
  return !firstPersonSingular(quote)
    && /\b(?:we|we'll|we’ll|we're|we’re|our)\b/i.test(quote)
    && !/\b(?:they|them|their|he|she|his|her|guys|company|crew)\b/i.test(quote);
}

/** Review-card names: first name plus initial, initials, or a dash prefix. */
function reviewerShapedName(value: string) {
  return /^(?:[A-Z][a-z'’]+\s+[A-Z]\.?|[A-Z]{2,3}|[A-Z]\.\s?[A-Z]\.?)$/.test(value.trim()) || /^[-–—~]/.test(value.trim());
}

const inlineQuotationPattern = /[“"]([^“”"]{30,1500}?)[”"]\s*[-–—~]\s*((?:(?:Dr|Mr|Mrs|Ms)\.?\s+)?[A-Z][a-z'’]*\.?(?:\s+(?:[A-Z][a-z'’]*\.?|&|and))*(?:,\s*[A-Z][^“”",]{0,28})*)/g;

/** The attribution line (with any role suffix) when it names a reviewer. */
function reviewAttribution(value: string, pageTopicWords: ReadonlySet<string>) {
  const text = value.replace(/^[\s\-–—~]+/, "").replace(/\s+/g, " ").trim();
  return reviewAttributionName(value, pageTopicWords) ? text : undefined;
}

function sameQuotation(factValue: string, quote: string) {
  const left = normalizeLine(factValue);
  const right = normalizeLine(quote);
  return left.length >= 20 && (left === right || right.includes(left) || left.includes(right));
}

function extractFaqs(pages: InventoryPage[]) {
  const results: Array<{ question: string; answer: string; sourcePath: string }> = [];
  const seen = new Set<string>();
  const accept = (question: string, answer: string, sourcePath: string) => {
    const q = question.replace(/^Q[:.]\s*/i, "").trim();
    const a = answer.replace(/^A[:.]\s*/i, "").replace(/\s+/g, " ").trim();
    if (q.length < 8 || q.length > 220 || a.length < 2) return;
    if (a.length < 40 && !/^(?:yes|no)\b/i.test(a)) return;
    const identity = normalizeLine(q);
    if (seen.has(identity)) return;
    seen.add(identity);
    results.push({ question: q, answer: a, sourcePath });
  };
  for (const entry of pages) {
    const faqPage = /\bfaq|questions?\b/i.test(`${entry.path.replace(/[-/]/g, " ")} ${entry.page.title ?? ""}`);
    for (const line of entry.lines) {
      if (!/\bQ[:.]\s*\S/.test(line) || !/\bA[:.]\s*\S/.test(line)) continue;
      for (const match of line.matchAll(/Q[:.]\s*(.+?)\s*A[:.]\s*(.+?)(?=Q[:.]\s|$)/g)) accept(match[1]!, match[2]!, entry.path);
    }
    let inZone = faqPage;
    for (let index = 0; index < entry.lines.length; index += 1) {
      const line = entry.lines[index]!;
      const heading = entry.headings.has(normalizeLine(line));
      if (/\b(?:frequently asked|faqs?\b|common questions|questions? (?:we get|and answers))/i.test(line) && line.length < 80) {
        inZone = true;
        continue;
      }
      if (!inZone) continue;
      if (heading && !line.endsWith("?") && results.some((faq) => faq.sourcePath === entry.path) && !faqPage) {
        inZone = false;
        continue;
      }
      if (!line.endsWith("?") || line.length > 220 || /^Q[:.]/.test(line) && /\bA[:.]/.test(line)) continue;
      const answer: string[] = [];
      for (let next = index + 1; next < entry.lines.length; next += 1) {
        const candidate = entry.lines[next]!;
        if (candidate.endsWith("?") && candidate.length <= 220) break;
        if (entry.headings.has(normalizeLine(candidate))) break;
        if (candidate.length < 25 && answer.length) break;
        answer.push(candidate);
        if (answer.join(" ").length > limits.answerCharacters) break;
      }
      if (answer.length) accept(line, answer.join(" "), entry.path);
    }
  }
  return results;
}

const roleWords = "owner|co-owner|founder|co-founder|president|vice president|ceo|operator|general manager|office manager|operations manager|project manager|manager|foreman|crew lead|lead technician|technician|master electrician|electrician|arborist|estimator|installer|plumber|designer|detailer"
  .split("|").map((role) => `[${role[0]!.toUpperCase()}${role[0]}]${role.slice(1)}`).join("|");
const personName = "[A-Z][a-z'’]+(?:\\s+(?:[A-Z]\\.|[A-Z][a-z'’]+|“[A-Z][a-z]+”|\"[A-Z][a-z]+\")){0,2}";
const rolePatterns = [
  new RegExp(`\\b(${personName})\\s*(?:[–—-]|,)\\s*(?:the\\s+|our\\s+)?((?:${roleWords})(?:\\s+(?:and|&)\\s+(?:${roleWords}))?)\\b`, "g"),
  new RegExp(`\\b((?:${roleWords})(?:\\s+(?:and|&)\\s+(?:${roleWords}))?),\\s+(${personName})\\b`, "g"),
  new RegExp(`\\b(${personName}),?\\s+(?:is|was)\\s+(?:the\\s+|our\\s+)?((?:${roleWords}))\\b`, "g")
];

function extractPeople(pages: InventoryPage[], isChrome: (line: string) => boolean) {
  const results: Array<{ name: string; role?: string; statement?: string; sourcePath: string }> = [];
  const seen = new Set<string>();
  for (const entry of pages) {
    if (/blog|article|post|news/i.test(entry.path) || isProofPage(entry)) continue;
    for (const line of entry.lines) {
      if (isChrome(line) || line.length > 1_200) continue;
      for (const sentence of sentences(line)) {
        // A team roster sentence: "Tracy leads a team ..., including Kayla, Lizann, and Yanet."
        const roster = /\b(?:team|crew|staff|employees)\b/i.test(sentence)
          ? sentence.match(/\b([A-Z][a-z'’]+(?:,\s*(?:and\s+|&\s+)?[A-Z][a-z'’]+){2,}(?:,?\s*(?:and|&)\s+[A-Z][a-z'’]+)?)/)?.[1]
          : undefined;
        const rosterNames = roster?.split(/,\s*|\s+(?:and|&)\s+/).map((name) => name.replace(/^(?:and|&)\s+/, "").trim()).filter(Boolean) ?? [];
        if (rosterNames.length >= 2 && rosterNames.every(plausiblePersonName) && sentence.length <= 400) {
          const identity = `roster:${normalizeLine(roster!)}`;
          if (!seen.has(identity)) {
            seen.add(identity);
            results.push({ name: rosterNames.join(", "), role: "team members", statement: sentence, sourcePath: entry.path });
          }
        }
        for (const [index, pattern] of rolePatterns.entries()) {
          for (const match of sentence.matchAll(pattern)) {
            const nameFirst = index !== 1;
            const name = (nameFirst ? match[1] : match[2])!.trim();
            const role = (nameFirst ? match[2] : match[1])!.trim().toLowerCase();
            if (!plausiblePersonName(name)) continue;
            const identity = normalizeLine(name).split(" ")[0]!;
            if (seen.has(identity)) continue;
            seen.add(identity);
            results.push({
              name,
              role,
              ...(sentence.length <= 400 && sentence.length > name.length + role.length + 12 ? { statement: sentence } : {}),
              sourcePath: entry.path
            });
          }
        }
      }
    }
  }
  return results;
}

function plausiblePersonName(name: string) {
  const first = name.split(/\s+/)[0]!.replace(/[“”"]/g, "");
  if (first.length < 2) return false;
  return !/^(?:The|Our|We|Your|This|That|Owner|Founder|President|Manager|Operator|Technician|Electrician|Arborist|Master|Lead|General|Office|Project|Operations|Contact|Call|Family|Local|Certified|Licensed|Professional|Home|About|Meet|Team|Service|Services|Company|Business|North|South|East|West|Central|Every|Each|All|Any|Both|Our|If|When|After|Before|With|From|For|And|But|Or|At|In|On|To|A|An|It|He|She|They|His|Her|Their|Finally|Also|However|Then|Next|First|Second|Lastly|Plus|Additionally|Today|Yes|No|Please|Thanks|Thank|Great|Good|Best|New|Free|Why|How|What|Who|Where)$/.test(first)
    && !/\b(?:LLC|Inc|Corp|Company|Co|Group|Service|Services|Solutions)\b/.test(name);
}

function extractProjects(
  pages: InventoryPage[],
  isChrome: (line: string) => boolean
) {
  const results: Array<{ title: string; summary?: string; servicesUsed?: string[]; sourcePath: string }> = [];
  const seen = new Set<string>();
  const add = (project: { title: string; summary?: string; servicesUsed?: string[]; sourcePath: string }) => {
    const identity = normalizeLine(project.title);
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    results.push(project);
  };
  const projectSummary = (candidates: string[]) => {
    const kept = candidates.flatMap((candidate) => sentences(candidate));
    const summary = truncateAtSentence(kept.join(" "), limits.summaryCharacters);
    return summary.length >= 30 ? summary : undefined;
  };
  for (const entry of pages) {
    const segments = entry.path.split("/").filter(Boolean);
    const projectFamily = /^(?:projects?|portfolio|case-stud(?:y|ies)|our-work|work|gallery|jobs?)$/i.test(segments[0] ?? "");
    if (!projectFamily && !/(?:^|-)(?:projects?|portfolio|case-stud(?:y|ies))(?:-|$)/i.test(segments.at(-1) ?? "")) continue;
    if (segments.length >= 2) {
      const title = (entry.page.headings.find((heading) => heading.length >= 6) ?? entry.page.title?.split(/\s+[|–—]\s+/)[0] ?? "").trim();
      if (!title) continue;
      const labeled = entry.lines.filter((line) => /^(?:background|challenge|solution|results?|the (?:job|project|work)|scope)\s*:/i.test(line));
      const prose = labeled.length
        ? labeled.filter((line) => /^(?:background|solution|scope|the (?:job|project|work))/i.test(line)).map((line) => line.replace(/^[^:]+:\s*/, ""))
        : entry.lines.filter((line) => line.length >= 60 && !isChrome(line)).slice(0, 2);
      const servicesIndex = entry.lines.findIndex((line) => /^services? (?:used|provided|performed)\s*:?$/i.test(line));
      const servicesUsed = servicesIndex >= 0
        ? entry.lines.slice(servicesIndex + 1).filter((line) => !/^no items found/i.test(line)).filter((_, offset, following) => following.slice(0, offset + 1).every((line) => line.length <= 48 && !/:$/.test(line) && !/used:?$/i.test(line))).slice(0, 8)
        : [];
      const summary = projectSummary(prose.map((line) => line.startsWith(title) ? line.slice(title.length).trim() : line));
      add({ title, ...(summary ? { summary } : {}), ...(servicesUsed.length ? { servicesUsed } : {}), sourcePath: entry.path });
      continue;
    }
    // A project hub: each distinctive heading followed by its description.
    const firstHeading = normalizeLine(entry.page.headings[0] ?? "");
    for (let index = 0; index < entry.lines.length - 1; index += 1) {
      const line = entry.lines[index]!;
      const normalized = normalizeLine(line);
      if (!entry.headings.has(normalized) || normalized === firstHeading || isChrome(line)) continue;
      if (/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i.test(line)) continue;
      if (line.length < 8 || line.length > 90 || /\?$/.test(line) || /\b(?:cookie|contact|estimate|videos?|schedule|what are|what does)\b/i.test(line)) continue;
      const next = entry.lines[index + 1]!;
      if (next.length < 60 || entry.headings.has(normalizeLine(next)) || isChrome(next)) continue;
      const summary = projectSummary([next]);
      if (summary) add({ title: line, summary, sourcePath: entry.path });
    }
  }
  return results;
}

function extractServiceLists(
  pages: InventoryPage[],
  isChrome: (line: string) => boolean
) {
  const results: Array<{ lead: string; items: string[]; sourcePath: string }> = [];
  const seen = new Set<string>();
  for (const entry of pages) {
    if (/blog|article|post|news|project|portfolio|gallery/i.test(entry.path) || isProofPage(entry)) continue;
    let index = 0;
    while (index < entry.lines.length) {
      const lead = entry.lines[index]!;
      const leadIsHeading = entry.headings.has(normalizeLine(lead)) || /:$/.test(lead);
      if (!leadIsHeading || isChrome(lead) || lead.length > 120 || /\b(?:saying|reviews?|testimonials?)\b/i.test(lead)) {
        index += 1;
        continue;
      }
      const items: string[] = [];
      let next = index + 1;
      while (next < entry.lines.length) {
        const item = entry.lines[next]!;
        if (/^\d+(?:\.\d+)?$/.test(item)) break;
        if (item.length < 3 || item.length > 120 || isChrome(item) || entry.headings.has(normalizeLine(item)) || /\?$/.test(item)) break;
        if (item.length > 70 && !/[;,]$/.test(item) && !/^[a-z]/.test(item)) break;
        items.push(item);
        next += 1;
      }
      const contactList = [lead, ...items].some((item) => /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|@|\b(?:e-?mail|message us|call (?:or|us)|phone)\b/i.test(item));
      if (items.length >= 3 && !contactList) {
        const identity = normalizeLine(items.join(" "));
        if (!seen.has(identity)) {
          seen.add(identity);
          results.push({ lead, items: items.slice(0, limits.listItems), sourcePath: entry.path });
        }
        index = next;
      } else index += 1;
    }
  }
  return results;
}

function splitLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function sentences(line: string) {
  return line.match(/[^.!?]+(?:[.!?]+["”’)]?|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [line];
}

function truncateAtSentence(value: string, maxCharacters: number) {
  if (value.length <= maxCharacters) return value;
  const bounded = value.slice(0, maxCharacters);
  const stop = Math.max(bounded.lastIndexOf(". "), bounded.lastIndexOf("! "), bounded.lastIndexOf("? "));
  return stop >= maxCharacters * 0.5 ? `${bounded.slice(0, stop + 1)} […]` : `${bounded.slice(0, bounded.lastIndexOf(" "))} […]`;
}

function normalizeLine(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalPath(value: string) {
  const pathname = value.split(/[?#]/, 1)[0] || "/";
  const normalized = `/${pathname.trim().replace(/^\/+|\/+$/g, "")}`.replace(/\.html?$/i, "").replace(/\/index$/i, "/");
  return normalized === "/" || normalized === "" ? "/" : normalized.replace(/\/$/, "");
}
