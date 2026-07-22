import { DomUtils, parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "@/packages/site-artifacts";
import { sitePlatformRepository } from "@/packages/platform-data";
import type { AgentAccessPolicyV1 } from "@/packages/site-contracts";
import botMappings from "./agent-bot-mappings.json";

export async function loadPublishedSiteContext(slug: string) {
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site?.publishedVersionId || site.status !== "active") return undefined;
  const version = await sitePlatformRepository.getSiteVersion(site.publishedVersionId);
  if (!version || version.status !== "published") return undefined;
  const [artifact, input, intent] = await Promise.all([
    sitePlatformRepository.getBuildArtifact(version.artifactId),
    sitePlatformRepository.getPublicBuildInput(version.publicBuildInputId),
    sitePlatformRepository.getSiteIntent(site.id)
  ]);
  if (!artifact || !input || !intent || artifact.qa.hardGate !== "passed" || artifact.artifactHash !== version.artifactHash) return undefined;
  return { site, version, artifact, input, intent };
}

export function llmsTextForSite(input: Awaited<ReturnType<typeof loadPublishedSiteContext>> extends infer T ? NonNullable<T> : never, origin: string, customDomain = false) {
  const base = customDomain ? origin : `${origin}/sites/${encodeURIComponent(input.site.slug)}`;
  const lines = [
    `# ${input.input.business.name}`,
    input.input.business.description ? `\n> ${input.input.business.description}` : "",
    `\nWebsite: ${base}`,
    input.input.business.contacts.phone ? `Phone: ${input.input.business.contacts.phone}` : "",
    input.input.business.contacts.email ? `Email: ${input.input.business.contacts.email}` : "",
    "\n## Services",
    ...input.input.business.offerings.map((offering) => `- ${offering.name}`),
    "\n## Pages",
    ...input.artifact.routes.map((route) => `- [${route.title}](${markdownUrl(base, route.path)}): ${route.description}`)
  ];
  return `${lines.filter(Boolean).join("\n")}\n`;
}

export function robotsTextForSite(policy: AgentAccessPolicyV1, sitemapUrl: string) {
  const contentSignal = `search=${policy.search === "allow" ? "yes" : "no"}, ai-input=${policy.aiInput === "allow" ? "yes" : "no"}, ai-train=${policy.aiTrain === "allow" ? "yes" : "no"}`;
  const disallowed = new Set([
    ...(policy.search === "disallow" ? ["search"] : []),
    ...(policy.aiInput === "disallow" ? ["ai_input"] : []),
    ...(policy.aiTrain === "disallow" ? ["ai_train"] : [])
  ]);
  const blockedGroups = botMappings.bots
    .filter((bot) => bot.categories.some((category) => disallowed.has(category)))
    .map((bot) => `User-agent: ${bot.userAgent}\nContent-Signal: ${contentSignal}\nDisallow: /`);
  return [
    `# Agent bot mappings: ${botMappings.version}`,
    ...blockedGroups,
    `User-agent: *\nContent-Signal: ${contentSignal}\nAllow: /\nSitemap: ${sitemapUrl}`
  ].join("\n\n") + "\n";
}

export function requestAcceptsMarkdown(request: Request) {
  return (request.headers.get("accept") ?? "").split(",").some((entry) => {
    const [mediaType, ...parameters] = entry.trim().toLowerCase().split(";");
    if (mediaType !== "text/markdown") return false;
    const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
    if (!qualityParameter) return true;
    const quality = qualityParameter.slice(qualityParameter.indexOf("=") + 1).trim();
    if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(quality)) return false;
    return Number(quality) > 0;
  });
}

export async function markdownForArtifactRoute(input: NonNullable<Awaited<ReturnType<typeof loadPublishedSiteContext>>>, routePath: string) {
  const route = input.artifact.routes.find((candidate) => candidate.path === normalizeRoute(routePath));
  if (!route) return undefined;
  const blob = await readVerifiedArtifactFile({ artifact: input.artifact, path: route.htmlFile, store: configuredArtifactBlobStore() });
  if (!blob) return undefined;
  return { route, markdown: markdownFromVerifiedHtml(blob.bytes.toString("utf8")) };
}

export function markdownFromVerifiedHtml(html: string) {
  const document = parseDocument(html, { decodeEntities: true });
  const body = DomUtils.findOne((node) => node.type === "tag" && node.name === "body", document.children, true);
  const content = body?.type === "tag" ? markdownNodes(body.children) : markdownNodes(document.children);
  const normalized = content.replace(/\n{3,}/g, "\n\n").trim();
  return normalized ? `${normalized}\n` : "";
}

function markdownNodes(nodes: AnyNode[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return node.data.replace(/\s+/g, " ");
    if (node.type !== "tag") return "";
    const element = node as Element;
    if (["script", "style", "template", "svg"].includes(element.name)
      || element.attribs.hidden !== undefined
      || element.attribs["aria-hidden"] === "true") return "";
    const inner = markdownNodes(element.children).trim();
    if (element.name === "img") {
      const src = element.attribs.src;
      const alt = element.attribs.alt?.trim() ?? "";
      return src ? `![${alt}](${src})` : alt;
    }
    if (!inner) return "";
    if (/^h[1-6]$/.test(element.name)) return `\n\n${"#".repeat(Number(element.name[1]))} ${inner}\n\n`;
    if (element.name === "p" || element.name === "address" || element.name === "blockquote") return `\n\n${inner}\n\n`;
    if (element.name === "li") return `\n- ${inner}`;
    if (element.name === "br") return "\n";
    if (element.name === "a") {
      const href = element.attribs.href;
      return href && !href.startsWith("javascript:") ? `[${inner}](${href})` : inner;
    }
    return inner;
  }).join("");
}

function normalizeRoute(value: string) {
  const clean = value.replace(/^\/+|\/+$/g, "");
  return clean ? `/${clean}` : "/";
}

function markdownUrl(base: string, routePath: string) {
  return routePath === "/" ? `${base}/index.md` : `${base}${routePath}/index.md`;
}
