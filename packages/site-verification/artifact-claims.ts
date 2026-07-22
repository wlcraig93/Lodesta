import { DomUtils, parseDocument } from "htmlparser2";
import type { AnyNode } from "domhandler";
import { canonicalSourceTokens } from "@/lib/source-text-blocks";
import { gatedSensitiveClaims, scanSensitiveClaimText } from "@/lib/content-safety-scanners";
import {
  claimDeclarationV1Schema,
  type ClaimDeclarationV1,
  type PublicFactV1,
  type SitePublicBuildInputV3
} from "@/packages/site-contracts";
import type { ArtifactGateFinding } from "./contracts";
import { artifactClaimPolicyVersion } from "@/packages/site-contracts/platform-versions";

export type ClaimValidationRoute = { path: string; html: string; title?: string; description?: string };
export { artifactClaimPolicyVersion };

export type ArtifactClaimValidationResult = {
  status: "pass" | "fail";
  declarations: ClaimDeclarationV1[];
  findings: ArtifactGateFinding[];
  supportedClaimIds: string[];
};

export class ArtifactClaimValidator {
  validate(input: {
    routes: ClaimValidationRoute[];
    declarations: ClaimDeclarationV1[];
    buildInput: SitePublicBuildInputV3;
  }): ArtifactClaimValidationResult {
    const findings: ArtifactGateFinding[] = [];
    const facts = new Map(input.buildInput.publicFacts.map((fact) => [fact.id, fact]));
    const autoDeclarations = input.routes.flatMap((route) => autoDeclarationsForRoute(route, facts, findings));
    const declarations = dedupeDeclarations([
      ...input.declarations.map((claim) => claimDeclarationV1Schema.parse(claim)),
      ...autoDeclarations
    ]);
    const supportedClaimIds: string[] = [];

    for (const route of input.routes) {
      const text = [route.title, route.description, visibleText(route.html)].filter(Boolean).join(" ");
      const routeDeclarations = declarations.filter((claim) => claim.route === route.path);
      for (const declaration of routeDeclarations) {
        const result = validateDeclaration(declaration, text, facts);
        if (result) findings.push(claimFinding(`claim.${declaration.id}`, result, route.path, claimSeverity(declaration, facts)));
        else supportedClaimIds.push(declaration.id);
      }
      findings.push(...undeclaredMarkerFindings(route.path, text, routeDeclarations, facts));
      findings.push(...sensitiveClaimFindings(route.path, text, routeDeclarations, supportedClaimIds, input.buildInput));
    }

    for (const declaration of declarations) {
      if (!input.routes.some((route) => route.path === declaration.route)) {
        findings.push(claimFinding(`claim.route.${declaration.id}`, "Claim references an unavailable route.", declaration.route));
      }
    }

    const deduped = dedupeFindings(findings);
    return {
      status: deduped.some((finding) => finding.severity === "error") ? "fail" : "pass",
      declarations,
      findings: deduped,
      supportedClaimIds: [...new Set(supportedClaimIds)].sort()
    };
  }
}

function autoDeclarationsForRoute(
  route: ClaimValidationRoute,
  facts: Map<string, PublicFactV1>,
  findings: ArtifactGateFinding[]
) {
  const document = parseDocument(route.html, { decodeEntities: true });
  const elements = DomUtils.findAll(
    (node) => node.type === "tag" && Boolean(node.attribs["data-lodesta-fact-id"]),
    document.children
  );
  const declarations: ClaimDeclarationV1[] = [];
  for (const element of elements) {
    if (element.type !== "tag") continue;
    const factId = element.attribs["data-lodesta-fact-id"];
    const fact = factId ? facts.get(factId) : undefined;
    if (!fact) {
      findings.push(claimFinding("claim.sdk_fact_missing", `SDK binding references unavailable fact ${factId ?? ""}.`, route.path));
      continue;
    }
    const rendered = DomUtils.textContent(element).replace(/\s+/g, " ").trim();
    const displayValues = [...new Set(factDisplayValues(fact)
      .filter((value) => sameClaimValue(value, rendered, fact.kind)))];
    if (!displayValues.length) {
      findings.push(claimFinding("claim.sdk_value_mismatch", `SDK binding ${fact.id} does not render its canonical value.`, route.path));
      continue;
    }
    displayValues.forEach((displayValue, index) => {
      declarations.push({
        id: `sdk:${route.path.replace(/[^a-z0-9]+/gi, "_") || "home"}:${fact.id}:${index + 1}`.slice(0, 160),
        route: route.path,
        text: displayValue,
        kind: "sdk_bound",
        sourceFactIds: [fact.id],
        autoDeclared: true
      });
    });
  }
  return declarations;
}

function validateDeclaration(
  declaration: ClaimDeclarationV1,
  renderedText: string,
  facts: Map<string, PublicFactV1>
) {
  if (!sameClaimValue(declaration.text, renderedText, inferredKind(declaration, facts))) {
    return "Declared claim text is not present in the sanitized rendered text.";
  }
  const sourceFacts = declaration.sourceFactIds.map((id) => facts.get(id)).filter((fact): fact is PublicFactV1 => Boolean(fact));
  if (sourceFacts.length !== declaration.sourceFactIds.length) return "Claim references an unavailable public fact ID.";
  if (!sourceFacts.some((fact) => factSupportsClaim(fact, declaration.text, isSensitive(declaration)))) {
    return "No referenced public fact supports the declared claim.";
  }
  return undefined;
}

function factSupportsClaim(fact: PublicFactV1, claim: string, sensitive: boolean) {
  return factDisplayValues(fact).some((source) => {
    if (fact.kind === "phone") return comparableDigits(source).slice(-7) === comparableDigits(claim).slice(-7);
    if (fact.kind === "email") return source.trim().toLowerCase() === claim.trim().toLowerCase();
    if (sensitive || fact.kind === "proof") {
      return sameCompleteClaim(source, claim);
    }
    const sourceText = normalizedText(source);
    const claimText = normalizedText(claim);
    return claimText.length > 0 && sourceText.includes(claimText);
  });
}

function sameCompleteClaim(source: string, claim: string) {
  const sourceTokens = canonicalSourceTokens(source).map((token) => token.value);
  const claimTokens = canonicalSourceTokens(claim).map((token) => token.value);
  return sourceTokens.length > 0
    && sourceTokens.length === claimTokens.length
    && sourceTokens.every((token, index) => claimTokens[index] === token);
}

function undeclaredMarkerFindings(
  route: string,
  text: string,
  declarations: ClaimDeclarationV1[],
  facts: Map<string, PublicFactV1>
) {
  const markers = new Set<string>();
  for (const pattern of [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g,
    /\$\s?\d+(?:[,.]\d{2})?/g,
    /\b24\s*\/\s*7\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:stars?|years? in business|year warranty)\b/gi
  ]) {
    for (const match of text.matchAll(pattern)) markers.add(match[0]);
  }
  return [...markers].flatMap((marker) => {
    const declared = declarations.some((claim) => sameClaimValue(marker, claim.text, inferredKind(claim, facts)));
    return declared ? [] : [claimFinding("claim.undeclared_marker", `Factual marker ${JSON.stringify(marker)} is not covered by a claim declaration.`, route)];
  });
}

function sensitiveClaimFindings(
  route: string,
  text: string,
  declarations: ClaimDeclarationV1[],
  supportedIds: string[],
  buildInput: SitePublicBuildInputV3
) {
  const supported = new Set(supportedIds);
  return scanSensitiveClaimText(text).flatMap((match) => {
    const matching = declarations.some((claim) => supported.has(claim.id)
      && declarationCoversOccurrence(text, claim.text, match.start, match.end)
      && sensitiveDeclarationMatches(match, claim, buildInput));
    return matching ? [] : [claimFinding(
      "claim.sensitive_unsupported",
      `${match.label} ${JSON.stringify(match.matchedText)} at characters ${match.start}-${match.end} appears without compatible supported evidence.`,
      route
    )];
  });
}

function sensitiveDeclarationMatches(
  match: ReturnType<typeof scanSensitiveClaimText>[number],
  claim: ClaimDeclarationV1,
  buildInput: SitePublicBuildInputV3
) {
  if (!gatedSensitiveClaims(claim.text).some((candidate) => candidate.category === match.category)) return false;
  const compatibleKinds = proofKindsFor(match);
  return buildInput.business.proof.some((proof) => compatibleKinds.has(proof.kind)
    && proof.sourceFactIds.some((factId) => claim.sourceFactIds.includes(factId)));
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

function declarationCoversOccurrence(renderedText: string, declarationText: string, matchStart: number, matchEnd: number) {
  const rendered = canonicalTextWithOffsets(renderedText);
  const declaration = normalizedText(declarationText);
  if (!declaration) return false;
  let index = rendered.text.indexOf(declaration);
  while (index >= 0) {
    const start = rendered.offsets[index]?.start ?? 0;
    const end = rendered.offsets[index + declaration.length - 1]?.end ?? start;
    if (matchStart >= start && matchEnd <= end) return true;
    index = rendered.text.indexOf(declaration, index + 1);
  }
  return false;
}

function canonicalTextWithOffsets(value: string) {
  let text = "";
  const offsets: Array<{ start: number; end: number }> = [];
  let pendingSpace: { start: number; end: number } | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const normalized = value[index].normalize("NFKC").toLocaleLowerCase("en-US");
    for (const character of normalized) {
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

function inferredKind(declaration: ClaimDeclarationV1, facts: Map<string, PublicFactV1>) {
  const kinds = declaration.sourceFactIds.map((id) => facts.get(id)?.kind).filter(Boolean);
  return kinds[0] ?? "other";
}

function isSensitive(declaration: ClaimDeclarationV1) {
  return declaration.kind === "structured_data" || gatedSensitiveClaims(declaration.text).length > 0;
}

function claimSeverity(declaration: ClaimDeclarationV1, facts: Map<string, PublicFactV1>): ArtifactGateFinding["severity"] {
  const referenced = declaration.sourceFactIds.map((id) => facts.get(id));
  if (referenced.some((fact) => !fact)) return "error";
  if (isSensitive(declaration) || concreteVerifiableAssertion(declaration.text)) return "error";
  if (referenced.some((fact) => fact && ["phone", "email", "address", "hours", "offering", "service_area", "proof"].includes(fact.kind))) return "error";
  return "warning";
}

function concreteVerifiableAssertion(value: string) {
  return /(?:\b(?:licensed|insured|certified|accredited|award(?:ed)?|family[- ]owned|since\s+\d{4}|serv(?:e|es|ing)\s+[A-Z]|warranty|guarantee|24\s*\/\s*7|open\s+\d|same[- ]day|free\s+(?:estimate|consultation))\b|\$\s?\d|\b\d+(?:\.\d+)?\s*(?:years?|stars?|miles?)\b|@|\b\d{3}[-.)\s]+\d{3}[-.\s]+\d{4}\b)/i.test(value);
}

function factDisplayValues(fact: PublicFactV1): string[] {
  return flattenDisplayValues(fact.value).filter(Boolean);
}

function flattenDisplayValues(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenDisplayValues);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const joined = Object.values(record).flatMap(flattenDisplayValues).join(" ").trim();
  return [...Object.values(record).flatMap(flattenDisplayValues), ...(joined ? [joined] : [])];
}

function visibleText(html: string) {
  const document = parseDocument(html, { decodeEntities: true });
  for (const node of DomUtils.findAll((candidate) => candidate.type === "script" || candidate.type === "style", document.children)) {
    DomUtils.removeElement(node);
  }
  return textNodeContent(document.children);
}

function textNodeContent(nodes: AnyNode[]) {
  const parts: string[] = [];
  const visit = (items: AnyNode[]) => {
    for (const node of items) {
      if (node.type === "text") parts.push(node.data);
      else if ("children" in node && Array.isArray(node.children)) visit(node.children);
    }
  };
  visit(nodes);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function sameClaimValue(claim: string, rendered: string, kind: string) {
  if (kind === "phone") return comparableDigits(rendered).includes(comparableDigits(claim).slice(-7));
  if (kind === "email") return rendered.toLowerCase().includes(claim.toLowerCase());
  return normalizedText(rendered).includes(normalizedText(claim));
}

function normalizedText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function comparableDigits(value: string) {
  return value.replace(/\D/g, "");
}

function claimFinding(id: string, message: string, route?: string, severity: ArtifactGateFinding["severity"] = "error"): ArtifactGateFinding {
  return { id, severity, area: "claim", message, ...(route ? { route } : {}) };
}

function dedupeDeclarations(declarations: ClaimDeclarationV1[]) {
  const seen = new Set<string>();
  return declarations.filter((item) => {
    const key = `${item.route}:${normalizedText(item.text)}:${item.sourceFactIds.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
