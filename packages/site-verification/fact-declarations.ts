import { DomUtils, parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import { canonicalSourceTokens } from "@/lib/source-text-blocks";
import { gatedSensitiveClaims, scanSensitiveClaimText } from "@/lib/content-safety-scanners";
import { isContinuousAvailabilityValue } from "@/packages/business-data/availability";
import {
  factBindingSchema,
  type FactBinding,
  type PublicFact,
  type SitePublicBuildInput
} from "@/packages/site-contracts";
import { factBindingPolicyIdentity } from "@/packages/site-contracts/platform-manifest";
import type { ArtifactGateFinding } from "./contracts";
import { localAddressPresentation } from "./address-presentation";

export { factBindingPolicyIdentity };

export type FactBindingValidationRoute = {
  path: string;
  html: string;
  title?: string;
  description?: string;
};

export type FactBindingValidationResult = {
  status: "pass" | "fail";
  bindings: FactBinding[];
  findings: ArtifactGateFinding[];
};

type VisibleRoute = {
  path: string;
  title: string;
  description: string;
  bodyText: string;
  bindings: FactBinding[];
  hasBusinessNameMarker: boolean;
  businessNameMarkerTexts: string[];
};

export class FactBindingValidator {
  validate(input: {
    routes: FactBindingValidationRoute[];
    buildInput: SitePublicBuildInput;
  }): FactBindingValidationResult {
    const findings: ArtifactGateFinding[] = [];
    const facts = new Map(input.buildInput.publicFacts.map((fact) => [fact.id, fact]));
    const routes = input.routes.map((route) => visibleRoute(route, input.buildInput, facts, findings));
    const bindings = routes.flatMap((route) => route.bindings);

    for (const route of routes) {
      findings.push(...bodyMarkerFindings(route, input.buildInput));
      findings.push(...bodySensitiveFindings(route, input.buildInput));
      findings.push(...metadataFindings(route, "title", route.title, input.buildInput));
      findings.push(...metadataFindings(route, "description", route.description, input.buildInput));
      for (const renderedName of route.businessNameMarkerTexts) {
        if (normalizedText(renderedName) !== normalizedText(input.buildInput.business.name)) {
          findings.push(finding(
            "identity.rendered_mismatch",
            `BusinessName rendered ${JSON.stringify(renderedName)} instead of canonical identity ${JSON.stringify(input.buildInput.business.name)}.`,
            route.path,
            "warning"
          ));
        }
      }
    }

    if (!routes.some((route) => route.hasBusinessNameMarker)) {
      findings.push(finding(
        "identity.rendered_mismatch",
        "The rendered site does not use the compiler-backed BusinessName component; verify that visible branding matches canonical identity.",
        "/",
        "warning"
      ));
    }

    const deduped = dedupeFindings(findings);
    return {
      status: deduped.some((item) => item.severity === "error") ? "fail" : "pass",
      bindings: bindings.map((binding) => factBindingSchema.parse(binding)),
      findings: deduped
    };
  }
}

function visibleRoute(
  route: FactBindingValidationRoute,
  buildInput: SitePublicBuildInput,
  facts: Map<string, PublicFact>,
  findings: ArtifactGateFinding[]
): VisibleRoute {
  const document = parseDocument(route.html, { decodeEntities: true });
  const state = {
    text: "",
    bindings: [] as FactBinding[],
    bindingIndex: 0,
    hasBusinessNameMarker: false,
    businessNameMarkerTexts: [] as string[]
  };

  const append = (value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    if (state.text && !state.text.endsWith(" ")) state.text += " ";
    state.text += normalized;
  };

  const visit = (nodes: AnyNode[]) => {
    for (const node of nodes) {
      if (node.type === "text") {
        append(node.data);
        continue;
      }
      if (node.type !== "tag") continue;
      if (["script", "style", "noscript", "svg"].includes(node.name)) continue;
      const isBusinessName = node.attribs["data-lodesta-business-name"] !== undefined;
      if (isBusinessName) state.hasBusinessNameMarker = true;
      const start = state.text.length;
      visit(node.children);
      const end = state.text.length;
      if (isBusinessName) state.businessNameMarkerTexts.push(state.text.slice(start, end).trim());
      const factId = node.attribs["data-lodesta-fact-id"];
      if (!factId) continue;
      const fact = facts.get(factId);
      if (!fact) {
        findings.push(finding("fact.sdk_fact_missing", `SDK binding references unavailable fact ${factId}.`, route.path));
        continue;
      }
      const rendered = state.text.slice(start, end).trim();
      if (node.attribs["data-lodesta-business-address"] !== undefined) {
        const variant = node.attribs["data-lodesta-address-variant"] ?? "";
        const locationId = node.attribs["data-lodesta-location-id"] ?? "";
        const presentation = variant === "local"
          ? localAddressPresentation(buildInput, locationId, fact.id)
          : undefined;
        if (!presentation || !sameCompleteValue(presentation.value, rendered)) {
          const expected = presentation?.value ?? "a server-derived local address for the referenced location";
          findings.push(finding(
            "fact.sdk_value_mismatch",
            `BusinessAddress mismatch on ${route.path}: rendered=${JSON.stringify(rendered)} expected=${JSON.stringify(expected)} factId=${JSON.stringify(fact.id)} locationId=${JSON.stringify(locationId || null)} variant=${JSON.stringify(variant || null)} affectedRoutes=${JSON.stringify([route.path])}.`,
            route.path
          ));
          continue;
        }
        state.bindingIndex += 1;
        state.bindings.push({
          id: `fact:${route.path.replace(/[^a-z0-9]+/gi, "_") || "home"}:${fact.id}:${state.bindingIndex}`.slice(0, 160),
          route: route.path,
          text: presentation.value,
          origin: "sdk",
          sourceFactIds: [fact.id],
          span: { start, end }
        });
        continue;
      }
      const displayValues = [...new Set(factDisplayValues(fact).filter((value) => factValueRendered(fact, value, rendered)))];
      if (!displayValues.length) {
        findings.push(finding(
          "fact.sdk_value_mismatch",
          `SDK binding mismatch on ${route.path}: rendered=${JSON.stringify(rendered)} expected=${JSON.stringify(factDisplayValues(fact))} factId=${JSON.stringify(fact.id)} locationId=null variant=null affectedRoutes=${JSON.stringify([route.path])}.`,
          route.path
        ));
        continue;
      }
      for (const displayValue of displayValues) {
        state.bindingIndex += 1;
        state.bindings.push({
          id: `fact:${route.path.replace(/[^a-z0-9]+/gi, "_") || "home"}:${fact.id}:${state.bindingIndex}`.slice(0, 160),
          route: route.path,
          text: displayValue,
          origin: "sdk",
          sourceFactIds: [fact.id],
          span: { start, end }
        });
      }
    }
  };

  visit(document.children);
  return {
    path: route.path,
    title: route.title ?? "",
    description: route.description ?? "",
    bodyText: state.text,
    bindings: state.bindings,
    hasBusinessNameMarker: state.hasBusinessNameMarker,
    businessNameMarkerTexts: state.businessNameMarkerTexts
  };
}

function bodyMarkerFindings(route: VisibleRoute, buildInput: SitePublicBuildInput) {
  return factualMarkers(route.bodyText).flatMap((marker) => {
    const supported = route.bindings.some((binding) => binding.span
      && marker.start >= binding.span.start
      && marker.end <= binding.span.end
      && bindingSupportsText(binding, marker.text, buildInput));
    return supported ? [] : [finding(
      "fact.undeclared_marker",
      `Factual marker ${JSON.stringify(marker.text)} is not inside a compatible canonical fact binding.`,
      route.path
    )];
  });
}

function bodySensitiveFindings(route: VisibleRoute, buildInput: SitePublicBuildInput) {
  return scanSensitiveClaimText(route.bodyText).flatMap((match) => {
    const supported = route.bindings.some((binding) => binding.span
      && match.start >= binding.span.start
      && match.end <= binding.span.end
      && sensitiveBindingMatches(match, binding, buildInput));
    return supported ? [] : [finding(
      "fact.sensitive_unsupported",
      `${match.label} ${JSON.stringify(match.matchedText)} appears outside a compatible canonical fact binding.`,
      route.path
    )];
  });
}

function metadataFindings(
  route: VisibleRoute,
  surface: "title" | "description",
  text: string,
  buildInput: SitePublicBuildInput
) {
  const markers = factualMarkers(text).map((marker) => ({
    start: marker.start,
    end: marker.end,
    matchedText: marker.text,
    label: "factual marker",
    category: undefined
  }));
  const sensitive = scanSensitiveClaimText(text).map((match) => ({ ...match, category: match.category as string | undefined }));
  return [...markers, ...sensitive].flatMap((match) => {
    const supported = route.bindings.some((binding) => {
      if (!binding.span || !bindingSupportsText(binding, binding.text, buildInput)) return false;
      const occurrence = completeValueOccurrence(text, binding.text, match.start, match.end);
      if (!occurrence) return false;
      if (match.category) {
        const sensitiveMatch = scanSensitiveClaimText(text).find((candidate) =>
          candidate.start === match.start && candidate.end === match.end && candidate.category === match.category);
        return Boolean(sensitiveMatch && sensitiveBindingMatches(sensitiveMatch, binding, buildInput));
      }
      return bindingSupportsText(binding, match.matchedText, buildInput);
    });
    return supported ? [] : [finding(
      "fact.metadata_unsupported",
      `${surface} ${match.label} ${JSON.stringify(match.matchedText)} requires the same complete canonical fact to be visibly bound on this route.`,
      route.path
    )];
  });
}

function completeValueOccurrence(text: string, value: string, matchStart: number, matchEnd: number) {
  const haystack = canonicalTextWithOffsets(text);
  const needle = normalizedText(value);
  if (!needle) return false;
  let index = haystack.text.indexOf(needle);
  while (index >= 0) {
    const start = haystack.offsets[index]?.start ?? 0;
    const end = haystack.offsets[index + needle.length - 1]?.end ?? start;
    if (matchStart >= start && matchEnd <= end) return true;
    index = haystack.text.indexOf(needle, index + 1);
  }
  return false;
}

function sensitiveBindingMatches(
  match: ReturnType<typeof scanSensitiveClaimText>[number],
  binding: FactBinding,
  buildInput: SitePublicBuildInput
) {
  if (!gatedSensitiveClaims(binding.text).some((candidate) => candidate.category === match.category)) return false;
  if (!bindingSupportsText(binding, binding.text, buildInput, true)) return false;
  if (buildInput.publicFacts.some((fact) => fact.kind === "offering"
      && binding.sourceFactIds.includes(fact.id)
      && factSupportsText(fact, binding.text, true))) {
    return true;
  }
  const compatibleKinds = proofKindsFor(match);
  return buildInput.business.proof.some((proof) => compatibleKinds.has(proof.kind)
    && proof.sourceFactIds.some((factId) => binding.sourceFactIds.includes(factId)));
}

function bindingSupportsText(binding: FactBinding, text: string, buildInput: SitePublicBuildInput, sensitive = false) {
  const facts = binding.sourceFactIds
    .map((factId) => buildInput.publicFacts.find((fact) => fact.id === factId))
    .filter((fact): fact is PublicFact => Boolean(fact));
  return facts.length === binding.sourceFactIds.length
    && facts.some((fact) => factSupportsText(fact, text, sensitive || fact.kind === "proof"));
}

function factSupportsText(fact: PublicFact, text: string, complete: boolean) {
  return factDisplayValues(fact).some((source) => {
    if (fact.kind === "phone") return comparableDigits(source).slice(-7) === comparableDigits(text).slice(-7);
    if (fact.kind === "email") return source.trim().toLowerCase() === text.trim().toLowerCase();
    if (complete) return sameCompleteValue(source, text);
    return normalizedText(source).includes(normalizedText(text));
  });
}

function factValueRendered(fact: PublicFact, value: string, rendered: string) {
  if (fact.kind === "proof") return sameCompleteValue(value, rendered);
  if (fact.kind === "phone") return comparablePhoneDigits(rendered) === comparablePhoneDigits(value);
  if (fact.kind === "email") return rendered.trim().toLowerCase() === value.trim().toLowerCase();
  if (fact.kind === "hours") {
    const summary = canonicalHoursSummary(fact.value);
    if (summary && sameCompleteValue(summary, rendered)) return true;
    const components = canonicalDisplayComponents(fact.value);
    return components.length > 0 && components.every((component) => normalizedText(rendered).includes(normalizedText(component)));
  }
  if (fact.kind === "address") {
    const canonical = factDisplayValues(fact).at(-1);
    return Boolean(canonical && sameCompleteValue(canonical, rendered));
  }
  return sameCompleteValue(value, rendered);
}

function sameCompleteValue(source: string, rendered: string) {
  const sourceTokens = canonicalSourceTokens(source).map((token) => token.value);
  const renderedTokens = canonicalSourceTokens(rendered).map((token) => token.value);
  return sourceTokens.length > 0
    && sourceTokens.length === renderedTokens.length
    && sourceTokens.every((token, index) => token === renderedTokens[index]);
}

function comparablePhoneDigits(value: string) {
  const digits = comparableDigits(value);
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function factDisplayValues(fact: PublicFact): string[] {
  const values = flattenDisplayValues(fact.value).filter(Boolean);
  const hoursSummary = fact.kind === "hours" ? canonicalHoursSummary(fact.value) : undefined;
  return [...new Set([...values, ...(hoursSummary ? [hoursSummary] : [])])];
}

function canonicalHoursSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const ordered = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim()))
    .map(([label, itemValue], sourceIndex) => {
      const [firstDay, lastDay = firstDay] = label.split("-").map((part) => part.trim());
      const order = canonicalDays.indexOf(firstDay);
      const endOrder = canonicalDays.indexOf(lastDay);
      return { label, value: itemValue, sourceIndex, order, endOrder: endOrder >= order ? endOrder : order };
    })
    .sort((left, right) => left.order - right.order || left.sourceIndex - right.sourceIndex);
  if (!ordered.length) return undefined;
  if (ordered.every((item) => isContinuousAvailabilityValue(item.value))) return "Open 24 hours daily";
  const groups: Array<{ first: string; last: string; value: string; endOrder: number }> = [];
  for (const item of ordered) {
    const prior = groups.at(-1);
    if (prior?.value === item.value && item.order === prior.endOrder + 1) {
      prior.last = item.label;
      prior.endOrder = item.endOrder;
    } else {
      groups.push({ first: item.label, last: item.label, value: item.value, endOrder: item.endOrder });
    }
  }
  return groups
    .map((group) => `${group.first === group.last ? group.first : `${group.first}–${group.last}`}: ${group.value}`)
    .join("; ");
}

const canonicalDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function canonicalDisplayComponents(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(canonicalDisplayComponents);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([key, nested]) => `${key} ${flattenDisplayValues(nested).join(" ")}`.trim());
}

function flattenDisplayValues(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenDisplayValues);
  if (!value || typeof value !== "object") return [];
  const values = Object.values(value as Record<string, unknown>).flatMap(flattenDisplayValues);
  const joined = values.join(" ").trim();
  return [...values, ...(joined ? [joined] : [])];
}

function factualMarkers(text: string) {
  const markers: Array<{ text: string; start: number; end: number }> = [];
  for (const pattern of [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g,
    /\$\s?\d+(?:[,.]\d{2})?/g,
    /\b24\s*\/\s*7\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:stars?|years? in business|year warranty)\b/gi
  ]) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      markers.push({ text: match[0], start, end: start + match[0].length });
    }
  }
  return dedupeBy(markers, (item) => `${item.start}:${item.end}:${item.text.toLowerCase()}`);
}

function proofKindsFor(match: ReturnType<typeof scanSensitiveClaimText>[number]) {
  if (match.category === "credential" || match.category === "regulated") return new Set(["credential"]);
  if (match.category === "insurance") return new Set(["insurance_support"]);
  if (match.category === "pricing" || match.category === "emergency") return new Set(["offer"]);
  if (match.category === "warranty" || match.category === "guarantee") return new Set(["warranty"]);
  if (match.category === "reviews") return new Set(["testimonial"]);
  if (match.category === "longevity") return new Set(["longevity"]);
  return /award|voted/i.test(match.matchedText) ? new Set(["award"]) : new Set(["credential", "award"]);
}

function canonicalTextWithOffsets(value: string) {
  let text = "";
  const offsets: Array<{ start: number; end: number }> = [];
  let pendingSpace: { start: number; end: number } | undefined;
  for (let index = 0; index < value.length; index += 1) {
    for (const character of value[index].normalize("NFKC").toLocaleLowerCase("en-US")) {
      if (/[a-z0-9]/.test(character)) {
        if (pendingSpace && text.length > 0) {
          text += " ";
          offsets.push(pendingSpace);
        }
        pendingSpace = undefined;
        text += character;
        offsets.push({ start: index, end: index + 1 });
      } else if (text.length > 0) {
        pendingSpace = pendingSpace
          ? { start: pendingSpace.start, end: index + 1 }
          : { start: index, end: index + 1 };
      }
    }
  }
  return { text, offsets };
}

function comparableDigits(value: string) {
  return value.replace(/\D/g, "");
}

function normalizedText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function finding(
  id: string,
  message: string,
  route: string,
  severity: ArtifactGateFinding["severity"] = "error"
): ArtifactGateFinding {
  return { id, severity, area: id.startsWith("identity.") ? "metadata" : "claim", message, route };
}

function dedupeFindings(findings: ArtifactGateFinding[]) {
  return dedupeBy(findings, (item) => `${item.id}:${item.route ?? ""}:${item.message}`);
}

function dedupeBy<T>(items: T[], keyFor: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
