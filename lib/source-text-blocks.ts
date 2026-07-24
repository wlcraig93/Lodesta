import { createHash } from "node:crypto";
import { DomUtils, parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";

export type SourceTextBlock = {
  id: string;
  sourceUrl: string;
  sourcePageHash: string;
  containerId: string;
  order: number;
  displayText: string;
};

export function canonicalSourceTokens(value: string) {
  return [...value.normalize("NFKC").toLocaleLowerCase("en-US").matchAll(/[\p{L}\p{N}]+/gu)]
    .map((match) => ({ value: match[0] }));
}

const semanticBlockTags = new Set([
  "address",
  "blockquote",
  "dd",
  "div",
  "dt",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "td",
  "th"
]);
const ignoredTags = new Set(["footer", "head", "nav", "noscript", "script", "style", "svg", "template"]);
const maxBlocksPerPage = 600;
const maxBlockCharacters = 4_000;

export function extractSourceTextBlocks(html: string, sourceUrl: string): SourceTextBlock[] {
  const sourcePageHash = hash(html);
  const document = parseDocument(html, { decodeEntities: true });
  const candidates: Element[] = [];

  visit(document.children, false, (element) => {
    if (!semanticBlockTags.has(element.name)) return;
    if (hasSemanticBlockDescendant(element)) return;
    candidates.push(element);
  });

  return candidates
    .map((element) => ({ element, displayText: normalizeDisplayText(DomUtils.textContent(element)) }))
    .filter((entry) => entry.displayText.length > 0)
    .filter((entry) => entry.displayText.length <= maxBlockCharacters)
    .slice(0, maxBlocksPerPage)
    .map(({ element, displayText }, order) => {
      const containerId = elementPath(element);
      return {
        id: `source_block_${hash(`${sourceUrl}\n${containerId}\n${displayText}`)}`,
        sourceUrl,
        sourcePageHash,
        containerId,
        order,
        displayText
      };
    });
}

function visit(nodes: AnyNode[], insideIgnoredElement: boolean, collect: (element: Element) => void) {
  for (const node of nodes) {
    if (node.type !== "tag") continue;
    const ignored = insideIgnoredElement || ignoredTags.has(node.name);
    if (ignored) continue;
    collect(node);
    visit(node.children, false, collect);
  }
}

function hasSemanticBlockDescendant(element: Element) {
  const stack = [...element.children];
  while (stack.length) {
    const node = stack.shift();
    if (!node || node.type === "text") continue;
    if (node.type === "tag") {
      if (semanticBlockTags.has(node.name)) return true;
      stack.push(...node.children);
    }
  }
  return false;
}

function elementPath(element: Element) {
  const segments: string[] = [];
  let current: Element | undefined = element;
  while (current) {
    const id = current.attribs?.id?.trim();
    if (id) {
      segments.unshift(`${current.name}#${id}`);
      break;
    }
    const siblings = current.parent?.children.filter(
      (node): node is Element => node.type === "tag" && node.name === current?.name
    );
    const index = Math.max(0, siblings?.indexOf(current) ?? 0) + 1;
    segments.unshift(`${current.name}:nth-of-type(${index})`);
    current = current.parent?.type === "tag" ? current.parent : undefined;
  }
  return segments.join(" > ");
}

function normalizeDisplayText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
