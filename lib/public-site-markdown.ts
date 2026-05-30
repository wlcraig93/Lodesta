import type { ClaimRecord, PageModel, SectionModel, SiteBundle } from "./models";
import { getPublishedVersion } from "./sample-data";
import { isIndexableSite } from "./site-publication";
import { canonicalUrlForPage } from "./public-site-seo";
import { isCustomDomainRequest, requestOrigin, type HeaderReader } from "./host-routing";

export function siteLlmsTxt(bundle: SiteBundle, claims: ClaimRecord[], headers: HeaderReader) {
  if (!isIndexableSite(bundle, claims)) return null;
  const version = getPublishedVersion(bundle.siteModel);
  const lines = [
    `# ${markdownText(bundle.businessProfile.name)}`,
    "",
    oneLine(bundle.businessProfile.description) || `${bundle.businessProfile.name} is a local business website managed by Lodesta.`,
    "",
    "## Core Pages",
    ...version.pages.map(
      (page) =>
        `- [${markdownText(page.title)}](${canonicalUrlForPage(bundle, page, headers)}) - [Markdown](${markdownUrlForPage(bundle, page, headers)})`
    ),
    "",
    "## Business Facts",
    ...businessFactLines(bundle),
    "",
    "This file lists public, owner-verified website pages. It is provided for agent-readable navigation, not as a ranking or indexing claim."
  ];
  return `${lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n")}\n`;
}

export function markdownForPage(bundle: SiteBundle, page: PageModel, headers: HeaderReader) {
  const lines = [
    `# ${markdownText(page.title || bundle.businessProfile.name)}`,
    "",
    page.seo.description ? markdownText(page.seo.description) : undefined,
    "",
    `Canonical: ${canonicalUrlForPage(bundle, page, headers)}`,
    "",
    "## Business",
    ...businessFactLines(bundle),
    "",
    ...page.sections.flatMap(sectionMarkdown)
  ];
  return `${lines.filter((line): line is string => line !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function markdownUrlForPage(bundle: SiteBundle, page: PageModel, headers: HeaderReader) {
  const suffix = normalizePathSuffix(page.slug);
  if (isCustomDomainRequest(headers)) return `${requestOrigin(headers)}/md${suffix}`;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? requestOrigin(headers).replace(/\/$/, "");
  return `${baseUrl}/sites/${bundle.siteModel.slug}/md${suffix}`;
}

export function markdownCanonicalLinkHeader(bundle: SiteBundle, page: PageModel, headers: HeaderReader) {
  return `<${canonicalUrlForPage(bundle, page, headers)}>; rel="canonical"; type="text/html"`;
}

function businessFactLines(bundle: SiteBundle) {
  const business = bundle.businessProfile;
  return [
    `- Category: ${markdownText(business.categories[0] ?? business.vertical)}`,
    business.phone ? `- Phone: ${markdownText(business.phone)}` : undefined,
    business.email ? `- Email: ${markdownText(business.email)}` : undefined,
    addressLine(bundle) ? `- Address: ${addressLine(bundle)}` : undefined,
    business.serviceAreas.length ? `- Service areas: ${business.serviceAreas.map(markdownText).join(", ")}` : undefined,
    business.services.length ? `- Services: ${business.services.map(markdownText).join(", ")}` : undefined
  ].filter((line): line is string => Boolean(line));
}

function sectionMarkdown(section: SectionModel) {
  const heading = stringProp(section.props.heading) || section.type.replace(/_/g, " ");
  const body = stringProp(section.props.body);
  const lines = [`## ${markdownText(heading)}`, body ? markdownText(body) : undefined, ...sectionItems(section)];
  return lines.filter((line): line is string => Boolean(line));
}

function sectionItems(section: SectionModel) {
  const items = Array.isArray(section.props.items) ? section.props.items : [];
  if (section.type === "faq") {
    return items.flatMap((item) => {
      if (!isRecord(item)) return [];
      const question = stringProp(item.question);
      const answer = stringProp(item.answer);
      if (!question && !answer) return [];
      return [`### ${markdownText(question || "Question")}`, answer ? markdownText(answer) : ""];
    });
  }
  return items.flatMap((item) => {
    if (typeof item === "string") return [`- ${markdownText(item)}`];
    if (!isRecord(item)) return [];
    const title = stringProp(item.title) || stringProp(item.label) || stringProp(item.author) || stringProp(item.question);
    const description = stringProp(item.description) || stringProp(item.body) || stringProp(item.quote) || stringProp(item.answer);
    if (!title && !description) return [];
    return [`- ${markdownText(title || description || "")}${title && description ? `: ${markdownText(description)}` : ""}`];
  });
}

function addressLine(bundle: SiteBundle) {
  const address = bundle.businessProfile.address;
  if (!address) return undefined;
  return [address.street, address.city, address.region, address.postalCode, address.country]
    .filter(Boolean)
    .map((part) => markdownText(String(part)))
    .join(", ");
}

function normalizePathSuffix(slug: string) {
  const cleaned = slug.trim().replace(/^\/+|\/+$/g, "");
  return cleaned ? `/${cleaned}` : "";
}

function markdownText(value: string) {
  return oneLine(value)
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function oneLine(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function stringProp(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
