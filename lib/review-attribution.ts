/**
 * The one canonical test for whether a short line is a customer-review
 * attribution ("Ted L.", "Dr. Maria Lopez", "— Dana R., Realtor"). It is
 * vertical-neutral: it rejects navigation/UI labels, business-entity words and
 * review-platform names, plus any word the surrounding page itself uses as its
 * topic (its title and path), so a service title such as "Tree Removal" on a
 * tree-removal page is never mistaken for a reviewer. It never encodes a trade,
 * city or state vocabulary.
 */
const personNamePattern = /^(?:(?:Dr|Mr|Mrs|Ms)\.?\s+)?[A-Z][a-zA-Z'’-]*\.?(?:\s+(?:[A-Z][a-zA-Z'’-]*\.?|&|and)){0,3}$/;
const interfaceLabelPattern = /^(?:testimonials?|reviews?|read more|more|home|contact(?: us)?|about(?: us)?|call(?: now)?|submit|send|learn more|leave a review|write a review|customer reviews?|our reviews?|happy customers?|services?|faq|search|menu|close|next|previous|back)$/i;
const nonPersonWordPattern = /\b(?:services?|company|llc|inc|corp|co|group|team|solutions|google|yelp|facebook|reviews?|testimonials?|estimates?|contact|cookie|policy|package|gallery|projects?|portfolio)\b/i;

/** Topic words (four letters or longer) from a page's title and path. */
export function reviewAttributionPageTopicWords(input: { title?: string; path?: string }) {
  const text = `${input.title ?? ""} ${(input.path ?? "").replace(/[-_/]+/g, " ")}`.toLowerCase();
  return new Set(text.match(/[a-z]{4,}/g) ?? []);
}

export function reviewAttributionName(value: string, pageTopicWords: ReadonlySet<string> = new Set()) {
  const text = value.replace(/^[\s\-–—~]+/, "").replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 60) return undefined;
  const name = text.split(/\s*[,|–—]\s*|\s+-\s+/, 1)[0] ?? "";
  if (!personNamePattern.test(name)) return undefined;
  // One long capitalized word is a label or brand, not a name, unless dashed.
  if (name.split(/\s+/).length === 1 && !/^[-–—~]/.test(value.trim()) && name.length > 12) return undefined;
  if (interfaceLabelPattern.test(name) || nonPersonWordPattern.test(name)) return undefined;
  const words = name.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  if (words.some((word) => pageTopicWords.has(word))) return undefined;
  return name;
}
