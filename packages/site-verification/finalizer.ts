import { DomUtils, parseDocument } from "htmlparser2";
import {
  siteBuildArtifactSchema,
  type FactBinding,
  type SiteBuildArtifact,
  type SitePublicBuildInput
} from "@/packages/site-contracts";
import { sha256, stableJson } from "@/packages/business-data";
import { FactBindingValidator } from "./fact-declarations";
import {
  agentAuthoredArtifactSchema,
  normalizeRoutePath,
  type AgentAuthoredArtifact,
  type ArtifactGateFinding
} from "./contracts";
import { sanitizeAgentCss, sanitizeAgentHtml } from "./sanitizer";
import { platformCapabilityStyles } from "../../workers/site-sandbox/scaffold/platform/capability-styles";

export type PreparedArtifactFile = {
  path: string;
  contentType: "text/html; charset=utf-8" | "text/css; charset=utf-8";
  bytes: Buffer;
};

export type PreparedSiteArtifact = {
  authored: AgentAuthoredArtifact;
  files: PreparedArtifactFile[];
  routes: Array<{ path: string; htmlFile: string; title: string; description: string; html: string }>;
  factBindings: FactBinding[];
  capabilityBindings: AgentAuthoredArtifact["capabilityBindings"];
  findings: ArtifactGateFinding[];
  qualityMetrics: {
    routeSimilarity: Array<{ left: string; right: string; jaccard: number; smallerPageContainment: number }>;
  };
};

export type BrowserGateResult = {
  findings: ArtifactGateFinding[];
  screenshotKeys: string[];
  routesChecked: number;
  linksChecked: number;
};

export function prepareSiteArtifact(input: {
  authoredArtifact: AgentAuthoredArtifact;
  buildInput: SitePublicBuildInput;
  runtimeSeriesId: string;
}) {
  const authored = agentAuthoredArtifactSchema.parse(input.authoredArtifact);
  const routes = new Set(authored.routes.map((route) => normalizeRoutePath(route.path)));
  const allowedFormIds = new Set(input.buildInput.forms.map((form) => form.id));
  const allowedExternalHrefs = allowedExternalHrefsFor(input.buildInput);
  const allowedPhoneNumbers = new Set(input.buildInput.publicFacts.filter((fact) => fact.kind === "phone").map((fact) => comparablePhone(String(fact.value))));
  const allowedEmailAddresses = new Set(input.buildInput.publicFacts.filter((fact) => fact.kind === "email").map((fact) => String(fact.value).trim().toLowerCase()));
  const cssResult = sanitizeAgentCss(authored.sharedCss, input.buildInput.business.assets);
  const finalCss = `${platformCapabilityStyles}\n${cssResult.css}`;
  const findings: ArtifactGateFinding[] = [...cssResult.findings];
  for (const page of input.buildInput.intent.pageRequirements.filter((item) => item.required)) {
    const requiredRoute = normalizeRoutePath(page.slug ? `/${page.slug}` : "/");
    if (!routes.has(requiredRoute)) findings.push(gateFinding("route.required", "route", `Requested route ${requiredRoute} is missing.`, requiredRoute, "warning"));
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
  findings.push(...validateManagedForms(sanitized, input.buildInput));
  const factBindings = new FactBindingValidator().validate({
    routes: sanitized.map((route) => ({ path: route.path, html: route.bodyHtml, title: route.title, description: route.description })),
    buildInput: input.buildInput
  });
  findings.push(...factBindings.findings);
  const qualityMetrics = { routeSimilarity: routeSimilarityMetrics(sanitized) };
  findings.push(...validateSiteStructure({ routes: sanitized, bindings: factBindings.bindings, buildInput: input.buildInput, similarities: qualityMetrics.routeSimilarity }));

  const structured = structuredDataFor(input.buildInput);
  const structuredBindings = structured.factBindings;
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
    { path: "site.css", contentType: "text/css; charset=utf-8", bytes: Buffer.from(finalCss) },
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
    factBindings: [...factBindings.bindings, ...structuredBindings],
    capabilityBindings,
    findings: dedupeFindings(findings),
    qualityMetrics
  } satisfies PreparedSiteArtifact;
}

export function finalizePreparedArtifact(input: {
  prepared: PreparedSiteArtifact;
  buildInput: SitePublicBuildInput;
  artifactId: string;
  workspaceRevisionId: string;
  runtimeSeriesId: string;
  runtimePatchId: string;
  storagePrefix: string;
  toolchainVersion: string;
  sandboxImageDigest: `sha256:${string}`;
  browserGate: BrowserGateResult;
  createdAt?: string;
}): { artifact: SiteBuildArtifact; files: PreparedArtifactFile[]; qualityMetrics: PreparedSiteArtifact["qualityMetrics"] } {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const findings = dedupeFindings([
    ...input.prepared.findings,
    ...input.browserGate.findings
  ]);
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
    factBindings: input.prepared.factBindings,
    capabilityBindings: input.prepared.capabilityBindings,
    runtimeSeriesId: input.runtimeSeriesId
  }));
  const hardGate = findings.some((finding) => finding.severity === "error") ? "failed" as const : "passed" as const;
  const artifact = siteBuildArtifactSchema.parse({
    schemaVersion: 1,
    id: input.artifactId,
    siteId: input.buildInput.siteId,
    workspaceRevisionId: input.workspaceRevisionId,
    publicBuildInputId: input.buildInput.id,
    createdAt,
    artifactHash,
    storagePrefix: input.storagePrefix,
    files: fileRecords,
    routes: input.prepared.routes.map(({ path, htmlFile, title, description }) => ({ path, htmlFile, title, description })),
    factBindings: input.prepared.factBindings,
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
  return { artifact, files: input.prepared.files, qualityMetrics: input.prepared.qualityMetrics };
}

function validateSiteStructure(input: {
  routes: Array<{ path: string; title: string; description: string; bodyHtml: string }>;
  bindings: FactBinding[];
  buildInput: SitePublicBuildInput;
  similarities: Array<{ left: string; right: string; jaccard: number; smallerPageContainment: number }>;
}) {
  const findings: ArtifactGateFinding[] = [];
  const metadata = new Map<string, string>();
  for (const route of input.routes) {
    for (const [kind, value] of [["title", route.title], ["description", route.description]] as const) {
      const key = `${kind}:${normalizeText(value)}`;
      const prior = metadata.get(key);
      if (prior) findings.push(gateFinding(`metadata.${kind}_duplicate`, "metadata", `${kind === "title" ? "Title" : "Description"} duplicates ${prior}.`, route.path, "warning"));
      else metadata.set(key, route.path);
    }
  }
  const linkedRoutes = new Set(input.routes.flatMap((route) =>
    internalRouteLinks(route.bodyHtml).filter((destination) => destination !== route.path)));
  for (const route of input.routes) {
    if (route.path !== "/" && !linkedRoutes.has(route.path)) {
      findings.push(gateFinding("route.orphan", "route", `Declared route ${route.path} has no inbound link from another site route.`, route.path, "warning"));
    }
  }
  const purposeByRoute = new Map(input.buildInput.intent.pageRequirements.map((page) => [
    normalizeRoutePath(page.slug ? `/${page.slug}` : "/"),
    page.purpose
  ]));
  for (const route of input.routes.filter((candidate) => purposeByRoute.get(candidate.path) === "service")) {
    const words = visibleMainWordCount(route.bodyHtml);
    if (words < 150) {
      findings.push(gateFinding(
        "route.thin_service_content",
        "route",
        `Dedicated service-page main content contains ${words} words; target at least 150 substantive words excluding shared navigation and footer content.`,
        route.path,
        "warning"
      ));
    }
  }
  for (const requirement of input.buildInput.intent.pageRequirements.filter((page) => page.required && page.purpose === "service" && page.offeringId)) {
    const routePath = normalizeRoutePath(requirement.slug ? `/${requirement.slug}` : "/");
    const route = input.routes.find((candidate) => candidate.path === routePath);
    const offering = input.buildInput.business.offerings.find((candidate) => candidate.id === requirement.offeringId);
    if (!route || !offering || offering.status !== "confirmed" || offering.visibility !== "public") continue;
    const factIds = new Set(offering.sourceFactIds);
    const boundInHtml = [...factIds].some((factId) => route.bodyHtml.includes(`data-lodesta-fact-id="${factId}"`));
    const boundInFact = input.bindings.some((binding) => normalizeRoutePath(binding.route) === routePath && binding.sourceFactIds.some((factId) => factIds.has(factId)));
    if (!boundInHtml && !boundInFact) findings.push(gateFinding("fact.service_detail_source", "claim", `Service page ${routePath} must render source-bound detail for ${offering.name}.`, routePath));
  }
  for (const similarity of input.similarities) {
    if (similarity.jaccard >= 0.9 || similarity.smallerPageContainment >= 0.95) {
      findings.push(gateFinding(
        "route.repetitive_content",
        "route",
        `Route content is too repetitive with ${similarity.left}: five-word-shingle Jaccard ${similarity.jaccard.toFixed(3)}, smaller-page containment ${similarity.smallerPageContainment.toFixed(3)}.`,
        similarity.right,
        "warning"
      ));
    }
  }
  return findings;
}

function routeSimilarityMetrics(routes: Array<{ path: string; bodyHtml: string }>) {
  const values = routes.map((route) => ({ path: route.path, shingles: fiveWordShingles(visibleBodyText(route.bodyHtml)) }));
  const result: Array<{ left: string; right: string; jaccard: number; smallerPageContainment: number }> = [];
  for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
      const left = values[leftIndex];
      const right = values[rightIndex];
      if (!left.shingles.size || !right.shingles.size) continue;
      const intersection = [...left.shingles].filter((shingle) => right.shingles.has(shingle)).length;
      const union = new Set([...left.shingles, ...right.shingles]).size;
      result.push({
        left: left.path,
        right: right.path,
        jaccard: intersection / union,
        smallerPageContainment: intersection / Math.min(left.shingles.size, right.shingles.size)
      });
    }
  }
  return result;
}

function visibleBodyText(html: string) {
  const document = parseDocument(html, { decodeEntities: true });
  for (const node of DomUtils.findAll((candidate) => candidate.type === "tag" && ["script", "style", "svg", "noscript"].includes(candidate.name), document.children)) {
    if (node.type === "tag") DomUtils.removeElement(node);
  }
  return DomUtils.textContent(document).replace(/\s+/g, " ").trim();
}

function visibleMainWordCount(html: string) {
  const document = parseDocument(html, { decodeEntities: true });
  const main = DomUtils.findOne((candidate) => candidate.type === "tag" && candidate.name === "main", document.children);
  const roots = main?.type === "tag" ? main.children : document.children;
  for (const node of DomUtils.findAll(
    (candidate) => candidate.type === "tag" && ["script", "style", "svg", "noscript", "header", "nav", "footer"].includes(candidate.name),
    roots
  )) {
    if (node.type === "tag") DomUtils.removeElement(node);
  }
  return normalizeText(DomUtils.textContent(roots)).split(" ").filter(Boolean).length;
}

function fiveWordShingles(value: string) {
  const words = normalizeText(value).split(" ").filter(Boolean);
  const shingles = new Set<string>();
  for (let index = 0; index <= words.length - 5; index += 1) shingles.add(words.slice(index, index + 5).join(" "));
  return shingles;
}

function internalRouteLinks(html: string) {
  const document = parseDocument(html, { decodeEntities: true });
  return DomUtils.findAll((node) => node.type === "tag" && node.name === "a", document.children).flatMap((node) => {
    if (node.type !== "tag") return [];
    const href = node.attribs.href;
    if (!href?.startsWith("/") || href.startsWith("/_lodesta/") || href.startsWith("/api/")) return [];
    return [normalizeRoutePath(new URL(href, "https://site.invalid").pathname)];
  });
}

function normalizeText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function validateCapabilityBindings(artifact: AgentAuthoredArtifact, buildInput: SitePublicBuildInput) {
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

function validateManagedForms(
  routes: Array<{ path: string; bodyHtml: string }>,
  buildInput: SitePublicBuildInput
) {
  const findings: ArtifactGateFinding[] = [];
  const definitions = new Map(buildInput.forms.map((form) => [form.id, form]));
  for (const route of routes) {
    const document = parseDocument(route.bodyHtml, { decodeEntities: true });
    const forms = DomUtils.findAll((node) => node.type === "tag" && node.name === "form" && Boolean(node.attribs["data-lodesta-form-id"]), document.children);
    for (const form of forms) {
      if (form.type !== "tag") continue;
      const formId = form.attribs["data-lodesta-form-id"];
      const definition = definitions.get(formId);
      if (!definition) continue;
      const controls = DomUtils.findAll(
        (node) => node.type === "tag" && ["input", "textarea", "select"].includes(node.name),
        form.children
      );
      const counts = new Map<string, number>();
      for (const control of controls) {
        const fieldId = control.attribs["data-lodesta-field-id"];
        if (!fieldId) continue;
        counts.set(fieldId, (counts.get(fieldId) ?? 0) + 1);
        const id = control.attribs.id;
        const label = id
          ? DomUtils.findOne((node) => node.type === "tag" && node.name === "label" && node.attribs.for === id, form.children)
          : undefined;
        if (!id || !label) {
          findings.push(gateFinding("capability.form_label", "capability", `Field ${fieldId} in form ${formId} must have a label associated by for/id.`, route.path));
        }
      }
      const expected = new Set(definition.fields.map((field) => field.id));
      for (const field of definition.fields) {
        if ((counts.get(field.id) ?? 0) !== 1) {
          findings.push(gateFinding("capability.form_field_count", "capability", `Form ${formId} must render field ${field.id} exactly once.`, route.path));
        }
      }
      for (const fieldId of counts.keys()) {
        if (!expected.has(fieldId)) {
          findings.push(gateFinding("capability.form_unknown_field", "capability", `Form ${formId} renders unknown field ${fieldId}.`, route.path));
        }
      }
      const submits = DomUtils.findAll(
        (node) => node.type === "tag"
          && ((node.name === "button" && node.attribs.type === "submit") || (node.name === "input" && node.attribs.type === "submit")),
        form.children
      );
      if (submits.length !== 1) {
        findings.push(gateFinding("capability.form_submit_count", "capability", `Form ${formId} must render exactly one submit control.`, route.path));
      }
      const statuses = DomUtils.findAll(
        (node) => node.type === "tag" && node.attribs["data-lodesta-form-status"] !== undefined && node.attribs["aria-live"] === "polite",
        form.children
      );
      if (statuses.length !== 1) {
        findings.push(gateFinding("capability.form_status", "capability", `Form ${formId} must contain exactly one polite live status node.`, route.path));
      }
    }
  }
  return findings;
}

function structuredDataFor(buildInput: SitePublicBuildInput) {
  if (buildInput.business.identityStatus !== "verified") {
    return { value: undefined, factBindings: [] as FactBinding[] };
  }
  const facts = new Map(buildInput.publicFacts.map((fact) => [fact.kind, fact]));
  const nameFact = facts.get("business_name");
  if (!nameFact) return { value: undefined, factBindings: [] as FactBinding[] };
  const location = buildInput.business.locations[0];
  const value: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": buildInput.domainContext?.structuredDataType ?? "LocalBusiness",
    name: buildInput.business.name
  };
  const factBindings: FactBinding[] = [];
  addStructuredFact(value, factBindings, "/", "name", nameFact);
  addStructuredFact(value, factBindings, "/", "telephone", facts.get("phone"));
  addStructuredFact(value, factBindings, "/", "email", facts.get("email"));
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
        factBindings.push(structuredBinding(`jsonld:address:${key}`, String(item), addressFact.id));
      }
    }
  }
  const offeringFacts = buildInput.publicFacts.filter((fact) => fact.kind === "offering");
  if (offeringFacts.length) {
    value.makesOffer = offeringFacts.map((fact) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: String(fact.value) } }));
    for (const fact of offeringFacts) factBindings.push(structuredBinding(`jsonld:offering:${fact.id}`, String(fact.value), fact.id));
  }
  return { value, factBindings };
}

function addStructuredFact(
  target: Record<string, unknown>,
  factBindings: FactBinding[],
  route: string,
  key: string,
  fact: SitePublicBuildInput["publicFacts"][number] | undefined
) {
  if (!fact) return;
  const value = typeof fact.value === "string" ? fact.value : String(fact.value);
  target[key] = value;
  factBindings.push({ ...structuredBinding(`jsonld:${key}`, value, fact.id), route });
}

function structuredBinding(id: string, text: string, factId: string): FactBinding {
  return { id, route: "/", text, origin: "structured_data", sourceFactIds: [factId] };
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

function allowedExternalHrefsFor(buildInput: SitePublicBuildInput) {
  const values = [
    ...buildInput.business.links.map((link) => link.url),
    ...buildInput.business.locations.map(mapHrefForLocation)
  ];
  return new Set(values.map((value) => new URL(value).toString()));
}

function mapHrefForLocation(location: SitePublicBuildInput["business"]["locations"][number]) {
  const address = [location.street, location.city, location.region, location.postalCode].filter(Boolean).join(", ");
  const query = address || location.label;
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

function gateFinding(
  id: string,
  area: ArtifactGateFinding["area"],
  message: string,
  route?: string,
  severity: ArtifactGateFinding["severity"] = "error"
): ArtifactGateFinding {
  return { id, severity, area, message, ...(route ? { route } : {}) };
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
