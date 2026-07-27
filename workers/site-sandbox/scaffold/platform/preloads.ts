// React 19 injects image preload links into static markup. The platform owns
// document metadata, so only toolchain-generated asset image preloads are
// removed from body HTML. Attribute order and optional React hints do not
// affect the decision.
export function removeReactImagePreloads(value: string) {
  return value.replace(/<link\b[^>]*>/gi, (tag) => {
    const attributes = parseHtmlAttributes(tag);
    return attributes.get("rel")?.toLowerCase() === "preload"
      && attributes.get("as")?.toLowerCase() === "image"
      && /^asset:\/\/[a-zA-Z0-9_.:-]+$/.test(attributes.get("href") ?? "")
      ? ""
      : tag;
  });
}

function parseHtmlAttributes(tag: string) {
  const attributes = new Map<string, string>();
  const source = tag.replace(/^<link\b/i, "").replace(/\/?\s*>$/, "");
  const matcher = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(matcher)) {
    attributes.set(match[1].toLowerCase(), decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attributes;
}

function decodeHtmlAttribute(value: string) {
  const named: Record<string, string> = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? match;
  });
}
