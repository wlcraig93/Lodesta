import { DomUtils, parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import type { AssetRevisionRef } from "@/packages/site-contracts";
import { normalizeRoutePath, type ArtifactGateFinding } from "./contracts";

const htmlTags = new Set([
  "a", "address", "article", "aside", "b", "blockquote", "br", "button", "cite", "code", "dd", "details", "div", "dl", "dt",
  "dialog", "em", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img",
  "input", "label", "legend", "li", "main", "nav", "ol", "option", "p", "picture", "section", "select", "small", "source", "span",
  "strong", "summary", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "time", "tr", "ul"
]);
const svgTags = new Set(["svg", "path", "circle", "line", "polyline", "polygon", "rect", "g"]);
const commonAttributes = new Set([
  "alt", "aria-atomic", "aria-controls", "aria-current", "aria-describedby", "aria-expanded", "aria-haspopup", "aria-hidden", "aria-label", "aria-labelledby", "aria-modal",
  "aria-live", "aria-pressed", "aria-selected", "autocomplete", "checked", "class", "cols", "colspan", "decoding", "disabled", "for", "height",
  "fetchpriority", "hidden", "href", "id", "loading", "max", "maxlength", "min", "minlength", "name", "open", "placeholder", "rel", "required", "role", "rows", "rowspan",
  "selected", "src", "tabindex", "target", "title", "type", "value", "width"
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
    if (tag === "img") sanitizeImage(element, assets, findings, input.route);
    if (tag === "source") sanitizeResponsiveSource(element, assets, findings, input.route);
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
  normalizeManagedNavigation(document.children);
  validateNativeInteractions(document.children, findings, input.route);
  validateResponsivePictures(document.children, findings, input.route);

  return { html: DomUtils.getInnerHTML(document), findings: dedupeFindings(findings) };
}

function normalizeManagedNavigation(nodes: AnyNode[]) {
  const elements = DomUtils.findAll((node) => node.type === "tag", nodes);
  const elementsById = new Map(elements.flatMap((element) => element.attribs.id ? [[element.attribs.id, element] as const] : []));
  for (const toggle of elements.filter((element) => element.attribs["data-lodesta-menu-toggle"] !== undefined)) {
    const targetId = toggle.attribs["aria-controls"];
    const target = targetId ? elementsById.get(targetId) : undefined;
    if (!target || target.attribs["data-lodesta-navigation-panel"] === undefined) continue;
    const open = toggle.attribs["aria-expanded"] === "true";
    toggle.attribs["aria-expanded"] = String(open);
    if (open) delete target.attribs.hidden;
    else target.attribs.hidden = "";
  }
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
    const nativeAttribute = isAllowedNativeAttribute(tag, normalized, element);
    if (normalized.startsWith("on") || normalized === "style" || (!nativeAttribute && !allowed.has(normalized))) {
      findings.push(finding("html.forbidden_attribute", "html", `Attribute ${name} is not allowed on <${tag}>.`, route));
      delete element.attribs[name];
    }
  }
  sanitizeNativeAttributeValues(element, tag, findings, route);
}

function isAllowedNativeAttribute(tag: string, attribute: string, element: Element) {
  if (attribute === "popover") return !svgTags.has(tag);
  if (attribute === "popovertarget" || attribute === "popovertargetaction") {
    return tag === "button" || (tag === "input" && (element.attribs.type ?? "").toLowerCase() === "button");
  }
  if (attribute === "srcset" || attribute === "sizes") return tag === "img" || tag === "source";
  if (attribute === "media") return tag === "source";
  return false;
}

function sanitizeNativeAttributeValues(element: Element, tag: string, findings: ArtifactGateFinding[], route: string) {
  if (element.attribs.popover !== undefined) {
    const value = element.attribs.popover.trim().toLowerCase();
    if (value && value !== "auto" && value !== "manual") {
      findings.push(finding("html.popover_value", "html", `Popover mode ${JSON.stringify(element.attribs.popover)} is not supported.`, route));
      delete element.attribs.popover;
    } else {
      element.attribs.popover = value || "auto";
    }
  }
  if (element.attribs.popovertargetaction !== undefined) {
    const action = element.attribs.popovertargetaction.trim().toLowerCase();
    if (!new Set(["toggle", "show", "hide"]).has(action)) {
      findings.push(finding("html.popover_action", "html", `Popover target action ${JSON.stringify(element.attribs.popovertargetaction)} is invalid.`, route));
      delete element.attribs.popovertargetaction;
    } else {
      element.attribs.popovertargetaction = action;
    }
  }
  if ((element.attribs.popovertarget !== undefined || element.attribs.popovertargetaction !== undefined)
    && tag === "input" && (element.attribs.type ?? "").toLowerCase() !== "button") {
    findings.push(finding("html.popover_trigger", "html", "Popover targeting is allowed only on <button> or <input type=\"button\">.", route));
    delete element.attribs.popovertarget;
    delete element.attribs.popovertargetaction;
  }
}

function validateNativeInteractions(nodes: AnyNode[], findings: ArtifactGateFinding[], route: string) {
  const elements = DomUtils.findAll((node) => node.type === "tag", nodes);
  const byId = new Map(elements.flatMap((element) => element.attribs.id ? [[element.attribs.id, element] as const] : []));
  for (const trigger of elements.filter((element) => element.attribs.popovertarget !== undefined)) {
    const targetId = trigger.attribs.popovertarget.trim();
    const target = byId.get(targetId);
    if (!targetId || !target || target.attribs.popover === undefined) {
      findings.push(finding("html.popover_target", "html", `Popover trigger references a missing or non-popover target: ${targetId || "missing target"}.`, route));
      delete trigger.attribs.popovertarget;
      delete trigger.attribs.popovertargetaction;
    }
  }
}

function validateResponsivePictures(nodes: AnyNode[], findings: ArtifactGateFinding[], route: string) {
  const pictures = DomUtils.findAll((node) => node.type === "tag" && node.name === "picture", nodes);
  for (const picture of pictures) {
    const fallback = DomUtils.findOne((node) => node.type === "tag" && node.name === "img", picture.children);
    if (!fallback || fallback.attribs.src === undefined) {
      findings.push(finding("asset.picture_fallback", "asset", "A <picture> requires an eligible fallback <img src=\"asset://…\">.", route));
    }
  }
}

function parseSrcset(value: string, assets: Map<string, AssetRevisionRef>): { ok: true; value: string } | { ok: false; message: string } {
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, message: "Responsive image srcset is empty, too long, or contains control characters." };
  }
  const candidates = value.split(",").map((candidate) => candidate.trim()).filter(Boolean);
  if (!candidates.length || candidates.length > 50) return { ok: false, message: "Responsive image srcset has an invalid candidate count." };
  let descriptorKind: "width" | "density" | undefined;
  const descriptors = new Set<string>();
  const rewritten: string[] = [];
  for (const candidate of candidates) {
    const parts = candidate.split(/\s+/);
    if (parts.length > 2) return { ok: false, message: `Responsive image candidate is malformed: ${candidate}.` };
    const assetId = parts[0]?.match(/^asset:\/\/([a-zA-Z0-9_.:-]+)$/)?.[1];
    const asset = assetId ? assets.get(assetId) : undefined;
    if (!asset) return { ok: false, message: `Responsive image candidate must use an eligible asset:// binding: ${parts[0] || "missing source"}.` };
    const descriptor = parts[1] ?? "1x";
    const kind = /^[1-9][0-9]{0,5}w$/.test(descriptor)
      ? "width" as const
      : /^(?:[1-9][0-9]*(?:\.[0-9]+)?|0?\.[0-9]+)x$/.test(descriptor)
        ? "density" as const
        : undefined;
    if (!kind) return { ok: false, message: `Responsive image descriptor is invalid: ${descriptor}.` };
    if (descriptorKind && descriptorKind !== kind) return { ok: false, message: "Responsive image srcset cannot mix width and density descriptors." };
    descriptorKind = kind;
    if (descriptors.has(descriptor)) return { ok: false, message: `Responsive image descriptor is duplicated: ${descriptor}.` };
    descriptors.add(descriptor);
    rewritten.push(`/_lodesta/assets/${encodeURIComponent(asset.revisionId)}${parts[1] ? ` ${descriptor}` : ""}`);
  }
  return { ok: true, value: rewritten.join(", ") };
}

function validSizes(value: string) {
  if (!safeResponsiveExpression(value, 2048)) return false;
  const entries = splitTopLevelCommas(value);
  if (!entries?.length) return false;
  return entries.every((entry) => {
    const boundary = lastTopLevelWhitespace(entry);
    const condition = boundary < 0 ? "" : entry.slice(0, boundary).trim();
    const size = entry.slice(boundary + 1).trim();
    return validSourceSize(size) && (!condition || validMediaQueryList(condition));
  });
}

function validSourceSize(value: string) {
  if (value === "auto" || value === "0") return true;
  if (/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:px|vw|vh|vmin|vmax|em|rem|cm|mm|in|pt|pc|%)$/i.test(value)) return true;
  return /^(?:calc|min|max|clamp)\(/i.test(value)
    && balancedParentheses(value)
    && /^[a-z0-9.%+\-*/(),\s]+$/i.test(value)
    && !/\b(?:url|var|expression)\s*\(/i.test(value);
}

function validMediaQueryList(value: string) {
  if (!safeResponsiveExpression(value, 1024)) return false;
  const queries = splitTopLevelCommas(value);
  return Boolean(queries?.length && queries.every((query) => {
    const normalized = query.trim();
    return normalized.length > 0
      && balancedParentheses(normalized)
      && /^[a-z0-9\s():.,/%+\-<>=]+$/i.test(normalized)
      && !/\b(?:url|var|expression)\s*\(/i.test(normalized);
  }));
}

function safeResponsiveExpression(value: string, maximumLength: number) {
  return value.length > 0
    && value.length <= maximumLength
    && !/[\u0000-\u001f\u007f{};"'\\]/.test(value)
    && !/\b(?:url|javascript|data|blob)\s*(?:\(|:)/i.test(value)
    && balancedParentheses(value);
}

function splitTopLevelCommas(value: string) {
  const entries: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    if (value[index] === ")") depth -= 1;
    if (depth < 0) return undefined;
    if (value[index] === "," && depth === 0) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) return undefined;
  entries.push(value.slice(start).trim());
  return entries.every(Boolean) ? entries : undefined;
}

function lastTopLevelWhitespace(value: string) {
  let depth = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] === ")") depth += 1;
    else if (value[index] === "(") depth -= 1;
    else if (depth === 0 && /\s/.test(value[index] ?? "")) return index;
  }
  return -1;
}

function balancedParentheses(value: string) {
  let depth = 0;
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
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

function sanitizeImage(
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
  element.attribs.alt = element.attribs.alt?.trim() || asset.alt;
  element.attribs.loading ??= "lazy";
  element.attribs.decoding ??= "async";
  if (asset.width) element.attribs.width ??= String(asset.width);
  if (asset.height) element.attribs.height ??= String(asset.height);
  if (element.attribs.srcset !== undefined) sanitizeSrcset(element, assets, findings, route);
  if (element.attribs.sizes !== undefined && !validSizes(element.attribs.sizes)) {
    findings.push(finding("asset.sizes_invalid", "asset", "Responsive image sizes is malformed or unsupported.", route));
    delete element.attribs.sizes;
  }
}

function sanitizeResponsiveSource(
  element: Element,
  assets: Map<string, AssetRevisionRef>,
  findings: ArtifactGateFinding[],
  route: string
) {
  delete element.attribs.src;
  if (element.attribs.srcset === undefined) {
    findings.push(finding("asset.srcset_missing", "asset", "A responsive <source> must declare an eligible asset:// srcset.", route));
    return;
  }
  sanitizeSrcset(element, assets, findings, route);
  if (element.attribs.sizes !== undefined && !validSizes(element.attribs.sizes)) {
    findings.push(finding("asset.sizes_invalid", "asset", "Responsive source sizes is malformed or unsupported.", route));
    delete element.attribs.sizes;
  }
  if (element.attribs.media !== undefined && !validMediaQueryList(element.attribs.media)) {
    findings.push(finding("asset.media_invalid", "asset", "Responsive source media is malformed or unsupported.", route));
    delete element.attribs.media;
  }
}

function sanitizeSrcset(
  element: Element,
  assets: Map<string, AssetRevisionRef>,
  findings: ArtifactGateFinding[],
  route: string
) {
  const parsed = parseSrcset(element.attribs.srcset ?? "", assets);
  if (!parsed.ok) {
    findings.push(finding("asset.srcset_invalid", "asset", parsed.message, route));
    delete element.attribs.srcset;
    return;
  }
  element.attribs.srcset = parsed.value;
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
