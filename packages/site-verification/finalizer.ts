import { DomUtils, parseDocument } from "htmlparser2";
import {
  siteBuildArtifactV1Schema,
  type ClaimDeclarationV1,
  type SiteBuildArtifactV1,
  type SitePublicBuildInputV1
} from "@/packages/site-contracts";
import { sha256, stableJson } from "@/packages/business-data";
import { ArtifactClaimValidatorV1 } from "./artifact-claims";
import {
  agentAuthoredArtifactSchema,
  normalizeRoutePath,
  type AgentAuthoredArtifactV1,
  type ArtifactGateFinding
} from "./contracts";
import { sanitizeAgentCss, sanitizeAgentHtml } from "./sanitizer";

export type PreparedArtifactFile = {
  path: string;
  contentType: "text/html; charset=utf-8" | "text/css; charset=utf-8";
  bytes: Buffer;
};

export type PreparedSiteArtifactV1 = {
  authored: AgentAuthoredArtifactV1;
  files: PreparedArtifactFile[];
  routes: Array<{ path: string; htmlFile: string; title: string; description: string; html: string }>;
  claims: ClaimDeclarationV1[];
  capabilityBindings: AgentAuthoredArtifactV1["capabilityBindings"];
  findings: ArtifactGateFinding[];
};

export type BrowserGateResult = {
  findings: ArtifactGateFinding[];
  screenshotKeys: string[];
  routesChecked: number;
  linksChecked: number;
};

export function prepareSiteArtifact(input: {
  authoredArtifact: AgentAuthoredArtifactV1;
  buildInput: SitePublicBuildInputV1;
  runtimeSeriesId: string;
}) {
  const authored = agentAuthoredArtifactSchema.parse(input.authoredArtifact);
  const routes = new Set(authored.routes.map((route) => normalizeRoutePath(route.path)));
  const allowedFormIds = new Set(input.buildInput.forms.map((form) => form.id));
  const allowedExternalHrefs = allowedExternalHrefsFor(input.buildInput);
  const allowedPhoneNumbers = new Set(input.buildInput.publicFacts.filter((fact) => fact.kind === "phone").map((fact) => comparablePhone(String(fact.value))));
  const allowedEmailAddresses = new Set(input.buildInput.publicFacts.filter((fact) => fact.kind === "email").map((fact) => String(fact.value).trim().toLowerCase()));
  const cssResult = sanitizeAgentCss(authored.sharedCss);
  const findings: ArtifactGateFinding[] = [...cssResult.findings];
  for (const page of input.buildInput.intent.pageRequirements.filter((item) => item.required)) {
    const requiredRoute = normalizeRoutePath(page.slug ? `/${page.slug}` : "/");
    if (!routes.has(requiredRoute)) findings.push(gateFinding("route.required", "route", `Required route ${requiredRoute} is missing.`, requiredRoute));
  }
  for (const route of authored.routes) {
    if (/<(?:script|style)\b/i.test(route.bodyHtml)) {
      findings.push(gateFinding("html.agent_executable", "html", "Agent-authored script and style elements are forbidden.", normalizeRoutePath(route.path)));
    }
  }
  const sanitized = authored.routes.map((route) => {
    const path = normalizeRoutePath(route.path);
    const result = sanitizeAgentHtml({
      route: path,
      bodyHtml: route.bodyHtml,
      declaredRoutes: routes,
      assets: input.buildInput.business.assets,
      allowedFormIds,
      allowedExternalHrefs,
      allowedPhoneNumbers,
      allowedEmailAddresses
    });
    findings.push(...result.findings);
    return { ...route, path, bodyHtml: result.html };
  });

  findings.push(...validateCapabilityBindings(authored, input.buildInput));
  const claims = new ArtifactClaimValidatorV1().validate({
    routes: sanitized.map((route) => ({ path: route.path, html: route.bodyHtml, title: route.title, description: route.description })),
    declarations: authored.claims,
    buildInput: input.buildInput
  });
  findings.push(...claims.findings);

  const structured = structuredDataFor(input.buildInput);
  const structuredClaims = structured.claims;
  const platformBindings = input.buildInput.intent.enabledCapabilities.includes("analytics")
    ? sanitized.map((route, index) => ({ id: `capability_analytics_${index + 1}`, kind: "analytics" as const, route: route.path, config: {} }))
    : [];
  const capabilityBindings = [...authored.capabilityBindings, ...platformBindings];
  const routeOutputs = sanitized.map((route) => {
    const jsonLd = route.path === "/" ? structured.value : undefined;
    const bodyHtml = rewriteInternalLinks(route.bodyHtml, route.path);
    const html = documentHtml({
      title: route.title,
      description: route.description,
      cssPath: relativeSitePath(route.path, "site.css"),
      bodyHtml,
      jsonLd,
      runtimeSeriesId: input.runtimeSeriesId,
      siteId: input.buildInput.siteId,
      analyticsEnabled: input.buildInput.intent.enabledCapabilities.includes("analytics")
    });
    findings.push(...validateFinalDocument(route.path, html, input.runtimeSeriesId));
    return {
      path: route.path,
      htmlFile: htmlFileForRoute(route.path),
      title: route.title,
      description: route.description,
      html
    };
  });
  const files: PreparedArtifactFile[] = [
    { path: "site.css", contentType: "text/css; charset=utf-8", bytes: Buffer.from(cssResult.css) },
    ...routeOutputs.map((route) => ({
      path: route.htmlFile,
      contentType: "text/html; charset=utf-8" as const,
      bytes: Buffer.from(route.html)
    }))
  ];

  return {
    authored,
    files,
    routes: routeOutputs,
    claims: [...claims.declarations, ...structuredClaims],
    capabilityBindings,
    findings: dedupeFindings(findings)
  } satisfies PreparedSiteArtifactV1;
}

export function finalizePreparedArtifact(input: {
  prepared: PreparedSiteArtifactV1;
  buildInput: SitePublicBuildInputV1;
  artifactId: string;
  workspaceRevisionId: string;
  runtimeSeriesId: string;
  runtimePatchId: string;
  storagePrefix: string;
  toolchainVersion: string;
  sandboxImageDigest: `sha256:${string}`;
  browserGate: BrowserGateResult;
  createdAt?: string;
}): { artifact: SiteBuildArtifactV1; files: PreparedArtifactFile[] } {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const findings = dedupeFindings([...input.prepared.findings, ...input.browserGate.findings]);
  const fileRecords = input.prepared.files.map((file) => ({
    path: file.path,
    contentType: file.contentType,
    contentHash: sha256(file.bytes),
    bytes: file.bytes.byteLength,
    storageKey: `${input.storagePrefix.replace(/\/$/, "")}/${file.path}`
  }));
  const artifactHash = sha256(stableJson({
    files: fileRecords.map(({ path, contentType, contentHash, bytes }) => ({ path, contentType, contentHash, bytes })),
    routes: input.prepared.routes.map(({ path, htmlFile, title, description }) => ({ path, htmlFile, title, description })),
    claims: input.prepared.claims,
    capabilityBindings: input.prepared.capabilityBindings,
    runtimeSeriesId: input.runtimeSeriesId
  }));
  const hardGate = findings.some((finding) => finding.severity === "error") ? "failed" as const : "passed" as const;
  const artifact = siteBuildArtifactV1Schema.parse({
    schemaVersion: "site-build-artifact-v1",
    id: input.artifactId,
    siteId: input.buildInput.siteId,
    workspaceRevisionId: input.workspaceRevisionId,
    publicBuildInputId: input.buildInput.id,
    createdAt,
    artifactHash,
    storagePrefix: input.storagePrefix,
    files: fileRecords,
    routes: input.prepared.routes.map(({ path, htmlFile, title, description }) => ({ path, htmlFile, title, description })),
    claims: input.prepared.claims,
    capabilityBindings: input.prepared.capabilityBindings,
    runtimeSeriesId: input.runtimeSeriesId,
    runtimePatchAtFinalization: input.runtimePatchId,
    toolchainVersion: input.toolchainVersion,
    sandboxImageDigest: input.sandboxImageDigest,
    qa: {
      hardGate,
      checkedAt: createdAt,
      routesChecked: input.browserGate.routesChecked,
      linksChecked: input.browserGate.linksChecked,
      findings,
      screenshotKeys: input.browserGate.screenshotKeys
    }
  });
  return { artifact, files: input.prepared.files };
}

function validateCapabilityBindings(artifact: AgentAuthoredArtifactV1, buildInput: SitePublicBuildInputV1) {
  const findings: ArtifactGateFinding[] = [];
  const routes = new Set(artifact.routes.map((route) => normalizeRoutePath(route.path)));
  const forms = new Set(buildInput.forms.map((form) => form.id));
  const locations = new Set(buildInput.business.locations.map((location) => location.id));
  const enabled = new Set(buildInput.intent.enabledCapabilities);
  for (const binding of artifact.capabilityBindings) {
    if (!routes.has(normalizeRoutePath(binding.route))) {
      findings.push(gateFinding("capability.route", "capability", `Capability ${binding.id} references an unavailable route.`, binding.route));
    }
    if (binding.kind === "form" && (!enabled.has("forms") || !forms.has(String(binding.config.formId ?? "")))) {
      findings.push(gateFinding("capability.form", "capability", `Form capability ${binding.id} is not eligible.`, binding.route));
    }
    if (binding.kind === "map" && !enabled.has("maps")) {
      findings.push(gateFinding("capability.map", "capability", `Map capability ${binding.id} is not enabled.`, binding.route));
    }
    if (binding.kind === "map" && !locations.has(String(binding.config.locationId ?? ""))) {
      findings.push(gateFinding("capability.map_location", "capability", `Map capability ${binding.id} references an unavailable location.`, binding.route));
    }
    if (binding.kind === "gallery" && !enabled.has("gallery")) {
      findings.push(gateFinding("capability.gallery", "capability", `Gallery capability ${binding.id} is not enabled.`, binding.route));
    }
    if (binding.kind === "disclosure" && !enabled.has("disclosure")) {
      findings.push(gateFinding("capability.disclosure", "capability", `Disclosure capability ${binding.id} is not enabled.`, binding.route));
    }
  }
  return findings;
}

function structuredDataFor(buildInput: SitePublicBuildInputV1) {
  const facts = new Map(buildInput.publicFacts.map((fact) => [fact.kind, fact]));
  const location = buildInput.business.locations[0];
  const value: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": buildInput.verticalModule.structuredDataType,
    name: buildInput.business.name
  };
  const claims: ClaimDeclarationV1[] = [];
  addStructuredFact(value, claims, "/", "name", facts.get("business_name"));
  addStructuredFact(value, claims, "/", "telephone", facts.get("phone"));
  addStructuredFact(value, claims, "/", "email", facts.get("email"));
  if (location) {
    const addressFact = facts.get("address");
    if (addressFact) {
      value.address = {
        "@type": "PostalAddress",
        streetAddress: location.street,
        addressLocality: location.city,
        addressRegion: location.region,
        postalCode: location.postalCode,
        addressCountry: location.country
      };
      for (const [key, item] of Object.entries(value.address as Record<string, unknown>)) {
        if (key === "@type" || item === undefined) continue;
        claims.push(structuredClaim(`jsonld:address:${key}`, String(item), addressFact.id));
      }
    }
  }
  const offeringFacts = buildInput.publicFacts.filter((fact) => fact.kind === "offering");
  if (offeringFacts.length) {
    value.makesOffer = offeringFacts.map((fact) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: String(fact.value) } }));
    for (const fact of offeringFacts) claims.push(structuredClaim(`jsonld:offering:${fact.id}`, String(fact.value), fact.id));
  }
  return { value, claims };
}

function addStructuredFact(
  target: Record<string, unknown>,
  claims: ClaimDeclarationV1[],
  route: string,
  key: string,
  fact: SitePublicBuildInputV1["publicFacts"][number] | undefined
) {
  if (!fact) return;
  const value = typeof fact.value === "string" ? fact.value : String(fact.value);
  target[key] = value;
  claims.push({ ...structuredClaim(`jsonld:${key}`, value, fact.id), route });
}

function structuredClaim(id: string, text: string, factId: string): ClaimDeclarationV1 {
  return { id, route: "/", text, kind: "structured_data", sourceFactIds: [factId], autoDeclared: true };
}

function documentHtml(input: {
  title: string;
  description: string;
  cssPath: string;
  bodyHtml: string;
  jsonLd?: Record<string, unknown>;
  runtimeSeriesId: string;
  siteId: string;
  analyticsEnabled: boolean;
}) {
  const structured = input.jsonLd
    ? `<script type="application/ld+json">${escapeScript(JSON.stringify(input.jsonLd))}</script>`
    : "";
  return `<!doctype html><html lang="en" data-lodesta-site-id="${escapeAttribute(input.siteId)}" data-lodesta-analytics="${input.analyticsEnabled ? "true" : "false"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title><meta name="description" content="${escapeAttribute(input.description)}"><link rel="stylesheet" href="${input.cssPath}">${structured}<script src="/_lodesta/runtime/${encodeURIComponent(input.runtimeSeriesId)}.js" defer data-lodesta-runtime="${escapeAttribute(input.runtimeSeriesId)}"></script></head><body>${input.bodyHtml}</body></html>`;
}

function allowedExternalHrefsFor(buildInput: SitePublicBuildInputV1) {
  const values = [
    ...buildInput.business.links.map((link) => link.url),
    ...buildInput.business.locations.map(mapHrefForLocation)
  ];
  return new Set(values.map((value) => new URL(value).toString()));
}

function mapHrefForLocation(location: SitePublicBuildInputV1["business"]["locations"][number]) {
  const address = [location.street, location.city, location.region, location.postalCode].filter(Boolean).join(", ");
  const query = location.googlePlaceId ? `place_id:${location.googlePlaceId}` : address || location.label;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function comparablePhone(value: string) {
  return value.replace(/\D/g, "").slice(-10);
}

function validateFinalDocument(route: string, html: string, runtimeSeriesId: string) {
  const findings: ArtifactGateFinding[] = [];
  const document = parseDocument(html, { decodeEntities: true });
  const scripts = DomUtils.findAll((node) => node.type === "script", document.children);
  const executable = scripts.filter((script) => script.type === "script" && script.attribs.type !== "application/ld+json");
  if (executable.length !== 1) {
    findings.push(gateFinding("html.runtime_count", "html", "Final document must contain exactly one trusted executable runtime.", route));
  } else {
    const expected = `/_lodesta/runtime/${encodeURIComponent(runtimeSeriesId)}.js`;
    if (executable[0].type !== "script" || executable[0].attribs.src !== expected || DomUtils.textContent(executable[0]).trim()) {
      findings.push(gateFinding("html.runtime_identity", "html", "Final executable script is not the selected trusted runtime series.", route));
    }
  }
  return findings;
}

function htmlFileForRoute(route: string) {
  return route === "/" ? "index.html" : `${route.replace(/^\//, "")}/index.html`;
}

function rewriteInternalLinks(bodyHtml: string, route: string) {
  const document = parseDocument(bodyHtml, { decodeEntities: true });
  const links = DomUtils.findAll((node) => node.type === "tag" && node.name === "a", document.children);
  for (const link of links) {
    if (link.type !== "tag") continue;
    const href = link.attribs.href;
    if (!href?.startsWith("/") || href.startsWith("/_lodesta/") || href.startsWith("/api/")) continue;
    const parsed = new URL(href, "https://site.invalid");
    link.attribs.href = `${relativeSitePath(route, parsed.pathname)}${parsed.search}${parsed.hash}`;
  }
  return DomUtils.getInnerHTML(document);
}

function relativeSitePath(fromRoute: string, target: string) {
  const depth = fromRoute.split("/").filter(Boolean).length;
  const prefix = "../".repeat(depth);
  const cleanTarget = target.replace(/^\/+|\/+$/g, "");
  if (!cleanTarget) return prefix || "./";
  const suffix = target.endsWith(".css") ? "" : "/";
  return `${prefix}${cleanTarget}${suffix}`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function escapeScript(value: string) {
  return value.replace(/<\//g, "<\\/");
}

function gateFinding(id: string, area: ArtifactGateFinding["area"], message: string, route?: string): ArtifactGateFinding {
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
