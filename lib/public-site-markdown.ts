import type { ClaimRecord, SectionInstanceV3, SiteBundle } from "./models";
import { configuredAppOrigin } from "./app-origin";
import { getPublishedVersion } from "./sample-data";
import { isIndexableSite } from "./site-publication";
import { canonicalUrlForPage } from "./public-site-seo";
import { isCustomDomainRequest, requestOrigin, type HeaderReader } from "./host-routing";
import { withBusinessBundleFields } from "./business-model";
import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";
import { assertPublicSiteVersionV3, type PageV3 } from "./site-version-v3";

export function siteLlmsTxt(bundle: SiteBundle, claims: ClaimRecord[], headers: HeaderReader) {
  if (!isIndexableSite(bundle, claims)) return null;
  const version = assertPublicSiteVersionV3(getPublishedVersion(bundle.siteModel), "published llms version");
  const lines = [
    `# ${markdownText(bundle.businessProfile.name)}`,
    "",
    oneLine(bundle.businessProfile.description) || `${bundle.businessProfile.name} is a local business website managed by Lodesta.`,
    "",
    "## Core Pages",
    ...version.pageComposition.pages.map(
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

export function markdownForPage(bundle: SiteBundle, page: PageV3, headers: HeaderReader) {
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
    ...page.sections.flatMap(v3SectionMarkdown)
  ];
  return `${lines.filter((line): line is string => line !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function markdownUrlForPage(bundle: SiteBundle, page: PageV3, headers: HeaderReader) {
  const suffix = normalizePathSuffix(page.slug);
  if (isCustomDomainRequest(headers)) return `${requestOrigin(headers)}/md${suffix}`;

  const baseUrl = configuredAppOrigin() ?? requestOrigin(headers).replace(/\/$/, "");
  return `${baseUrl}/sites/${bundle.siteModel.slug}/md${suffix}`;
}

export function markdownCanonicalLinkHeader(bundle: SiteBundle, page: PageV3, headers: HeaderReader) {
  return `<${canonicalUrlForPage(bundle, page, headers)}>; rel="canonical"; type="text/html"`;
}

function businessFactLines(bundle: SiteBundle) {
  const normalizedBundle = withBusinessBundleFields(bundle);
  const business = normalizedBundle.businessProfile;
  const locationLines = locationFactLines(normalizedBundle);
  const serviceAreas = serviceAreasForBundle(normalizedBundle);
  return [
    `- Category: ${markdownText(business.categories[0] ?? business.vertical)}`,
    business.phone ? `- Phone: ${markdownText(business.phone)}` : undefined,
    business.email ? `- Email: ${markdownText(business.email)}` : undefined,
    ...locationLines,
    serviceAreas.length ? `- Service areas: ${serviceAreas.map(markdownText).join(", ")}` : undefined,
    business.services.length ? `- Services: ${business.services.map(markdownText).join(", ")}` : undefined
  ].filter((line): line is string => Boolean(line));
}

function v3SectionMarkdown(section: SectionInstanceV3) {
  const visual = getVisualSectionV3(section.props);
  if (!visual) return [];
  const slots = visual.slots as Record<string, unknown>;
  const heading =
    copyHeading(slots.copy) ||
    copyHeading(slots.intro) ||
    actionTitle(slots.action) ||
    visual.templateId.replace(/_/g, " ");
  const body = copyBody(slots.copy) || copyBody(slots.intro) || actionBody(slots.action);
  const lines = [
    `## ${markdownText(heading)}`,
    body ? markdownText(body) : undefined,
    ...slotFacts(slots.facts),
    ...slotFacts(slots.contact),
    ...slotItems(slots.items),
    ...slotLocations(slots.locations),
    ...slotAction(slots.action),
    ...slotMedia(slots.media)
  ];
  return lines.filter((line): line is string => Boolean(line));
}

function copyHeading(value: unknown) {
  return isRecord(value) ? stringProp(value.heading) || stringProp(value.title) : "";
}

function copyBody(value: unknown) {
  return isRecord(value) ? stringProp(value.body) : "";
}

function actionTitle(value: unknown) {
  return isRecord(value) ? stringProp(value.title) : "";
}

function actionBody(value: unknown) {
  return isRecord(value) ? stringProp(value.body) : "";
}

function slotFacts(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.facts ?? value.items)) return [];
  const facts = (value.facts ?? value.items) as unknown[];
  return facts.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = stringProp(item.label);
    const factValue = stringProp(item.value);
    if (!label && !factValue) return [];
    return [`- ${markdownText(label || factValue)}${label && factValue ? `: ${markdownText(factValue)}` : ""}`];
  });
}

function slotItems(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items.flatMap((item) => {
    if (typeof item === "string") return [`- ${markdownText(item)}`];
    if (!isRecord(item)) return [];
    const question = stringProp(item.question);
    const answer = stringProp(item.answer);
    if (question || answer) return [`### ${markdownText(question || "Question")}`, answer ? markdownText(answer) : ""].filter(Boolean);
    const quote = stringProp(item.quote);
    if (quote) {
      const attribution = stringProp(item.attribution) || stringProp(item.author);
      return [`- "${markdownText(quote)}"${attribution ? ` - ${markdownText(attribution)}` : ""}`];
    }
    const title = stringProp(item.title) || stringProp(item.label);
    const body = stringProp(item.body) || stringProp(item.description) || stringProp(item.meta);
    if (!title && !body) return [];
    return [`- ${markdownText(title || body)}${title && body ? `: ${markdownText(body)}` : ""}`];
  });
}

function slotLocations(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.locations)) return [];
  return value.locations.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = stringProp(item.label);
    const address = [stringProp(item.addressLine), stringProp(item.localityLine)].filter(Boolean).join(", ");
    if (!label && !address) return [];
    return [`- ${markdownText(label || address)}${label && address ? `: ${markdownText(address)}` : ""}`];
  });
}

function slotAction(value: unknown) {
  if (!isRecord(value)) return [];
  const cta = value.cta;
  if (!isRecord(cta)) return [];
  const label = stringProp(cta.label);
  const href = stringProp(cta.href);
  return label ? [`- ${markdownText(label)}${href ? `: ${markdownText(href)}` : ""}`] : [];
}

function slotMedia(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const caption = stringProp(item.publicCaption);
    return caption ? [`- ${markdownText(caption)}`] : [];
  });
}

function locationFactLines(bundle: SiteBundle) {
  const locations = bundle.locations ?? [];
  if (locations.length > 1) {
    return [
      `- Locations: ${locations
        .map((location) => [location.label ? markdownText(location.label) : undefined, addressLine(location.address)].filter(Boolean).join(" - "))
        .filter(Boolean)
        .join("; ")}`
    ];
  }
  const address = locations[0]?.address ?? bundle.businessProfile.address;
  const line = addressLine(address);
  return line ? [`- Address: ${line}`] : [];
}

function serviceAreasForBundle(bundle: SiteBundle) {
  const areas = new Set<string>(bundle.businessProfile.serviceAreas);
  for (const location of bundle.locations ?? []) {
    for (const area of location.serviceAreas) areas.add(area);
  }
  return [...areas];
}

function addressLine(address: SiteBundle["businessProfile"]["address"] | undefined) {
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
