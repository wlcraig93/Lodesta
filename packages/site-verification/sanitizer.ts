import { DomUtils, parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import type { AssetRevisionRef } from "@/packages/site-contracts";
import { normalizeRoutePath, type ArtifactGateFinding } from "./contracts";

const htmlTags = new Set([
  "a", "address", "article", "aside", "b", "blockquote", "br", "button", "cite", "code", "dd", "details", "div", "dl", "dt",
  "em", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img",
  "input", "label", "legend", "li", "main", "nav", "ol", "option", "p", "picture", "section", "select", "small", "source", "span",
  "strong", "summary", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "time", "tr", "ul"
]);
const svgTags = new Set(["svg", "path", "circle", "line", "polyline", "polygon", "rect", "g"]);
const commonAttributes = new Set([
  "alt", "aria-atomic", "aria-controls", "aria-current", "aria-describedby", "aria-expanded", "aria-hidden", "aria-label", "aria-labelledby",
  "aria-live", "aria-pressed", "aria-selected", "autocomplete", "checked", "class", "cols", "colspan", "decoding", "disabled", "for", "height",
  "fetchpriority", "href", "id", "loading", "max", "maxlength", "min", "minlength", "name", "open", "placeholder", "rel", "required", "role", "rows", "rowspan",
  "selected", "src", "target", "title", "type", "value", "width"
]);
const svgAttributes = new Set([
  "aria-hidden", "class", "cx", "cy", "d", "fill", "height", "points", "r", "role", "rx", "ry", "stroke", "stroke-linecap",
  "stroke-linejoin", "stroke-width", "transform", "viewbox", "width", "x", "x1", "x2", "y", "y1", "y2"
]);

export type SanitizeArtifactInput = {
  route: string;
  bodyHtml: string;
  declaredRoutes: Set<string>;
  assets: AssetRevisionRef[];
  allowedFormIds: Set<string>;
  allowedExternalHrefs: Set<string>;
  allowedPhoneNumbers: Set<string>;
  allowedEmailAddresses: Set<string>;
};

export function sanitizeAgentHtml(input: SanitizeArtifactInput) {
  const findings: ArtifactGateFinding[] = [];
  const document = parseDocument(input.bodyHtml, { decodeEntities: true });
  const assets = new Map(input.assets.map((asset) => [asset.assetId, asset]));

  visit(document.children, (element) => {
    const tag = element.name.toLowerCase();
    if (!htmlTags.has(tag) && !svgTags.has(tag)) {
      findings.push(finding("html.forbidden_tag", "html", `Element <${tag}> is not allowed.`, input.route));
      DomUtils.removeElement(element);
      return false;
    }
    sanitizeAttributes(element, tag, findings, input.route);

    if (tag === "a") sanitizeLink(element, input, findings);
    if (tag === "img" || tag === "source") sanitizeAsset(element, assets, findings, input.route);
    if (tag === "form") sanitizeForm(element, input.allowedFormIds, findings, input.route);
    if (tag === "input" && ["file", "image"].includes(element.attribs.type?.toLowerCase() ?? "")) {
      const type = element.attribs.type.toLowerCase();
      findings.push(finding(
        type === "file" ? "capability.file_upload" : "capability.image_input",
        "capability",
        type === "file" ? "File-upload controls are not supported." : "Image-submit controls and their source loads are not supported.",
        input.route
      ));
      element.attribs.type = type === "file" ? "text" : "button";
      delete element.attribs.src;
    }
    return true;
  });

  return { html: DomUtils.getInnerHTML(document), findings: dedupeFindings(findings) };
}

export function sanitizeAgentCss(css: string, eligibleAssets: AssetRevisionRef[]) {
  const findings: ArtifactGateFinding[] = [];
  if (/<\/style|<script/i.test(css)) findings.push(finding("css.breakout", "css", "CSS contains an HTML breakout sequence."));
  const assets = new Map(eligibleAssets.map((asset) => [asset.assetId, asset]));
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch (error) {
    findings.push(finding("css.parse", "css", `CSS could not be parsed safely: ${error instanceof Error ? error.message : String(error)}`));
    return { css: "", findings: dedupeFindings(findings) };
  }
  root.walkAtRules((rule) => {
    const name = decodeCssEscapes(rule.name).toLowerCase();
    if (name === "import") {
      findings.push(finding("css.import", "css", "CSS @import is not allowed."));
      rule.remove();
    } else if (name === "font-face") {
      findings.push(finding("css.font_face", "css", "Agent-authored font loading is not allowed."));
      rule.remove();
    }
  });
  root.walkDecls((declaration) => {
    const executable = `${decodeCssEscapes(declaration.prop)}:${decodeCssEscapes(declaration.value)}`;
    if (/expression\s*\(|javascript\s*:|(?:^|;)\s*behavior\s*:|-moz-binding/i.test(executable)) {
      findings.push(finding("css.executable", "css", "CSS contains executable or binding syntax."));
      declaration.remove();
      return;
    }
    const parsed = valueParser(declaration.value);
    parsed.walk((node) => {
      if (node.type !== "function" || decodeCssEscapes(node.value).toLowerCase() !== "url") return;
      const raw = valueParser.stringify(node.nodes).trim().replace(/^(['"])(.*)\1$/, "$2");
      const decoded = decodeCssEscapes(raw);
      const assetId = decoded.match(/^asset:\/\/([a-zA-Z0-9_.:-]+)$/)?.[1];
      const asset = assetId ? assets.get(assetId) : undefined;
      if (!asset) {
        findings.push(finding("css.url", "css", `CSS URL must reference an eligible asset:// ID: ${decoded || "empty URL"}.`));
        node.nodes = [{ type: "string", quote: "\"", value: "/_lodesta/asset-unavailable.svg", sourceIndex: 0, sourceEndIndex: 0 }];
        return;
      }
      node.value = "url";
      node.nodes = [{
        type: "string",
        quote: "\"",
        value: `/_lodesta/assets/${encodeURIComponent(asset.revisionId)}`,
        sourceIndex: 0,
        sourceEndIndex: 0
      }];
    });
    declaration.value = parsed.toString();
  });
  const output = root.toString().replace(/<\/style/gi, "<\\/style");
  try {
    const verified = postcss.parse(output);
    verified.walkDecls((declaration) => {
      valueParser(declaration.value).walk((node) => {
        if (node.type !== "function" || decodeCssEscapes(node.value).toLowerCase() !== "url") return;
        const value = valueParser.stringify(node.nodes).trim().replace(/^(['"])(.*)\1$/, "$2");
        if (!/^\/_lodesta\/(?:assets\/[A-Za-z0-9_.:%-]+|asset-unavailable\.svg)$/.test(value)) {
          findings.push(finding("css.url_unresolved", "css", `Final CSS contains an unresolved URL: ${value}.`));
        }
      });
    });
  } catch {
    findings.push(finding("css.final_parse", "css", "Final CSS failed its parser round-trip."));
  }
  return { css: output, findings: dedupeFindings(findings) };
}

function decodeCssEscapes(value: string) {
  return value.replace(/\\([0-9a-f]{1,6})(?:\s)?|\\(.)/gi, (_match, hex: string | undefined, escaped: string | undefined) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : escaped ?? "");
}

function sanitizeAttributes(element: Element, tag: string, findings: ArtifactGateFinding[], route: string) {
  const allowed = svgTags.has(tag) ? svgAttributes : commonAttributes;
  for (const name of Object.keys(element.attribs)) {
    const normalized = name.toLowerCase();
    if (normalized.startsWith("data-lodesta-")) continue;
    if (normalized === "src" && tag !== "img" && tag !== "source") {
      findings.push(finding("html.non_media_src", "html", `Attribute src is not allowed on <${tag}>.`, route));
      delete element.attribs[name];
      continue;
    }
    if (normalized.startsWith("on") || normalized === "style" || normalized === "srcset" || !allowed.has(normalized)) {
      findings.push(finding("html.forbidden_attribute", "html", `Attribute ${name} is not allowed on <${tag}>.`, route));
      delete element.attribs[name];
    }
  }
}

function sanitizeLink(element: Element, input: SanitizeArtifactInput, findings: ArtifactGateFinding[]) {
  const href = element.attribs.href ?? "";
  const disposition = hrefDisposition(href, input);
  if (disposition === "factual_mismatch") {
    findings.push(finding("fact.link_mismatch", "claim", `Link is not present in the retained public business context: ${href || "missing href"}.`, input.route));
    element.attribs.href = "#";
    return;
  }
  if (disposition === "unsafe") {
    findings.push(finding("link.unsafe", "link", `Unsafe, unverified, or unresolved link: ${href || "missing href"}.`, input.route));
    element.attribs.href = "#";
    return;
  }
  if (/^https?:\/\//i.test(href)) {
    element.attribs.target = "_blank";
    element.attribs.rel = "noopener noreferrer";
  }
}

function sanitizeAsset(
  element: Element,
  assets: Map<string, AssetRevisionRef>,
  findings: ArtifactGateFinding[],
  route: string
) {
  const source = element.attribs.src ?? "";
  const assetId = source.match(/^asset:\/\/([a-zA-Z0-9_.:-]+)$/)?.[1];
  const asset = assetId ? assets.get(assetId) : undefined;
  if (!asset) {
    findings.push(finding("asset.unbound", "asset", `Image must use an eligible asset:// binding: ${source || "missing src"}.`, route));
    element.attribs.src = "/_lodesta/asset-unavailable.svg";
    return;
  }
  element.attribs.src = `/_lodesta/assets/${encodeURIComponent(asset.revisionId)}`;
  if (element.name === "img") {
    element.attribs.alt = element.attribs.alt?.trim() || asset.alt;
    element.attribs.loading ??= "lazy";
    element.attribs.decoding ??= "async";
    if (asset.width) element.attribs.width ??= String(asset.width);
    if (asset.height) element.attribs.height ??= String(asset.height);
  }
}

function sanitizeForm(element: Element, allowedFormIds: Set<string>, findings: ArtifactGateFinding[], route: string) {
  const formId = element.attribs["data-lodesta-form-id"];
  delete element.attribs.action;
  delete element.attribs.method;
  if (!formId || !allowedFormIds.has(formId)) {
    findings.push(finding("capability.form_unbound", "capability", "Form does not reference an eligible platform form definition.", route));
    element.attribs["data-lodesta-disabled"] = "true";
    for (const control of DomUtils.findAll((node) => node.type === "tag" && ["input", "textarea", "select", "button"].includes(node.name), element.children)) {
      if (control.type === "tag") control.attribs.disabled = "";
    }
  }
}

function hrefDisposition(value: string, input: SanitizeArtifactInput): "safe" | "factual_mismatch" | "unsafe" {
  if (!value || /^javascript:|^data:|^blob:/i.test(value)) return "unsafe";
  if (value.startsWith("#")) return "safe";
  if (/^tel:/i.test(value)) {
    return input.allowedPhoneNumbers.has(comparablePhone(value.slice(4))) ? "safe" : "factual_mismatch";
  }
  if (/^mailto:/i.test(value)) {
    return input.allowedEmailAddresses.has(value.slice(7).trim().toLowerCase()) ? "safe" : "factual_mismatch";
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "https:" || parsed.protocol === "http:") && input.allowedExternalHrefs.has(parsed.toString())
        ? "safe"
        : "factual_mismatch";
    } catch {
      return "unsafe";
    }
  }
  try {
    const parsed = new URL(value, "https://site.lodesta.local");
    return input.declaredRoutes.has(normalizeRoutePath(parsed.pathname)) ? "safe" : "unsafe";
  } catch {
    return "unsafe";
  }
}

function comparablePhone(value: string) {
  return value.replace(/\D/g, "").slice(-10);
}

function visit(nodes: AnyNode[], operation: (element: Element) => boolean) {
  for (const node of [...nodes]) {
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style") continue;
    if (operation(node as Element)) visit((node as Element).children, operation);
  }
}

function finding(id: string, area: ArtifactGateFinding["area"], message: string, route?: string): ArtifactGateFinding {
  return { id, severity: "error", area, message, ...(route ? { route } : {}) };
}

function dedupeFindings(findings: ArtifactGateFinding[]) {
  const seen = new Set<string>();
  return findings.filter((item) => {
    const key = `${item.id}:${item.route ?? ""}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
