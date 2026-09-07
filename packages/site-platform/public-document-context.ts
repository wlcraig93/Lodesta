import { Parser } from "htmlparser2";

/** Bind serving identity only after verifying immutable artifact bytes.
 * The finalizer precedes version creation, so this metadata cannot live in the
 * stored artifact. Only the opening root tag changes; authored content does not.
 */
export function bindPublishedDocumentContext(html: string, context: { siteId: string; versionId: string }) {
  const roots: Array<{ start: number; end: number; attributes: Record<string, string> }> = [];
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "html") roots.push({ start: parser.startIndex, end: parser.endIndex + 1, attributes });
    }
  });
  parser.end(html);
  const root = roots[0];
  if (roots.length !== 1 || root.attributes["data-lodesta-site-id"] !== context.siteId) {
    throw new Error("published_document_context_invalid");
  }
  const attributes = { ...root.attributes, "data-lodesta-version-id": context.versionId };
  const opening = `<html${Object.entries(attributes).map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("")}>`;
  return html.slice(0, root.start) + opening + html.slice(root.end);
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
