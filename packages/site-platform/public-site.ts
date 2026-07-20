import { DomUtils, parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import { configuredArtifactBlobStore, readVerifiedArtifactFile } from "@/packages/site-artifacts";
import { sitePlatformRepository } from "@/packages/platform-data";

export async function loadPublishedSiteContext(slug: string) {
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site?.publishedVersionId || site.status !== "active") return undefined;
  const version = await sitePlatformRepository.getSiteVersion(site.publishedVersionId);
  if (!version || version.status !== "published") return undefined;
  const [artifact, input] = await Promise.all([
    sitePlatformRepository.getBuildArtifact(version.artifactId),
    sitePlatformRepository.getPublicBuildInput(version.publicBuildInputId)
  ]);
  if (!artifact || !input || artifact.qa.hardGate !== "passed" || artifact.artifactHash !== version.artifactHash) return undefined;
  return { site, version, artifact, input };
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
    ...input.artifact.routes.map((route) => `- [${route.title}](${base}${route.path === "/" ? "" : route.path}): ${route.description}`)
  ];
  return `${lines.filter(Boolean).join("\n")}\n`;
}

export async function markdownForArtifactRoute(input: NonNullable<Awaited<ReturnType<typeof loadPublishedSiteContext>>>, routePath: string) {
  const route = input.artifact.routes.find((candidate) => candidate.path === normalizeRoute(routePath));
  if (!route) return undefined;
  const blob = await readVerifiedArtifactFile({ artifact: input.artifact, path: route.htmlFile, store: configuredArtifactBlobStore() });
  if (!blob) return undefined;
  return { route, markdown: documentToMarkdown(blob.bytes.toString("utf8"), route.title, route.description) };
}

function documentToMarkdown(html: string, title: string, description: string) {
  const document = parseDocument(html, { decodeEntities: true });
  const body = DomUtils.findOne((node) => node.type === "tag" && node.name === "body", document.children, true);
  const content = body?.type === "tag" ? markdownNodes(body.children) : markdownNodes(document.children);
  const normalized = content.replace(/\n{3,}/g, "\n\n").trim();
  return `# ${title}\n\n${description}${normalized ? `\n\n${normalized}` : ""}\n`;
}

function markdownNodes(nodes: AnyNode[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return node.data.replace(/\s+/g, " ");
    if (node.type !== "tag") return "";
    const element = node as Element;
    const inner = markdownNodes(element.children).trim();
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
