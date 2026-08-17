import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DomUtils, parseDocument } from "htmlparser2";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { isCustomerPortalLink, sha256 } from "@/packages/business-data";
import type { ArtifactBlobStore } from "@/packages/site-artifacts/blob-store";
import type { SitePublicBuildInput } from "@/packages/site-contracts";
import { isTechnicalReleaseBlocker, type PreparedSiteArtifact } from "./finalizer";
import type { ArtifactGateFinding } from "./contracts";
import { inspectNavigationReachability } from "./navigation-reachability";
import { trustedFontFiles } from "../../workers/site-sandbox/scaffold/platform/font-library";
import { buildSiteRuntimeBytes } from "@/packages/trusted-runtime";

export type BrowserGateCapture = {
  key: string;
  route: string;
  viewport: "desktop" | "tablet" | "mobile";
  stage?: "natural" | "settled";
  frame?: "top" | "middle" | "bottom" | "overview" | "focus" | "navigation";
  focusSelector?: string;
  pageState?: {
    scrollX: number;
    scrollY: number;
    header?: { top: number; bottom: number; width: number; height: number };
  };
  bytes: Buffer;
};

export type FullBrowserGateResult = {
  findings: ArtifactGateFinding[];
  captures: BrowserGateCapture[];
  allRoutesChecked: number;
  routesChecked: number;
  linksChecked: number;
};

export type BrowserVerificationUnavailableDetails = {
  component: "axe-core";
  stage: "preload" | "readiness";
  attempt: 1 | 2;
  route: string;
  viewport: "mobile";
  browserVersion: string;
  expectedVersion: string;
  detectedVersion?: string;
  sourceHash: `sha256:${string}`;
  consoleErrors: string[];
  cause?: string;
};

export class BrowserVerificationUnavailableError extends Error {
  readonly name = "BrowserVerificationUnavailableError";

  constructor(readonly details: BrowserVerificationUnavailableDetails) {
    super(`browser_verification_unavailable:${JSON.stringify(details)}`);
  }
}

export type BrowserVerificationInfrastructureDetails = {
  stage: "startup" | "navigation" | "inspection";
  route?: string;
  viewport?: BrowserGateCapture["viewport"];
  attempts: 1 | 2;
  cause: string;
};

export class BrowserVerificationInfrastructureError extends Error {
  readonly name = "BrowserVerificationInfrastructureError";

  constructor(readonly details: BrowserVerificationInfrastructureDetails) {
    super(`browser_verification_unavailable:${JSON.stringify(details)}`);
  }
}

export type BrowserGateViewport = {
  name: "desktop" | "tablet" | "mobile";
  width: number;
  height: number;
};

export const defaultBrowserGateViewports: readonly BrowserGateViewport[] = [
  { name: "desktop" as const, width: 1280, height: 900 },
  { name: "tablet" as const, width: 768, height: 1024 },
  { name: "mobile" as const, width: 390, height: 844 }
];

export async function runArtifactBrowserGate(input: {
  prepared: PreparedSiteArtifact;
  buildInput: SitePublicBuildInput;
  blobStore: ArtifactBlobStore;
  capturePrefix: string;
  routePaths?: string[];
  focusSelector?: string;
  captureMode?: "verification" | "review";
  /** Author-review/operator/test viewport override. Final verification uses the defaults. */
  viewports?: readonly BrowserGateViewport[];
  signal?: AbortSignal;
  /** Exact audited patch bytes for candidate verification. Tests may omit this and build the named series source. */
  runtimeSource?: Buffer;
}): Promise<FullBrowserGateResult> {
  try {
    return await runArtifactBrowserGateOnce(input, 1);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (error instanceof BrowserVerificationUnavailableError || startupBrowserInfrastructureError(error)) {
      return runArtifactBrowserGateOnce(input, 2);
    }
    if (error instanceof BrowserVerificationInfrastructureError) throw error;
    if (transientBrowserInfrastructureError(error)) {
      throw new BrowserVerificationInfrastructureError({
        stage: "inspection",
        attempts: 1,
        cause: browserFailureMessage(error)
      });
    }
    throw error;
  }
}

async function runArtifactBrowserGateOnce(input: {
  prepared: PreparedSiteArtifact;
  buildInput: SitePublicBuildInput;
  blobStore: ArtifactBlobStore;
  capturePrefix: string;
  routePaths?: string[];
  focusSelector?: string;
  captureMode?: "verification" | "review";
  viewports?: readonly BrowserGateViewport[];
  signal?: AbortSignal;
}, attempt: 1 | 2): Promise<FullBrowserGateResult> {
  const harness = await startHarness(input);
  let browser: Browser | undefined;
  try {
    const isAuthorReview = input.captureMode === "review";
    // Author review is a visual feedback tool, not an early release gate. The
    // final verification pass still exercises every route and functional
    // contract after authoring is complete.
    const findings = isAuthorReview
      ? []
      : await verifyEveryPreparedRoute(input.prepared, harness.origin, input.signal);
    browser = await chromium.launch({ headless: true });
    const browserVersion = browser.version();
    const captures: BrowserGateCapture[] = [];
    let linksChecked = 0;
    const selectedPaths = input.routePaths?.length
      ? new Set(input.routePaths)
      : representativeRoutePaths(input.prepared, input.buildInput);
    if (isAuthorReview) {
      findings.push(...allRouteCopyAdvisories(input.prepared, selectedPaths));
    }
    const routes = input.prepared.routes.filter((route) => selectedPaths.has(route.path));
    if (!routes.length) throw new Error("browser_gate_route_not_found");
    const configuredViewports = input.viewports ?? defaultBrowserGateViewports;
    const selectedViewports = input.captureMode === "review"
      ? configuredViewports
      : configuredViewports.filter((viewport) => viewport.name !== "tablet");
    const activeLogoRevisionIds = new Set(input.buildInput.business.assets
      .filter((asset) => asset.kind === "logo" && asset.activeForFutureBuilds)
      .map((asset) => asset.revisionId));
    const ownerLogoRevisionIds = new Set(input.buildInput.business.assets
      .filter((asset) => asset.kind === "logo" && asset.activeForFutureBuilds && asset.origin === "owner_upload")
      .map((asset) => asset.revisionId));
    const canonicalGeographyFactIds = new Set(input.buildInput.publicFacts
      .filter((fact) => fact.kind === "address" || fact.kind === "service_area")
      .map((fact) => fact.id));
    for (const route of routes) {
      // Tablet-specific shell failures are disproportionately likely between
      // wide navigation and the phone disclosure breakpoint. Exercise that
      // state once on the homepage during final verification without adding a
      // third viewport to every representative route.
      const routeViewports = !isAuthorReview && route.path === "/"
        ? configuredViewports
        : selectedViewports;
      for (const viewport of routeViewports) {
        if (input.signal?.aborted) throw new Error("workflow_deadline_exhausted");
        const page = await browser.newPage({ viewport });
        const consoleErrors: string[] = [];
        const routeFindings: ArtifactGateFinding[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") {
            consoleErrors.push(message.text());
            routeFindings.push(finding("render.console", `Console error: ${message.text()}`, route.path));
          }
        });
        page.on("pageerror", (error) => {
          consoleErrors.push(error.message);
          routeFindings.push(finding("render.page_error", `Page error: ${error.message}`, route.path));
        });
        page.on("request", (request) => {
          const requestUrl = new URL(request.url());
          if (requestUrl.origin !== harness.origin) {
            routeFindings.push(finding("render.network", `Final artifact attempted an external request to ${requestUrl.origin}.`, route.path));
          }
        });
        if (viewport.name === "mobile" && !isAuthorReview) {
          await preloadAutomatedAccessibility(page, {
            attempt,
            route: route.path,
            browserVersion,
            consoleErrors
          });
        }
        const routeUrl = `${harness.origin}${route.path === "/" ? "/" : `${route.path}/`}`;
        const response = await navigatePageWithRetry({
          page,
          url: routeUrl,
          route: route.path,
          viewport: viewport.name,
          signal: input.signal
        });
        if (!response?.ok()) routeFindings.push(finding("route.response", `Route returned ${response?.status() ?? "no response"}.`, route.path));
        const naturalMetrics = await inspectPage(page, activeLogoRevisionIds, ownerLogoRevisionIds);
        if (input.captureMode === "review" && route.path === "/" && viewport.name !== "tablet") {
          const naturalKey = `${input.capturePrefix.replace(/\/$/, "")}/${routeKey(route.path)}-${viewport.name}-natural.png`;
          captures.push({
            key: naturalKey,
            route: route.path,
            viewport: viewport.name,
            stage: "natural",
            frame: "top",
            bytes: await page.screenshot({ fullPage: false, type: "png", animations: "disabled" })
          });
        }
        if (naturalMetrics.lazyAboveFoldImageCount > 0) {
          routeFindings.push(finding(
            "render.lazy_above_fold_image",
            `${naturalMetrics.lazyAboveFoldImageCount} above-fold image(s) use loading="lazy" at ${viewport.name}. Examples: ${naturalMetrics.lazyAboveFoldImageExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        await settleImages(page);
        const metrics = await inspectPage(page, activeLogoRevisionIds, ownerLogoRevisionIds);
        const navigationReachability = await inspectNavigationReachability(page, {
          canonicalLogoRevisionIds: [...activeLogoRevisionIds]
        });
        if (viewport.name === "mobile" && !isAuthorReview) {
          routeFindings.push(...await inspectMobileCanonicalFunctionalLinks(page, input.buildInput, route.path));
        }
        if (input.captureMode === "review" && viewport.name === "mobile") {
          const openNavigation = await captureOpenNavigation(page);
          if (openNavigation) {
            captures.push({
              key: `${input.capturePrefix.replace(/\/$/, "")}/${routeKey(route.path)}-${viewport.name}-navigation.png`,
              route: route.path,
              viewport: viewport.name,
              stage: "settled",
              frame: "navigation",
              bytes: openNavigation
            });
          }
        }
        if (viewport.name === "mobile" && navigationReachability.brokenToggles.length > 0) {
          routeFindings.push(finding(
            "functional.navigation_toggle",
            `${navigationReachability.brokenToggles.length} of ${navigationReachability.toggleCount} visible mobile navigation toggle(s) did not reveal a hit-testable navigation link: ${navigationReachability.brokenToggles.join("; ")}.`,
            route.path,
            "render"
          ));
        }
        if (viewport.name === "mobile" && navigationReachability.designWarnings.length > 0) {
          routeFindings.push(finding(
            "render.mobile_navigation_design",
            `The opened mobile navigation is functional but lacks a readable, deliberate presentation: ${navigationReachability.designWarnings.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (navigationReachability.destinationCount > 0) {
          routeFindings.push(finding(
            "functional.navigation_reachability",
            navigationReachability.unreachable.length
              ? `${navigationReachability.unreachable.length} of ${navigationReachability.destinationCount} primary destination(s) were not reachable through a visible, hit-testable direct link or interactive disclosure at ${viewport.name}: ${navigationReachability.unreachable.join(", ")}.`
              : `All ${navigationReachability.destinationCount} primary destination(s) were reachable through a visible, hit-testable path at ${viewport.name}.`,
            route.path,
            "render",
            navigationReachability.unreachable.length ? "error" : "info"
          ));
        }
        if (viewport.name === "desktop" && !isAuthorReview) {
          routeFindings.push(...await inspectCanonicalFunctionalLinks(page, input.buildInput, route.path));
        }
        const telLinks = metrics.links.filter((href) => /^tel:/i.test(href));
        const canonicalPhone = input.buildInput.business.contacts.phone;
        const canonicalTelMatches = canonicalPhone
          ? telLinks.filter((href) => comparablePhone(href.slice(4)) === comparablePhone(canonicalPhone)).length
          : 0;
        routeFindings.push(finding(
          "render.tel_links",
          `Tap-to-call links at ${viewport.name}: ${telLinks.length}; canonical-number matches: ${canonicalTelMatches}; canonical phone available: ${Boolean(canonicalPhone)}.`,
          route.path,
          "render",
          "info"
        ));
        if (
          route.path === "/"
          && viewport.name === "desktop"
          && canonicalGeographyFactIds.size > 0
          && !metrics.renderedFactIds.some((factId) => canonicalGeographyFactIds.has(factId))
        ) {
          routeFindings.push(finding(
            "render.local_presence_missing",
            "The homepage has publishable canonical address or service-area evidence but renders none of it through a canonical fact binding. Give local customers one clear, honest locality, address/directions, or service-area cue; do not replace it with an unsupported map or radius graphic.",
            route.path,
            "render",
            "warning"
          ));
        }
        if (viewport.name === "desktop" && !isAuthorReview) {
          const leadFormCount = await page.locator("form[data-lodesta-form-id]").count();
          routeFindings.push(...await verifyLeadFormSubmissions(page, route.path));
          if (leadFormCount > 0) {
            const resetResponse = await navigatePageWithRetry({
              page,
              url: routeUrl,
              route: route.path,
              viewport: viewport.name,
              signal: input.signal
            });
            if (!resetResponse?.ok()) {
              routeFindings.push(finding("route.response", `Route returned ${resetResponse?.status() ?? "no response"} while resetting visual evidence after form verification.`, route.path));
            }
            await settleImages(page);
          }
        }
        if (viewport.name === "mobile" && !isAuthorReview) {
          routeFindings.push(...await inspectAutomatedAccessibility(page, {
            attempt,
            route: route.path,
            browserVersion,
            consoleErrors
          }));
        }
        linksChecked += metrics.links.length;
        if (metrics.horizontalOverflowPx > 2) {
          routeFindings.push(finding(
            "render.horizontal_overflow",
            `Horizontal overflow is ${metrics.horizontalOverflowPx}px at ${viewport.name}.`,
            route.path,
            "render",
            metrics.horizontalOverflowPx >= 16 ? "error" : "warning"
          ));
        }
        if (metrics.headingOverflowCount > 0) {
          routeFindings.push(finding("render.heading_overflow", `${metrics.headingOverflowCount} heading(s) overflow at ${viewport.name}.`, route.path, "render", "warning"));
        }
        if (metrics.brokenImages > 0) {
          routeFindings.push(finding("render.broken_image", `${metrics.brokenImages} image(s) failed at ${viewport.name}.`, route.path));
        }
        if (metrics.h1Count !== 1) {
          routeFindings.push(finding("accessibility.h1", `Route should have exactly one H1; found ${metrics.h1Count}.`, route.path, "accessibility", "warning"));
        }
        if (viewport.name === "desktop" && metrics.missingAriaReferenceCount > 0) {
          routeFindings.push(finding(
            "functional.aria_reference",
            `${metrics.missingAriaReferenceCount} ARIA reference(s) point to missing element IDs. Examples: ${metrics.missingAriaReferenceExamples.join("; ")}.`,
            route.path,
            "accessibility"
          ));
        }
        if (viewport.name === "desktop" && metrics.missingFragmentTargetCount > 0) {
          routeFindings.push(finding(
            "functional.fragment_target",
            `${metrics.missingFragmentTargetCount} same-page link(s) point to missing fragment targets. Use a real element ID or a valid route instead. Examples: ${metrics.missingFragmentTargetExamples.join("; ")}.`,
            route.path,
            "link"
          ));
        }
        if (metrics.minBodyFontPx < 16) {
          const examples = metrics.smallBodyTextExamples.map((example) => `${example.selector} "${example.text}" (${example.fontSizePx}px)`).join("; ");
          const families = metrics.smallBodyTextFamilies.map((family) => `${family.selector} (${family.count} element${family.count === 1 ? "" : "s"}, min ${family.minFontSizePx}px)`).join("; ");
          routeFindings.push(finding(
            "render.body_font",
            `${metrics.smallBodyTextCount} body-copy element(s) compute below 16px at ${viewport.name}. The examples are representative, not an exhaustive repair list; correct the shared type token or component rules for every affected family before reinspecting. Affected families: ${families}. Examples: ${examples}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.smallDisclosureTextCount > 0) {
          const examples = metrics.smallDisclosureTextExamples.map((example) => `${example.selector} "${example.text}" (${example.fontSizePx}px)`).join("; ");
          routeFindings.push(finding(
            "render.disclosure_text",
            `${metrics.smallDisclosureTextCount} FAQ or disclosure answer text element(s) compute below 16px at ${viewport.name}, including content hidden in the collapsed state. Fix these selectors: ${examples}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.smallFormTextCount > 0) {
          const examples = metrics.smallFormTextExamples.map((example) => `${example.selector} "${example.text}" (${example.fontSizePx}px)`).join("; ");
          routeFindings.push(finding(
            "render.form_text",
            `${metrics.smallFormTextCount} form label, field, or submit-control text element(s) compute below 16px at ${viewport.name}. Fix these selectors: ${examples}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.oversizedSingleLineFieldCount > 0) {
          routeFindings.push(finding(
            "render.oversized_single_line_field",
            `${metrics.oversizedSingleLineFieldCount} single-line form field(s) exceed 96px tall at ${viewport.name} and read visually like textareas. Keep ordinary input and select controls compact; reserve multi-line height for textarea controls. Examples: ${metrics.oversizedSingleLineFieldExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.tinyVisibleTextCount > 0) {
          const examples = metrics.tinyTextExamples.map((example) => `${example.selector} "${example.text}" (${example.fontSizePx}px)`).join("; ");
          const families = metrics.tinyTextFamilies.map((family) => `${family.selector} (${family.count} element${family.count === 1 ? "" : "s"}, min ${family.minFontSizePx}px)`).join("; ");
          routeFindings.push(finding(
            "render.tiny_text",
            `${metrics.tinyVisibleTextCount} visible text element(s) compute below 12px at ${viewport.name}. The examples are representative, not exhaustive; correct every affected shared family before reinspecting. Affected families: ${families}. Examples: ${examples}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.lowContrastExamples.length > 0) {
          const examples = metrics.lowContrastExamples
            .map((example) => `${example.selector} "${example.text}" (${example.foreground} on ${example.background}, ${example.ratio}:1; requires ${example.requiredRatio}:1)`)
            .join("; ");
          routeFindings.push(finding(
            "render.contrast",
            `${metrics.lowContrastCount} body-text or interactive-label element(s) fail deterministic contrast at ${viewport.name}. Examples: ${examples}.`,
            route.path,
            "accessibility",
            "error"
          ));
        }
        if (metrics.textSurfaceBoundaryCount > 0) {
          routeFindings.push(finding(
            "render.text_surface_boundary",
            `${metrics.textSurfaceBoundaryCount} meaningful text element(s) cross a positioned decorative color boundary at ${viewport.name}. Keep each text block on one stable, readable surface. Examples: ${metrics.textSurfaceBoundaryExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.longLineCount > 0) {
          routeFindings.push(finding(
            "render.long_lines",
            `${metrics.longLineCount} readable text block(s) exceeded 90 estimated characters per line at ${viewport.name}. Examples: ${metrics.longLineExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.smallTargetCount > 0) {
          routeFindings.push(finding(
            "render.target_size",
            `${metrics.smallTargetCount} essential control(s) measured below 44×44px at ${viewport.name}. Examples: ${metrics.smallTargetExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.duplicateFieldLabelCount > 0) {
          routeFindings.push(finding(
            "render.duplicate_field_label",
            `${metrics.duplicateFieldLabelCount} form field(s) render the same label more than once at ${viewport.name}. Examples: ${metrics.duplicateFieldLabelExamples.join("; ")}.`,
            route.path,
            "accessibility",
            "warning"
          ));
        }
        if (metrics.adjacentDuplicateTextCount > 0) {
          routeFindings.push(finding(
            "render.adjacent_duplicate_text",
            `${metrics.adjacentDuplicateTextCount} compact visible text block(s) repeat an adjacent word at ${viewport.name}. This often means canonical fact text was manually suffixed with information it already contains. Remove only the redundant authored text and preserve the canonical binding. Examples: ${metrics.adjacentDuplicateTextExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.adjacentDuplicateContentBlockCount > 0) {
          routeFindings.push(finding(
            "functional.adjacent_duplicate_content",
            `${metrics.adjacentDuplicateContentBlockCount} substantial adjacent content block pair(s) render the same customer-facing text at ${viewport.name}. Remove the accidental duplicate section instead of shipping repeated content. Examples: ${metrics.adjacentDuplicateContentBlockExamples.join("; ")}.`,
            route.path,
            "render"
          ));
        }
        if (metrics.internalProvenanceCopyCount > 0) {
          routeFindings.push(finding(
            "render.internal_provenance_copy",
            `${metrics.internalProvenanceCopyCount} customer-facing text block(s) expose internal source or evidence language at ${viewport.name}. State the supported business message naturally without mentioning retained pages, source pages, canonical context, or how the fact was obtained. Examples: ${metrics.internalProvenanceCopyExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.vagueProcessCopyCount > 0) {
          routeFindings.push(finding(
            "render.vague_process_copy",
            `${metrics.vagueProcessCopyCount} customer-facing text block(s) use vague process language at ${viewport.name}. Name the actual customer action, preparation, decision, or outcome instead of phrases such as next step, starting point, service conversation, or clear path. Examples: ${metrics.vagueProcessCopyExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.clippedElementCount > 0 || metrics.hitTestFailureCount > 0) {
          routeFindings.push(finding(
            "render.clipping_overlap",
            `${metrics.clippedElementCount} important element(s) were clipped and ${metrics.hitTestFailureCount} essential control(s) failed center-point hit-testing at ${viewport.name}. Examples: ${[...metrics.clippedElementExamples, ...metrics.hitTestFailureExamples].join("; ")}.`,
            route.path,
            "render"
          ));
        }
        if (metrics.textClippingCount > 0) {
          routeFindings.push(finding(
            "render.text_clipping",
            `${metrics.textClippingCount} visible text fragment(s) were materially clipped at ${viewport.name}. Examples: ${metrics.textClippingExamples.join("; ")}.`,
            route.path,
            "render"
          ));
        }
        if (metrics.textOcclusionCount > 0) {
          routeFindings.push(finding(
            "render.text_occlusion",
            `${metrics.textOcclusionCount} visible text collision(s) were detected at ${viewport.name}. Examples: ${metrics.textOcclusionExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.headerControlCollisionCount > 0) {
          routeFindings.push(finding(
            "functional.header_control_collision",
            `${metrics.headerControlCollisionCount} distinct visible header-control pair(s) overlap at ${viewport.name}. Header navigation, phone, portal, and conversion controls must occupy separate hit areas. Examples: ${metrics.headerControlCollisionExamples.join("; ")}.`,
            route.path,
            "render"
          ));
        }
        if (metrics.headerControlWrapCount > 0) {
          routeFindings.push(finding(
            "render.header_control_wrap",
            `${metrics.headerControlWrapCount} visible header controls wrap onto multiple text lines at ${viewport.name}. Collapse to the compact navigation state before an inline header becomes crowded, or give the controls enough room to remain deliberate. Examples: ${metrics.headerControlWrapExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.inlineLinkClusterCount > 0) {
          routeFindings.push(finding(
            "render.inline_link_spacing",
            `${metrics.inlineLinkClusterCount} adjacent text-link pair(s) render with no perceptible separation at ${viewport.name}. Repair the shared parent CSS with an explicit row/column layout and gap or padding; do not insert slash, pipe, or bullet characters into markup as a substitute for spacing. Examples: ${metrics.inlineLinkClusterExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (viewport.name === "desktop" && metrics.unstructuredFooterGroupCount > 0) {
          routeFindings.push(finding(
            "render.footer_group_layout",
            `${metrics.unstructuredFooterGroupCount} wide footer group container(s) fall back to a plain block stack at desktop. Give the named container an explicit grid, flex row, or deliberately proportioned column composition so multiple footer groups do not become an accidental tall single column. Examples: ${metrics.unstructuredFooterGroupExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (viewport.name === "mobile" && metrics.narrowMediaSplitCount > 0) {
          routeFindings.push(finding(
            "render.mobile_narrow_split",
            `${metrics.narrowMediaSplitCount} heading composition(s) remain squeezed into narrow side-by-side phone columns. Recompose them vertically or give the text a readable measure. Examples: ${metrics.narrowMediaSplitExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (route.path === "/" && viewport.name === "mobile" && metrics.longMobileCardWallCount > 0) {
          routeFindings.push(finding(
            "render.mobile_inventory_wall",
            `${metrics.longMobileCardWallCount} long full-width card inventory group(s) consume multiple phone viewports without a stronger hierarchy. Curate the homepage selection, group the inventory into compact scannable links, or use an honest disclosure while keeping the complete catalog reachable on its hub route. Examples: ${metrics.longMobileCardWallExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (viewport.name === "mobile" && metrics.fragmentedHeadingCount > 0) {
          routeFindings.push(finding(
            "render.mobile_heading_measure",
            `${metrics.fragmentedHeadingCount} heading(s) collapse into an unreadably narrow phone column. Stack or widen the responsive composition so meaningful words—not one- or two-character fragments—form each line. Examples: ${metrics.fragmentedHeadingExamples.join("; ")}.`,
            route.path,
            "render",
            // This metric is deliberately limited to severe one- or two-character
            // fragmentation. At that point customer content is functionally
            // unreadable, rather than merely an advisory typography preference.
            "error"
          ));
        }
        if (metrics.mediaContainerOverflowCount > 0) {
          routeFindings.push(finding(
            "render.media_container_overflow",
            `${metrics.mediaContainerOverflowCount} in-flow media element(s) escape their container and overlap adjacent content at ${viewport.name}. Give the media wrapper a definite responsive height, clip the overflow, or stack the composition cleanly. Examples: ${metrics.mediaContainerOverflowExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.headerBrandCollisionCount > 0) {
          routeFindings.push(finding(
            "render.header_brand_collision",
            `${metrics.headerBrandCollisionCount} header brand image(s) escape the header and cover utility text at ${viewport.name}. Keep the official logo fully contained in its header row, or reserve deliberate space in the utility row so both remain readable. Examples: ${metrics.headerBrandCollisionExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.headerContentOcclusionCount > 0) {
          routeFindings.push(finding(
            "render.header_content_occlusion",
            `${metrics.headerContentOcclusionCount} main-content text fragment(s) are covered by the header at ${viewport.name}. Reserve the rendered header height before customer content begins, or recompose the affected text below it. Examples: ${metrics.headerContentOcclusionExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.croppedTransparentGraphicCount > 0) {
          routeFindings.push(finding(
            "render.informational_graphic_crop",
            `${metrics.croppedTransparentGraphicCount} transparent graphic(s) lose visible edge content through object-fit: cover at ${viewport.name}. Preserve complete labels, symbols, and illustrated categories with contain or a crop-free responsive frame; reserve cover crops for imagery whose omitted edges do not carry information. Examples: ${metrics.croppedTransparentGraphicExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.syntheticIdentityDeviceCount > 0) {
          routeFindings.push(finding(
            "render.synthetic_identity_device",
            `${metrics.syntheticIdentityDeviceCount} CSS badge, seal, stamp, monogram, slogan-poster, or empty marker device(s) may compete with the official identity or add evidence-free visual filler at ${viewport.name}. Use the supplied official logo as the sole identity mark and express the message through ordinary section typography or supported content. Examples: ${metrics.syntheticIdentityDeviceExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.geographyCircleDeviceCount > 0) {
          routeFindings.push(finding(
            "render.geography_circle",
            `${metrics.geographyCircleDeviceCount} large circle or radius device(s) frame service-geography language at ${viewport.name}. Present supported areas as honest text or an ordinary address/directions treatment; do not imply a coverage radius, badge, or pseudo-map. Examples: ${metrics.geographyCircleDeviceExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.decorativeDiagramCount > 0) {
          routeFindings.push(finding(
            "render.decorative_diagram",
            `${metrics.decorativeDiagramCount} large CSS-only orbit, radar, network, or concentric-circle graphic(s) imply a diagram without encoding supported information at ${viewport.name}. Replace decorative data language with authentic evidence, ordinary editorial composition, or a factual accessible diagram. Examples: ${metrics.decorativeDiagramExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.duplicateHeaderActionCount > 0) {
          routeFindings.push(finding(
            "render.duplicate_header_action",
            `${metrics.duplicateHeaderActionCount} header action(s) repeat the same visible label and destination at ${viewport.name}. Keep one deliberate header treatment for the action instead of rendering both a navigation link and duplicate button. Examples: ${metrics.duplicateHeaderActionExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.callActionDestinationMismatchCount > 0) {
          routeFindings.push(finding(
            "render.call_action_destination",
            `${metrics.callActionDestinationMismatchCount} visible action(s) labeled as a call do not use a tel: destination at ${viewport.name}. Make “Call” actions dial the canonical phone number; label form or section links as Contact, Request, or Get started instead. Examples: ${metrics.callActionDestinationMismatchExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.callActionLabelSpacingCount > 0) {
          routeFindings.push(finding(
            "render.call_action_label_spacing",
            `${metrics.callActionLabelSpacingCount} visible call action(s) omit whitespace between “Call” and the phone number at ${viewport.name}. Use a human-readable label such as “Call (804) 914-8120.” Examples: ${metrics.callActionLabelSpacingExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.falseAffordanceCount > 0) {
          routeFindings.push(finding(
            "render.false_affordance",
            `${metrics.falseAffordanceCount} repeated non-interactive row or card decoration(s) look like expand, disclosure, or navigation controls at ${viewport.name}. Remove the control symbol or make the whole treatment honestly interactive with an accessible destination or disclosure. Examples: ${metrics.falseAffordanceExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.repeatedSourceImageCount > 0) {
          routeFindings.push(finding(
            "render.repeated_source_image",
            `${metrics.repeatedSourceImageCount} non-logo image(s) repeat as major media across separate sections at ${viewport.name}. Use a scarce retained photograph once where it has the most impact instead of making multiple sections feel duplicated. Examples: ${metrics.repeatedSourceImageExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        const primaryGeometryFailure = route.path === "/" && (
          !metrics.primaryHeadingAboveFold
          || !metrics.primaryActionAboveFold
          || !metrics.primaryHeadingBeforeAction
        );
        routeFindings.push(finding(
          "render.primary_geometry",
          `Primary heading above fold: ${metrics.primaryHeadingAboveFold}; main primary action above fold: ${metrics.primaryActionAboveFold}; heading precedes main action: ${metrics.primaryHeadingBeforeAction}; viewport: ${viewport.name}.${primaryGeometryFailure ? " Keep the homepage value proposition and its main conversion visible in the first natural viewport; inspect header and navigation layout before changing hero content." : ""}`,
          route.path,
          "render",
          primaryGeometryFailure ? "warning" : "info"
        ));
        if (metrics.clippedManagedContentExamples.length > 0) {
          routeFindings.push(finding(
            "render.managed_content_clipped",
            `${metrics.clippedManagedContentCount} managed capability block(s) hide content through unintended overflow at ${viewport.name}. Examples: ${metrics.clippedManagedContentExamples.join("; ")}.`,
            route.path,
            "capability"
          ));
        }
        if (metrics.constrainedManagedMapExamples.length > 0) {
          routeFindings.push(finding(
            "capability.map_layout",
            `${metrics.constrainedManagedMapCount} retained managed location block(s) are unreadably compressed at ${viewport.name}. Examples: ${metrics.constrainedManagedMapExamples.join("; ")}.`,
            route.path,
            "capability"
          ));
        }
        if (metrics.emptyControlExamples.length > 0) {
          routeFindings.push(finding(
            "render.empty_control",
            `${metrics.emptyControlCount} visible interactive control(s) have no visible text, icon, image, or CSS affordance at ${viewport.name}. Examples: ${metrics.emptyControlExamples.join("; ")}.`,
            route.path,
            "render"
          ));
        }
        if (metrics.browserDefaultDocumentExamples.length > 0) {
          routeFindings.push(finding(
            "render.browser_default_document",
            `The rendered document retains coordinated browser-default body and link styling at ${viewport.name}; the authored visual system appears missing or catastrophically discarded. Examples: ${metrics.browserDefaultDocumentExamples.join("; ")}.`,
            route.path,
            "render",
            "error"
          ));
        }
        if (metrics.browserDefaultControlExamples.length > 0) {
          routeFindings.push(finding(
            "render.browser_default_control_chrome",
            `${metrics.browserDefaultControlCount} visible action control(s) retain browser-default inset or outset borders at ${viewport.name}. Reset native border/appearance intentionally and carry the site's button treatment through without removing accessible focus styling. Examples: ${metrics.browserDefaultControlExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.imageAltQualityExamples.length > 0) {
          routeFindings.push(finding(
            "render.image_alt_quality",
            `${metrics.imageAltQualityCount} rendered image alt attribute(s) are missing, filename-like, generic, or keyword-stuffed at ${viewport.name}. Examples: ${metrics.imageAltQualityExamples.join("; ")}.`,
            route.path,
            "accessibility",
            "warning"
          ));
        }
        if (metrics.filteredRasterLogoExamples.length > 0) {
          routeFindings.push(finding(
            "render.raster_logo_filter",
            `${metrics.filteredRasterLogoCount} visible raster logo image(s) use a CSS filter at ${viewport.name}, which can erase or distort an opaque brand tile. Keep the raster mark unchanged on a compatible surface or omit the duplicate mark. Examples: ${metrics.filteredRasterLogoExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.oversizedFooterRasterLogoExamples.length > 0) {
          routeFindings.push(finding(
            "render.footer_raster_logo_scale",
            `${metrics.oversizedFooterRasterLogoCount} footer raster logo image(s) dominate their footer column as a large image tile at ${viewport.name}. Keep the exact prepared mark at its intrinsic aspect ratio on a compatible surface and choose an ordinary contained size that supports the footer hierarchy. Examples: ${metrics.oversizedFooterRasterLogoExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.undersizedPrimaryRasterLogoExamples.length > 0) {
          routeFindings.push(finding(
            "render.raster_logo_content_scale",
            `${metrics.undersizedPrimaryRasterLogoCount} canonical logo image(s) render with a mark that may be difficult to recognize at ${viewport.name}. Use the exact supplied asset at its intrinsic aspect ratio and choose an ordinary contained size appropriate to the header. Examples: ${metrics.undersizedPrimaryRasterLogoExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.lowContrastPrimaryLogoExamples.length > 0) {
          routeFindings.push(finding(
            "render.primary_logo_surface_contrast",
            `${metrics.lowContrastPrimaryLogoCount} primary logo image(s) visually recede into the header surface at ${viewport.name}. Keep the exact supplied mark unchanged, but place it on a quiet compatible light or dark surface so the complete identity is immediately legible; do not recolor it with CSS filters. Examples: ${metrics.lowContrastPrimaryLogoExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (
          route.path === "/"
          && viewport.name === "desktop"
          && activeLogoRevisionIds.size > 0
          && !metrics.renderedAssetRevisionIds.some((revisionId) => activeLogoRevisionIds.has(revisionId))
        ) {
          routeFindings.push(finding(
            "render.primary_logo_missing",
            `The retained business record supplies ${activeLogoRevisionIds.size} active official logo revision(s), but the homepage does not render any matching visible asset. Use an exact supplied logo as the primary identity instead of replacing it with text, a monogram, or CSS artwork.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (
          viewport.name === "mobile"
          && metrics.missingMobileNavigation
        ) {
          routeFindings.push(finding(
            "render.mobile_navigation",
            "Desktop navigation links are hidden on mobile without a visible navigation toggle or equivalent route access.",
            route.path,
            "render"
          ));
        }
        if (viewport.name === "mobile" && metrics.indiscernibleMobileNavigationToggleExamples.length > 0) {
          routeFindings.push(finding(
            "render.mobile_navigation_trigger",
            `The primary mobile navigation control has a hit box but no visible label or icon, so sighted visitors cannot identify it. Examples: ${metrics.indiscernibleMobileNavigationToggleExamples.join("; ")}.`,
            route.path,
            "render"
          ));
        }
        if (viewport.name === "mobile" && metrics.misalignedMobileNavigationToggleExamples.length > 0) {
          routeFindings.push(finding(
            "render.mobile_navigation_toggle_alignment",
            `The primary mobile navigation trigger is separated from the header's trailing action area. Review whether that placement is deliberate for this site's authored navigation pattern. Examples: ${metrics.misalignedMobileNavigationToggleExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (viewport.name === "mobile" && metrics.duplicateManagedNavigationIconExamples.length > 0) {
          routeFindings.push(finding(
            "render.duplicate_navigation_icon",
            `A mobile navigation trigger renders authored pseudo-element artwork on top of the built-in managed hamburger/X. Remove the trigger's ::before/::after icon artwork and style the supplied [data-lodesta-navigation-icon] only through color, size, or spacing. Examples: ${metrics.duplicateManagedNavigationIconExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (viewport.name === "mobile" && metrics.mobileNavigationOverflowExamples.length > 0) {
          routeFindings.push(finding(
            "render.mobile_navigation_overflow",
            `Primary navigation requires horizontal scrolling or places destinations outside the visible phone viewport. Use a visible menu control or another fully visible mobile navigation pattern. Examples: ${metrics.mobileNavigationOverflowExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (viewport.name === "desktop" && metrics.desktopDualNavigationExamples.length > 0) {
          routeFindings.push(finding(
            "render.desktop_dual_navigation",
            `A mobile navigation disclosure remains visible beside the complete desktop navigation. Examples: ${metrics.desktopDualNavigationExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.escapedEntityExamples.length > 0) {
          routeFindings.push(finding(
            "render.escaped_entity",
            `Visible text contains escaped HTML entity source instead of punctuation: ${metrics.escapedEntityExamples.join(", ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.escapedSequenceExamples.length > 0) {
          routeFindings.push(finding(
            "render.escaped_sequence",
            `Visible text contains literal escaped source characters instead of layout whitespace: ${metrics.escapedSequenceExamples.join(", ")}.`,
            route.path,
            "render"
          ));
        }
        for (const href of metrics.links) {
          if (!validRenderedLink(href, route.path, new Set(input.prepared.routes.map((item) => item.path)))) {
            routeFindings.push(finding(
              "link.rendered",
              renderedLinkFailureMessage(href, route.path, input.prepared.findings),
              route.path,
              "link"
            ));
          }
        }
        let focusedSelection = false;
        if (input.focusSelector) {
          try {
            const selected = page.locator(input.focusSelector).first();
            if (await selected.count() && await selected.isVisible()) {
              await selected.evaluate((element) => {
                element.setAttribute("data-lodesta-inspection-focus", "true");
                element.scrollIntoView({ block: "center", inline: "center" });
              });
              await page.addStyleTag({ content: `
                [data-lodesta-inspection-focus="true"] {
                  outline: 4px solid #1683ff !important;
                  outline-offset: 3px !important;
                  box-shadow: 0 0 0 7px rgba(22, 131, 255, .2) !important;
                }
              ` });
              await page.waitForTimeout(75);
              const key = `${input.capturePrefix.replace(/\/$/, "")}/${routeKey(route.path)}-${viewport.name}-focus.png`;
              captures.push({
                key,
                route: route.path,
                viewport: viewport.name,
                stage: "settled",
                frame: "focus",
                focusSelector: input.focusSelector,
                bytes: await page.screenshot({ fullPage: false, type: "png", animations: "disabled" })
              });
              focusedSelection = true;
            } else {
              routeFindings.push(finding(
                "render.inspection_selection_missing",
                `The selected element was not visible at ${viewport.name}; route-level visual evidence was captured instead. Selector: ${input.focusSelector}.`,
                route.path,
                "render",
                "warning"
              ));
            }
          } catch (error) {
            routeFindings.push(finding(
              "render.inspection_selection_invalid",
              `The selected element could not be focused at ${viewport.name}; route-level visual evidence was captured instead. Selector: ${input.focusSelector}. ${error instanceof Error ? error.message : String(error)}`,
              route.path,
              "render",
              "warning"
            ));
          }
        }
        if (!focusedSelection) {
          const retainExtendedEvidence = input.captureMode === "review"
            || routeFindings.some(isTechnicalReleaseBlocker);
          const frames = !retainExtendedEvidence || viewport.name === "tablet"
            ? ["top"] as const
            : ["top", "middle", "bottom"] as const;
          const documentHeight = await page.evaluate(() => Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
          ));
          for (const frame of frames) {
            const maximumScroll = Math.max(0, documentHeight - viewport.height);
            const position = frame === "top"
              ? 0
              : frame === "middle"
                ? maximumScroll / 2
                : maximumScroll;
            await settleScrollPosition(page, position);
            const pageState = await inspectCapturePageState(page);
            const key = `${input.capturePrefix.replace(/\/$/, "")}/${routeKey(route.path)}-${viewport.name}-${frame}.png`;
            captures.push({
              key,
              route: route.path,
              viewport: viewport.name,
              stage: "settled",
              frame,
              pageState,
              bytes: await page.screenshot({ fullPage: false, type: "png", animations: "disabled" })
            });
          }
        }
        await settleScrollPosition(page, 0);
        findings.push(...routeFindings);
        await page.close();
      }
    }
    return {
      findings: dedupe(findings),
      captures,
      allRoutesChecked: isAuthorReview ? routes.length : input.prepared.routes.length,
      routesChecked: routes.length,
      linksChecked
    };
  } finally {
    await browser?.close();
    await stopServer(harness.server);
  }
}

function allRouteCopyAdvisories(prepared: PreparedSiteArtifact, visuallyInspectedPaths: Set<string>) {
  const findings: ArtifactGateFinding[] = [];
  for (const route of prepared.routes) {
    if (visuallyInspectedPaths.has(route.path)) continue;
    const document = parseDocument(route.html, { decodeEntities: true });
    const textBlocks = DomUtils.findAll((node) => (
      node.type === "tag"
      && /^(?:h[1-6]|p|li|dd|dt|label|blockquote|address|a|button)$/i.test(node.name)
      && !DomUtils.findOne((child) => child.type === "tag" && /^(?:h[1-6]|p|li|dd|dt|label|blockquote|address|a|button)$/i.test(child.name), node.children)
    ), document.children)
      .map((element) => DomUtils.textContent(element).replace(/\s+/g, " ").trim())
      .filter((text) => text.length >= 8);
    const vagueExamples = textBlocks.filter((text) => (
      /\b(?:next step|starting point|place to start|where to begin|service conversation|clear path|local service information)\b/i.test(text)
    ));
    if (vagueExamples.length > 0) {
      findings.push(finding(
        "render.vague_process_copy",
        `${vagueExamples.length} customer-facing text block(s) use vague process language on an unrendered route. Name the actual customer action, preparation, decision, or outcome instead. Examples: ${vagueExamples.slice(0, 3).map((text) => JSON.stringify(text)).join("; ")}.`,
        route.path,
        "render",
        "warning"
      ));
    }
  }
  return findings;
}

async function verifyEveryPreparedRoute(
  prepared: PreparedSiteArtifact,
  origin: string,
  signal?: AbortSignal
) {
  const findings: ArtifactGateFinding[] = [];
  for (const route of prepared.routes) {
    if (signal?.aborted) throw new Error("workflow_deadline_exhausted");
    try {
      const response = await fetch(`${origin}${route.path}`, { signal });
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      const runtimeErrorDocument = /(?:application error|internal server error|runtime error|this page crashed)/i.test(body);
      if (!response.ok
        || !contentType.toLowerCase().includes("text/html")
        || !body.trim()
        || runtimeErrorDocument
        || body !== route.html) {
        findings.push(finding(
          "route.response",
          `Finalized route ${route.path} did not return its complete expected HTML document (status ${response.status}, content type ${contentType || "missing"}).`,
          route.path,
          "route"
        ));
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      findings.push(finding(
        "route.response",
        `Finalized route ${route.path} could not be fetched: ${browserFailureMessage(error)}.`,
        route.path,
        "route"
      ));
    }
  }
  return findings;
}

async function captureOpenNavigation(page: Page) {
  await settleScrollPosition(page, 0);
  const toggles = page.locator([
    "[data-lodesta-menu-toggle]",
    "header button[aria-controls][aria-expanded]",
    "nav button[aria-controls][aria-expanded]",
    "header [popovertarget]",
    "nav [popovertarget]",
    "header details > summary",
    "nav details > summary"
  ].join(","));
  for (let index = 0; index < await toggles.count(); index += 1) {
    const toggle = toggles.nth(index);
    if (!await toggle.isVisible().catch(() => false)) continue;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (await browserNavigationTriggerIsOpen(toggle)) await closeBrowserNavigationTrigger(page, toggle);
      await settleScrollPosition(page, 0);
      const settledAtTop = await page.waitForFunction(() => Math.abs(scrollY) < 1, undefined, { timeout: 1_000 })
        .then(() => true)
        .catch(() => false);
      if (!settledAtTop) continue;
      const opened = await toggle.click({ timeout: 1_000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(100);
      const expanded = await browserNavigationTriggerIsOpen(toggle);
      const remainedAtTop = await page.evaluate(() => Math.abs(scrollY) < 1);
      if (!remainedAtTop) {
        await page.keyboard.press("Escape").catch(() => undefined);
        await page.waitForTimeout(150);
        continue;
      }
      if (!opened || !expanded) {
        await page.keyboard.press("Escape").catch(() => undefined);
        continue;
      }
      const targetId = await toggle.getAttribute("popovertarget") ?? await toggle.getAttribute("aria-controls");
      const detailsTrigger = await toggle.evaluate((element) => element.tagName.toLowerCase() === "summary");
      const painted = await page.waitForFunction(({ controlledId, details }) => {
        const trigger = controlledId
          ? document.querySelector(`[popovertarget="${CSS.escape(controlledId)}"],[aria-controls="${CSS.escape(controlledId)}"]`)
          : details ? document.activeElement : null;
        const target = controlledId
          ? document.getElementById(controlledId)
          : details && trigger ? trigger.closest("details") : null;
        if (!target || target.hasAttribute("hidden")) return false;
        if (target.hasAttribute("popover") && !target.matches(":popover-open")) return false;
        if (target instanceof HTMLDetailsElement && !target.open) return false;
        const targetStyle = getComputedStyle(target);
        const targetRect = target.getBoundingClientRect();
        const visibleLink = [...target.querySelectorAll("a[href]")].some((link) => {
          const style = getComputedStyle(link);
          const rect = link.getBoundingClientRect();
          return style.display !== "none"
            && style.visibility !== "hidden"
            && Number(style.opacity) > 0
            && rect.width > 0
            && rect.height > 0
            && rect.bottom > 0
            && rect.top < innerHeight;
        });
        return targetStyle.display !== "none"
          && targetStyle.visibility !== "hidden"
          && Number(targetStyle.opacity) > 0
          && targetRect.width > 0
          && targetRect.height > 0
          && visibleLink;
      }, { controlledId: targetId, details: detailsTrigger }, { timeout: 2_000 }).then(() => true).catch(() => false);
      if (!painted) {
        await page.keyboard.press("Escape").catch(() => undefined);
        await page.waitForTimeout(75);
        continue;
      }
      await page.evaluate((controlledId) => {
        scrollTo(0, 0);
        const target = controlledId ? document.getElementById(String(controlledId)) : null;
        if (target) target.scrollTop = 0;
        const navigation = target?.querySelector("nav");
        if (navigation) navigation.scrollTop = 0;
      }, targetId);
      await page.waitForTimeout(150);
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      const bytes = await page.screenshot({ fullPage: false, type: "png", animations: "disabled" });
      await closeBrowserNavigationTrigger(page, toggle);
      // Escape deliberately restores keyboard focus to the trigger. That is
      // correct runtime behavior, but leaving the synthetic review focus in
      // place contaminates later route screenshots with a focus-visible ring
      // that a natural first-load visitor does not see.
      await toggle.evaluate((trigger) => trigger instanceof HTMLElement && trigger.blur()).catch(() => undefined);
      await page.waitForTimeout(150);
      await settleScrollPosition(page, 0);
      return bytes;
    }
  }
  return undefined;
}

async function browserNavigationTriggerState(toggle: Locator): Promise<{ open: boolean; kind: "managed" | "popover" | "details" | "visibility" }> {
  return toggle.evaluate((element) => {
    const details = element.tagName.toLowerCase() === "summary" ? element.closest("details") : null;
    if (details) return { open: details.hasAttribute("open"), kind: "details" as const };
    const targetId = element.getAttribute("popovertarget") ?? element.getAttribute("aria-controls");
    const target = targetId ? document.getElementById(targetId) : null;
    if (target?.hasAttribute("popover")) {
      return { open: target.matches(":popover-open"), kind: "popover" as const };
    }
    const expanded = element.getAttribute("aria-expanded");
    if (expanded !== null) return { open: expanded === "true", kind: "managed" as const };
    if (target) {
      const style = getComputedStyle(target);
      const bounds = target.getBoundingClientRect();
      return {
        open: !target.hasAttribute("hidden")
          && style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0
          && bounds.width > 0
          && bounds.height > 0,
        kind: "visibility" as const
      };
    }
    return { open: false, kind: "visibility" as const };
  });
}

async function browserNavigationTriggerIsOpen(toggle: Locator) {
  return (await browserNavigationTriggerState(toggle)).open;
}

async function closeBrowserNavigationTrigger(page: Page, toggle: Locator) {
  if (!await browserNavigationTriggerIsOpen(toggle).catch(() => false)) return;
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(75);
  if (await browserNavigationTriggerIsOpen(toggle).catch(() => false)) {
    await toggle.click({ timeout: 1_000 }).catch(() => undefined);
    await page.waitForTimeout(75);
  }
}

async function inspectCanonicalFunctionalLinks(
  page: Page,
  buildInput: SitePublicBuildInput,
  route: string
) {
  const canonicalPortals = buildInput.business.links
    .filter((link) => link.publicEligible && isCustomerPortalLink(link.url, link.label))
    .map((link) => normalizedPublicUrl(link.url))
    .filter((url): url is string => Boolean(url));
  if (!canonicalPortals.length) return [];
  const expected = new Set(canonicalPortals);
  const rendered = await page.locator("a[href]").evaluateAll((links) => links.map((link) => ({
    href: (link as HTMLAnchorElement).href,
    label: (link.textContent ?? link.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim()
  })));
  const exactMatches = rendered.filter((link) => expected.has(normalizedPublicUrl(link.href) ?? ""));
  const mislabeled = rendered.filter((link) =>
    /\b(?:customer|client|member|resident|owner)?\s*(?:portal|login|log in|sign in|my account)\b/i.test(link.label)
    && /^https?:/i.test(link.href)
    && !expected.has(normalizedPublicUrl(link.href) ?? "")
  );
  if (exactMatches.length && !mislabeled.length) return [];
  const details = [
    !exactMatches.length ? `no rendered link uses ${canonicalPortals.join(" or ")}` : "",
    ...mislabeled.slice(0, 4).map((link) => `“${link.label || "portal"}” points to ${link.href}`)
  ].filter(Boolean).join("; ");
  return [finding(
    "functional.canonical_link",
    `The retained customer portal must remain an exact, usable destination; ${details}.`,
    route,
    "link"
  )];
}

async function inspectMobileCanonicalFunctionalLinks(
  page: Page,
  buildInput: SitePublicBuildInput,
  route: string
) {
  const canonicalPortals = buildInput.business.links
    .filter((link) => link.publicEligible && isCustomerPortalLink(link.url, link.label))
    .map((link) => normalizedPublicUrl(link.url))
    .filter((url): url is string => Boolean(url));
  if (!canonicalPortals.length) return [];
  const expected = new Set(canonicalPortals);
  if (await hasHitTestableCanonicalLink(page, expected)) return [];
  const toggles = page.locator([
    "[data-lodesta-menu-toggle]",
    "header details > summary",
    "header button[aria-controls]",
    "header [popovertarget]",
    "nav details > summary",
    "nav button[aria-controls]",
    "nav [popovertarget]"
  ].join(","));
  for (let index = 0; index < await toggles.count(); index += 1) {
    const toggle = toggles.nth(index);
    if (!await toggle.isVisible().catch(() => false)) continue;
    const wasOpen = await browserNavigationTriggerIsOpen(toggle).catch(() => false);
    if (!wasOpen) {
      await toggle.click({ timeout: 1_000 }).catch(() => undefined);
      await page.waitForTimeout(100);
    }
    const available = await hasHitTestableCanonicalLink(page, expected);
    if (!wasOpen) await closeBrowserNavigationTrigger(page, toggle);
    await page.waitForTimeout(75);
    if (available) return [];
  }
  return [finding(
    "functional.canonical_link",
    `The retained customer portal must remain a visible, hit-testable destination at the top of the mobile experience or while its navigation is open; no usable link exposes ${canonicalPortals.join(" or ")}.`,
    route,
    "link"
  )];
}

async function hasHitTestableCanonicalLink(page: Page, expected: ReadonlySet<string>) {
  const links = page.locator("a[href]");
  for (let index = 0; index < await links.count(); index += 1) {
    const link = links.nth(index);
    const href = normalizedPublicUrl(await link.getAttribute("href") ?? "");
    if (!href || !expected.has(href)) continue;
    const hitTestable = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0) return false;
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(innerWidth, rect.right);
      const bottom = Math.min(innerHeight, rect.bottom);
      if (right - left < 1 || bottom - top < 1) return false;
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return Boolean(hit && (hit === element || element.contains(hit)));
    }).catch(() => false);
    if (hitTestable) return true;
  }
  return false;
}

function normalizedPublicUrl(value: string) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function representativeRoutePaths(
  prepared: PreparedSiteArtifact,
  buildInput: SitePublicBuildInput,
  activelyEditedRoutes: string[] = []
) {
  const selected = new Set<string>();
  const routeByPath = new Map(prepared.routes.map((route) => [route.path, route]));
  const add = (path: string | undefined) => { if (path && routeByPath.has(path)) selected.add(path); };
  add("/");
  for (const path of activelyEditedRoutes) add(path);
  for (const requirement of buildInput.intent.pageRequirements.filter((requirement) => requirement.required)) {
    add(requirement.slug ? `/${requirement.slug}` : "/");
  }

  const templates = new Map<string, string>();
  const capabilities = new Map<string, string>();
  for (const route of prepared.routes) {
    const template = structuralDomSignature(route.html);
    if (!templates.has(template)) templates.set(template, route.path);
    const capability = managedCapabilitySignature(route.html);
    if (!capabilities.has(capability)) capabilities.set(capability, route.path);
  }
  for (const path of templates.values()) add(path);
  for (const path of capabilities.values()) add(path);

  add([...prepared.routes].sort((left, right) => routeDepth(right.path) - routeDepth(left.path) || right.path.length - left.path.length || left.path.localeCompare(right.path))[0]?.path);
  add([...prepared.routes].sort((left, right) => (right.title?.length ?? 0) - (left.title?.length ?? 0) || left.path.localeCompare(right.path))[0]?.path);
  add([...prepared.routes].sort((left, right) => right.html.length - left.html.length || left.path.localeCompare(right.path))[0]?.path);
  return selected;
}

function structuralDomSignature(html: string) {
  const normalized = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "<$1></$1>")
    .replace(/>[^<]+</g, "><")
    .replace(/\s(?:href|src|alt|title|content|aria-label|data-[\w-]+)=(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return sha256(normalized);
}

function managedCapabilitySignature(html: string) {
  const capabilities = [
    /data-lodesta-form|<form\b/i.test(html) ? "form" : "",
    /data-lodesta-map/i.test(html) ? "map" : "",
    /data-lodesta-gallery/i.test(html) ? "gallery" : "",
    /data-lodesta-disclosure/i.test(html) ? "disclosure" : ""
  ].filter(Boolean).sort();
  return capabilities.join("|") || "none";
}

function routeDepth(path: string) {
  return path.split("/").filter(Boolean).length;
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal) {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(new Error("workflow_deadline_exhausted"));
  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("workflow_deadline_exhausted")), { once: true }))
  ]);
}

async function startHarness(input: {
  prepared: PreparedSiteArtifact;
  buildInput: SitePublicBuildInput;
  blobStore: ArtifactBlobStore;
  runtimeSource?: Buffer;
}) {
  const routeFiles = new Map(input.prepared.routes.map((route) => [route.path, route.html]));
  const assetKeys = new Map(input.buildInput.business.assets.map((asset) => [asset.revisionId, asset.storageKey]));
  const assetBlobs = new Map<string, ReturnType<ArtifactBlobStore["get"]>>();
  const retainedAsset = (key: string) => {
    const cached = assetBlobs.get(key);
    if (cached) return cached;
    const pending = input.blobStore.get(key).catch((error) => {
      assetBlobs.delete(key);
      throw error;
    });
    assetBlobs.set(key, pending);
    return pending;
  };
  const css = input.prepared.files.find((file) => file.path === "site.css")?.bytes;
  const runtimeSource = input.runtimeSource ?? await buildSiteRuntimeBytes(input.prepared.runtimeSeriesId);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/site.css" && css) return send(response, 200, css, "text/css; charset=utf-8");
      if (url.pathname.startsWith("/_lodesta/runtime/")) return send(response, 200, runtimeSource, "application/javascript; charset=utf-8");
      const fontFile = decodeURIComponent(url.pathname.match(/^\/_lodesta\/fonts\/([^/]+)$/)?.[1] ?? "");
      if ((trustedFontFiles as readonly string[]).includes(fontFile)) {
        const font = await readFile(resolve(process.cwd(), "public", "_lodesta", "fonts", fontFile));
        return send(response, 200, font, "font/woff2");
      }
      if (url.pathname === "/api/analytics") return send(response, 204, Buffer.alloc(0), "application/json");
      if (url.pathname === "/api/forms/submit") {
        if (request.method !== "POST") return send(response, 405, Buffer.from(JSON.stringify({ accepted: false })), "application/json");
        await readRequestBody(request);
        return send(response, 200, Buffer.from(JSON.stringify({ accepted: true })), "application/json");
      }
      const assetId = decodeURIComponent(url.pathname.match(/^\/_lodesta\/assets\/([^/]+)$/)?.[1] ?? "");
      if (assetId) {
        const key = assetKeys.get(assetId);
        const blob = key ? await retainedAsset(key) : undefined;
        return blob ? send(response, 200, blob.bytes, blob.contentType) : send(response, 404, Buffer.alloc(0), "text/plain");
      }
      const normalized = normalizePath(url.pathname);
      const html = routeFiles.get(normalized);
      return html ? send(response, 200, Buffer.from(html), "text/html; charset=utf-8") : send(response, 404, Buffer.from("Not found"), "text/plain");
    } catch (error) {
      return send(response, 500, Buffer.from(error instanceof Error ? error.message : "Harness error"), "text/plain");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser gate harness did not bind a TCP port.");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

type BrowserPageMetrics = {
  horizontalOverflowPx: number;
  headingOverflowCount: number;
  brokenImages: number;
  h1Count: number;
  missingAriaReferenceCount: number;
  missingAriaReferenceExamples: string[];
  missingFragmentTargetCount: number;
  missingFragmentTargetExamples: string[];
  minBodyFontPx: number;
  smallBodyTextCount: number;
  smallBodyTextExamples: Array<{ selector: string; text: string; fontSizePx: number }>;
  smallBodyTextFamilies: Array<{ selector: string; count: number; minFontSizePx: number }>;
  smallDisclosureTextCount: number;
  smallDisclosureTextExamples: Array<{ selector: string; text: string; fontSizePx: number }>;
  smallFormTextCount: number;
  smallFormTextExamples: Array<{ selector: string; text: string; fontSizePx: number }>;
  oversizedSingleLineFieldCount: number;
  oversizedSingleLineFieldExamples: string[];
  tinyVisibleTextCount: number;
  tinyTextExamples: Array<{ selector: string; text: string; fontSizePx: number }>;
  tinyTextFamilies: Array<{ selector: string; count: number; minFontSizePx: number }>;
  lowContrastCount: number;
  lowContrastExamples: Array<{ selector: string; text: string; foreground: string; background: string; ratio: number; requiredRatio: number }>;
  textSurfaceBoundaryCount: number;
  textSurfaceBoundaryExamples: string[];
  clippedManagedContentCount: number;
  clippedManagedContentExamples: string[];
  constrainedManagedMapCount: number;
  constrainedManagedMapExamples: string[];
  emptyControlCount: number;
  emptyControlExamples: string[];
  browserDefaultDocumentCount: number;
  browserDefaultDocumentExamples: string[];
  browserDefaultControlCount: number;
  browserDefaultControlExamples: string[];
  longLineCount: number;
  longLineExamples: string[];
  smallTargetCount: number;
  smallTargetExamples: string[];
  duplicateFieldLabelCount: number;
  duplicateFieldLabelExamples: string[];
  adjacentDuplicateTextCount: number;
  adjacentDuplicateTextExamples: string[];
  adjacentDuplicateContentBlockCount: number;
  adjacentDuplicateContentBlockExamples: string[];
  internalProvenanceCopyCount: number;
  internalProvenanceCopyExamples: string[];
  vagueProcessCopyCount: number;
  vagueProcessCopyExamples: string[];
  hitTestFailureCount: number;
  hitTestFailureExamples: string[];
  clippedElementCount: number;
  clippedElementExamples: string[];
  textClippingCount: number;
  textClippingExamples: string[];
  textOcclusionCount: number;
  textOcclusionExamples: string[];
  headerControlCollisionCount: number;
  headerControlCollisionExamples: string[];
  headerControlWrapCount: number;
  headerControlWrapExamples: string[];
  inlineLinkClusterCount: number;
  inlineLinkClusterExamples: string[];
  unstructuredFooterGroupCount: number;
  unstructuredFooterGroupExamples: string[];
  narrowMediaSplitCount: number;
  narrowMediaSplitExamples: string[];
  longMobileCardWallCount: number;
  longMobileCardWallExamples: string[];
  fragmentedHeadingCount: number;
  fragmentedHeadingExamples: string[];
  mediaContainerOverflowCount: number;
  mediaContainerOverflowExamples: string[];
  headerBrandCollisionCount: number;
  headerBrandCollisionExamples: string[];
  headerContentOcclusionCount: number;
  headerContentOcclusionExamples: string[];
  croppedTransparentGraphicCount: number;
  croppedTransparentGraphicExamples: string[];
  syntheticIdentityDeviceCount: number;
  syntheticIdentityDeviceExamples: string[];
  geographyCircleDeviceCount: number;
  geographyCircleDeviceExamples: string[];
  decorativeDiagramCount: number;
  decorativeDiagramExamples: string[];
  duplicateHeaderActionCount: number;
  duplicateHeaderActionExamples: string[];
  callActionDestinationMismatchCount: number;
  callActionDestinationMismatchExamples: string[];
  callActionLabelSpacingCount: number;
  callActionLabelSpacingExamples: string[];
  falseAffordanceCount: number;
  falseAffordanceExamples: string[];
  repeatedSourceImageCount: number;
  repeatedSourceImageExamples: string[];
  primaryHeadingAboveFold: boolean;
  primaryActionAboveFold: boolean;
  primaryHeadingBeforeAction: boolean;
  imageAltQualityCount: number;
  imageAltQualityExamples: string[];
  filteredRasterLogoCount: number;
  filteredRasterLogoExamples: string[];
  oversizedFooterRasterLogoCount: number;
  oversizedFooterRasterLogoExamples: string[];
  undersizedPrimaryRasterLogoCount: number;
  undersizedPrimaryRasterLogoExamples: string[];
  lowContrastPrimaryLogoCount: number;
  lowContrastPrimaryLogoExamples: string[];
  renderedAssetRevisionIds: string[];
  renderedFactIds: string[];
  lazyAboveFoldImageCount: number;
  lazyAboveFoldImageExamples: string[];
  missingMobileNavigation: boolean;
  indiscernibleMobileNavigationToggleExamples: string[];
  mobileNavigationOverflowExamples: string[];
  misalignedMobileNavigationToggleExamples: string[];
  duplicateManagedNavigationIconExamples: string[];
  desktopDualNavigationExamples: string[];
  escapedEntityExamples: string[];
  escapedSequenceExamples: string[];
  links: string[];
};

const browserInspectionSource = String.raw`(() => {
    const canonicalLogoRevisionIds = new Set(globalThis.__lodestaCanonicalLogoRevisionIds ?? []);
    const ownerLogoRevisionIds = new Set(globalThis.__lodestaOwnerLogoRevisionIds ?? []);
    const assetRevisionId = (image) => {
      if (!(image instanceof HTMLImageElement)) return undefined;
      try {
        const match = new URL(image.currentSrc || image.src, document.baseURI).pathname.match(/^\/_lodesta\/assets\/([^/]+)$/);
        return match ? decodeURIComponent(match[1]) : undefined;
      } catch {
        return undefined;
      }
    };
    const isCanonicalLogoImage = (image) => {
      const revisionId = assetRevisionId(image);
      return Boolean(revisionId && canonicalLogoRevisionIds.has(revisionId));
    };
    const isOwnerLogoImage = (image) => {
      const revisionId = assetRevisionId(image);
      return Boolean(revisionId && ownerLogoRevisionIds.has(revisionId));
    };
    const colorTools = {
      parse(value) {
        if (!/^rgba?\(/i.test(value.trim())) return { valid: false, channels: [0, 0, 0, 0] };
        const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
        if (parts.length < 3) return { valid: false, channels: [0, 0, 0, 0] };
        return { valid: true, channels: [parts[0], parts[1], parts[2], parts[3] ?? 1] };
      },
      luminance(color) {
        const channels = color.slice(0, 3).map((value) => {
          const channel = value / 255;
          return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      },
      contrast(left, right) {
        const a = colorTools.luminance(left);
        const b = colorTools.luminance(right);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      },
      composite(foreground, background) {
        const alpha = Math.max(0, Math.min(1, foreground[3] ?? 1));
        return [
          foreground[0] * alpha + background[0] * (1 - alpha),
          foreground[1] * alpha + background[1] * (1 - alpha),
          foreground[2] * alpha + background[2] * (1 - alpha),
          1
        ];
      },
      contrastFor(element) {
        const foregroundValue = getComputedStyle(element).color;
        const foreground = colorTools.parse(foregroundValue);
        if (!foreground.valid || foreground.channels[3] <= 0.001) return { reliable: false };
        let current = element;
        let background;
        let backgroundValue = "rgb(255, 255, 255)";
        while (current) {
          const style = getComputedStyle(current);
          if (
            style.backgroundImage !== "none"
            || Number(style.opacity) < 0.999
            || style.filter !== "none"
            || style.mixBlendMode !== "normal"
          ) return { reliable: false };
          const candidate = style.backgroundColor;
          const parsed = colorTools.parse(candidate);
          if (!parsed.valid) return { reliable: false };
          if (parsed.channels[3] >= 0.999) {
            background = parsed.channels;
            backgroundValue = candidate;
            break;
          }
          if (parsed.channels[3] > 0.001) return { reliable: false };
          current = current.parentElement;
        }
        background ??= [255, 255, 255, 1];
        const effectiveForeground = colorTools.composite(foreground.channels, background);
        const style = getComputedStyle(element);
        const fontSize = Number.parseFloat(style.fontSize);
        const fontWeight = Number.parseInt(style.fontWeight, 10) || (/bold/i.test(style.fontWeight) ? 700 : 400);
        const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
        return {
          reliable: true,
          ratio: colorTools.contrast(effectiveForeground, background),
          requiredRatio: large ? 3 : 4.5,
          foreground: foregroundValue,
          background: backgroundValue
        };
      },
      selectorFor(element) {
        if (element.id) return element.tagName.toLowerCase() + "#" + CSS.escape(element.id);
        const classes = [...element.classList].slice(0, 2).map((name) => "." + CSS.escape(name)).join("");
        return element.tagName.toLowerCase() + classes;
      },
      visible(element) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const closedDetails = element.closest("details:not([open])");
        if (closedDetails) {
          const summary = closedDetails.querySelector(":scope > summary");
          if (!summary || (element !== summary && !summary.contains(element))) return false;
        }
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0
          && rect.width > 0
          && rect.height > 0;
      },
      textFor(element) {
        if (element instanceof HTMLInputElement) {
          return ["button", "submit", "reset"].includes(element.type) ? element.value.trim() : "";
        }
        if (element instanceof HTMLTextAreaElement) return element.value.trim();
        if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.textContent?.trim() ?? "";
        return (element.innerText ?? "").trim().replace(/\s+/g, " ");
      }
    };
    const root = document.documentElement;
    const documentWidth = root.scrollWidth;
    const documentHeight = Math.max(root.scrollHeight, document.body.scrollHeight);
    const rectValue = (rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: Math.max(0, rect.right - rect.left),
      height: Math.max(0, rect.bottom - rect.top)
    });
    const elementGeometryExample = (element) => {
      const rect = element.getBoundingClientRect();
      const label = element.getAttribute("aria-label")
        || element.getAttribute("alt")
        || colorTools.textFor(element)
        || element.getAttribute("name")
        || element.getAttribute("type")
        || "unlabeled";
      const bounds = [];
      if (rect.left < 0) bounds.push(Math.round(Math.abs(rect.left)) + "px beyond left");
      if (rect.right > innerWidth) bounds.push(Math.round(rect.right - innerWidth) + "px beyond right");
      if (rect.top < 0) bounds.push(Math.round(Math.abs(rect.top)) + "px beyond top");
      const component = element.closest("[id],[class]");
      const componentStyle = component ? getComputedStyle(component) : undefined;
      const componentLayout = componentStyle?.display === "grid"
        ? "grid " + componentStyle.gridTemplateColumns
        : componentStyle?.display === "flex"
          ? "flex " + componentStyle.flexDirection
          : componentStyle?.display;
      const context = component && component !== element
        ? "; within " + colorTools.selectorFor(component) + (componentLayout ? " (" + componentLayout + ")" : "")
        : "";
      return colorTools.selectorFor(element)
        + " \"" + label.slice(0, 60) + "\" ("
        + Math.round(rect.width * 10) / 10 + "×" + Math.round(rect.height * 10) / 10 + "px; x "
        + Math.round(rect.left) + ".." + Math.round(rect.right) + " of " + innerWidth + "px"
        + "; y " + Math.round(rect.top) + ".." + Math.round(rect.bottom)
        + (bounds.length ? "; " + bounds.join(", ") : "")
        + context + ")";
    };
    const intersect = (left, right) => {
      const value = {
        left: Math.max(left.left, right.left),
        top: Math.max(left.top, right.top),
        right: Math.min(left.right, right.right),
        bottom: Math.min(left.bottom, right.bottom),
        width: 0,
        height: 0
      };
      value.width = Math.max(0, value.right - value.left);
      value.height = Math.max(0, value.bottom - value.top);
      return value;
    };
    const rectArea = (rect) => rect.width * rect.height;
    const documentRect = {
      left: 0,
      top: 0,
      right: documentWidth,
      bottom: documentHeight,
      width: documentWidth,
      height: documentHeight
    };
    const clippedRect = (element, raw) => {
      let visible = intersect(raw, documentRect);
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        const clipsX = ["hidden", "clip", "scroll", "auto"].includes(style.overflowX);
        const clipsY = ["hidden", "clip", "scroll", "auto"].includes(style.overflowY);
        if (!clipsX && !clipsY) continue;
        const bounds = rectValue(current.getBoundingClientRect());
        const clip = {
          left: clipsX ? bounds.left : documentRect.left,
          right: clipsX ? bounds.right : documentRect.right,
          top: clipsY ? bounds.top : documentRect.top,
          bottom: clipsY ? bounds.bottom : documentRect.bottom,
          width: 0,
          height: 0
        };
        clip.width = Math.max(0, clip.right - clip.left);
        clip.height = Math.max(0, clip.bottom - clip.top);
        visible = intersect(visible, clip);
      }
      return visible;
    };
    const elements = [...document.querySelectorAll("body *")];
    const visibleText = elements.filter((element) => {
      if (!colorTools.visible(element)) return false;
      const hasOwnText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0);
      const hasControlText = ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) && Boolean(colorTools.textFor(element));
      return hasOwnText || hasControlText;
    });
    const adjacentDuplicateText = elements.filter((element) => {
      if (!colorTools.visible(element)) return false;
      if (element.closest('[aria-hidden="true"],script,style,svg')) return false;
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length < 3 || text.length > 120) return false;
      if (!/(?:^|\s)([a-z][a-z'-]*)(?:[\s,.:;!?—–-]+)\1(?:$|\s|[,.:;!?—–-])/i.test(text)) return false;
      return ![...element.children].some((child) => {
        const childText = (child.textContent ?? "").replace(/\s+/g, " ").trim();
        return childText.length >= 3
          && childText.length <= 120
          && /(?:^|\s)([a-z][a-z'-]*)(?:[\s,.:;!?—–-]+)\1(?:$|\s|[,.:;!?—–-])/i.test(childText);
      });
    });
    const adjacentDuplicateContentBlocks = elements.flatMap((element) => {
      if (!colorTools.visible(element) || !element.matches("main > section,main > article,[role='main'] > section,[role='main'] > article")) return [];
      const sibling = element.nextElementSibling;
      if (!sibling || !colorTools.visible(sibling) || sibling.tagName !== element.tagName) return [];
      const normalize = (value) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
      const text = normalize(colorTools.textFor(element));
      const siblingText = normalize(colorTools.textFor(sibling));
      if (text.length < 60 || text.length > 2_000 || text !== siblingText) return [];
      const rect = element.getBoundingClientRect();
      const siblingRect = sibling.getBoundingClientRect();
      if (rect.width < 200 || siblingRect.width < 200 || rect.height < 80 || siblingRect.height < 80) return [];
      return [{ element, sibling, text }];
    });
    // Provenance language inside a closed disclosure or responsive panel is still
    // customer-facing once the control is opened. Inspect authored text nodes in
    // the DOM instead of limiting this advisory check to the current paint state.
    const authoredText = elements.filter((element) =>
      [...element.childNodes].some((node) =>
        node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0));
    const internalProvenanceCopy = authoredText.filter((element) => {
      if (element.closest('[aria-hidden="true"],script,style,svg')) return false;
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length < 12) return false;
      return /\bretained\s+(?:mission|page|faq|source|copy|content|text|language|context|evidence|material|services?|story|positioning)\b/i.test(text)
        || /\bcanonical\s+(?:page|source|copy|content|language|context|evidence|material|services?)\b/i.test(text)
        || /\bowner-authoritative\b/i.test(text)
        || /\bsource\s+(?:page|site|content|copy|language|context|evidence|material|services?|service pages?)\b/i.test(text)
        || /\b(?:service|website|site|page|marketing)\s+language\b/i.test(text)
        || /\b(?:service|treatment)\s+guidance\s+(?:centers?|emphasizes?|focuses?)\b/i.test(text)
        || /\b(?:residential\s+)?(?:service|product|treatment)\s+material\s+(?:centers?|emphasizes?|focuses?|describes?|states?|says?)\b/i.test(text)
        || /\b(?:[a-z][a-z'-]*\s+)?page\s+(?:lists?|describes?|centers?|introduces?|states?|says?|notes?|recommends?)\b/i.test(text)
        || /\b(?:the\s+)?(?:company|business)\s+(?:centers?|describes?|emphasizes?|focuses?|frames?|presents?|says?|states?)\b/i.test(text)
        || /\bdescribes\s+its\s+(?:work|approach|service|services|mission|positioning|focus|method)\s+as\b/i.test(text)
        || /\bthis\s+(?:site|website)\s+(?:turns?|presents?|frames?|translates?|uses?)\b/i.test(text)
        || /\bpublic\s+(?:story|copy|language|content)\b/i.test(text)
        || /\bdescribed as\b/i.test(text);
    });
    const vagueProcessCopy = authoredText.filter((element) => {
      if (element.closest('[aria-hidden="true"],script,style,svg')) return false;
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length < 8) return false;
      return /\b(?:next step|starting point|place to start|where to begin|service conversation|clear path|local service information)\b/i.test(text);
    });
    const bodyText = visibleText.filter((element) =>
      ["P", "LI", "DD", "DT", "LABEL", "BLOCKQUOTE", "ADDRESS", "A", "BUTTON"].includes(element.tagName)
      || element.matches("[role=button],input[type=button],input[type=submit],input[type=reset]")
      || Boolean(element.closest("p,li,dd,dt,label,blockquote,address,a[href],button,[role=button]")));
    const bodyFontText = bodyText.filter((element) => {
      if (element.closest("nav,[class*='utility'],[class*='eyebrow'],[class*='kicker'],[class*='index'],[class*='caption'],[class*='meta'],[class*='overline'],[class*='footer-label'],[class*='section-label'],[class*='section_label'],[class*='form-step']")) return false;
      if (element.closest("form")) return false;
      if (element.matches("a,button,[role=button],input[type=button],input[type=submit],input[type=reset]")) return false;
      if (element.closest("button,[role=button]")) return false;
      if (element.closest("a[href]") && !element.matches("p,li,dd,dt,blockquote,address")) return false;
      const style = getComputedStyle(element);
      const text = colorTools.textFor(element);
      const letterSpacing = Number.parseFloat(style.letterSpacing);
      const compactUppercaseLabel = text.length <= 40
        && /[A-Z]/.test(text)
        && text === text.toUpperCase()
        && (style.textTransform === "uppercase" || (Number.isFinite(letterSpacing) && letterSpacing >= 0.5));
      if (compactUppercaseLabel) return false;
      return true;
    });
    const fontSizes = bodyFontText.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)).filter(Number.isFinite);
    const textExample = (element) => ({
      selector: colorTools.selectorFor(element),
      text: colorTools.textFor(element).slice(0, 80),
      fontSizePx: Math.round(Number.parseFloat(getComputedStyle(element).fontSize) * 100) / 100
    });
    const smallBodyText = bodyFontText.filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 16);
    const smallBodyFamilyMap = new Map();
    for (const element of smallBodyText) {
      const familyRoot = element.closest("[class]");
      const selector = familyRoot
        ? element.tagName.toLowerCase() + " within " + colorTools.selectorFor(familyRoot)
        : element.tagName.toLowerCase();
      const fontSizePx = Math.round(Number.parseFloat(getComputedStyle(element).fontSize) * 100) / 100;
      const current = smallBodyFamilyMap.get(selector);
      smallBodyFamilyMap.set(selector, current
        ? { selector, count: current.count + 1, minFontSizePx: Math.min(current.minFontSizePx, fontSizePx) }
        : { selector, count: 1, minFontSizePx: fontSizePx });
    }
    const smallBodyTextFamilies = [...smallBodyFamilyMap.values()]
      .sort((left, right) => right.count - left.count || left.minFontSizePx - right.minFontSizePx || left.selector.localeCompare(right.selector))
      .slice(0, 8);
    const disclosureTextExample = (element) => ({
      selector: colorTools.selectorFor(element),
      text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
      fontSizePx: Math.round(Number.parseFloat(getComputedStyle(element).fontSize) * 100) / 100
    });
    const smallDisclosureText = [...document.querySelectorAll("details p,details li,details dd,details blockquote,[data-lodesta-disclosure] p,[data-lodesta-disclosure] li,[data-lodesta-disclosure] dd,[data-lodesta-disclosure] blockquote")]
      .filter((element) => (element.textContent?.trim().length ?? 0) > 0)
      .filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 16);
    const smallFormText = [...document.querySelectorAll("form label,form input,form textarea,form select,form button")]
      .filter((element) => colorTools.visible(element))
      .filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 16);
    const tinyVisibleText = visibleText.filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 12);
    const tinyTextFamilyMap = new Map();
    for (const element of tinyVisibleText) {
      const familyRoot = element.closest("[class]");
      const selector = familyRoot
        ? element.tagName.toLowerCase() + " within " + colorTools.selectorFor(familyRoot)
        : element.tagName.toLowerCase();
      const fontSizePx = Math.round(Number.parseFloat(getComputedStyle(element).fontSize) * 100) / 100;
      const current = tinyTextFamilyMap.get(selector);
      tinyTextFamilyMap.set(selector, current
        ? { selector, count: current.count + 1, minFontSizePx: Math.min(current.minFontSizePx, fontSizePx) }
        : { selector, count: 1, minFontSizePx: fontSizePx });
    }
    const tinyTextFamilies = [...tinyTextFamilyMap.values()]
      .sort((left, right) => right.count - left.count || left.minFontSizePx - right.minFontSizePx || left.selector.localeCompare(right.selector))
      .slice(0, 8);
    const controls = [...document.querySelectorAll("a[href],button,[role=button],input[type=button],input[type=submit],input[type=reset]")];
    const contrastText = [...new Set([
      ...bodyText,
      ...controls.filter((element) =>
        colorTools.visible(element)
        && colorTools.textFor(element).length > 0
        && !element.closest('[aria-hidden="true"],svg')),
      ...visibleText.filter((element) =>
        (colorTools.textFor(element).length >= 20 || Boolean(element.closest("h1")))
        && !element.closest('[aria-hidden="true"],svg'))
    ])];
    const conventionalLowContrast = contrastText
      .map((element) => ({ element, ...colorTools.contrastFor(element) }))
      .filter((item) => item.reliable && item.ratio < item.requiredRatio);
    const resolvedPixel = (value) => {
      if (!value || value === "auto") return undefined;
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const positionedPseudoSurfaces = (element) => {
      const surfaces = [];
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const ancestorRect = rectValue(ancestor.getBoundingClientRect());
        for (const pseudoName of ["::before", "::after"]) {
          const pseudo = getComputedStyle(ancestor, pseudoName);
          if (!pseudo.content || ["none", "normal"].includes(pseudo.content)) continue;
          if (!['absolute', 'fixed'].includes(pseudo.position) || pseudo.backgroundImage !== "none") continue;
          const background = colorTools.parse(pseudo.backgroundColor);
          const pseudoOpacity = Number(pseudo.opacity);
          if (!background.valid || background.channels[3] < 0.5 || !Number.isFinite(pseudoOpacity) || pseudoOpacity < 0.5) continue;
          const left = resolvedPixel(pseudo.left);
          const right = resolvedPixel(pseudo.right);
          const top = resolvedPixel(pseudo.top);
          const bottom = resolvedPixel(pseudo.bottom);
          const declaredWidth = resolvedPixel(pseudo.width);
          const declaredHeight = resolvedPixel(pseudo.height);
          const width = declaredWidth ?? (left !== undefined && right !== undefined
            ? Math.max(0, ancestorRect.width - left - right)
            : ancestorRect.width);
          const height = declaredHeight ?? (top !== undefined && bottom !== undefined
            ? Math.max(0, ancestorRect.height - top - bottom)
            : ancestorRect.height);
          const rect = {
            left: ancestorRect.left + (left ?? (right !== undefined ? ancestorRect.width - right - width : 0)),
            top: ancestorRect.top + (top ?? (bottom !== undefined ? ancestorRect.height - bottom - height : 0)),
            width,
            height,
            right: 0,
            bottom: 0
          };
          rect.right = rect.left + rect.width;
          rect.bottom = rect.top + rect.height;
          if (rect.width <= 1 || rect.height <= 1) continue;
          surfaces.push({
            ancestor,
            pseudoName,
            rect,
            background: [
              background.channels[0],
              background.channels[1],
              background.channels[2],
              background.channels[3] * pseudoOpacity
            ],
            backgroundValue: pseudo.backgroundColor
          });
        }
      }
      return surfaces;
    };
    const pseudoLowContrast = [];
    const textSurfaceBoundaries = [];
    for (const element of contrastText) {
      const elementRect = rectValue(element.getBoundingClientRect());
      const elementArea = rectArea(elementRect);
      if (elementArea <= 1) continue;
      for (const surface of positionedPseudoSurfaces(element)) {
        const overlapRatio = rectArea(intersect(elementRect, surface.rect)) / elementArea;
        if (overlapRatio >= 0.08 && overlapRatio <= 0.92) {
          textSurfaceBoundaries.push(
            colorTools.selectorFor(element) + " \"" + colorTools.textFor(element).slice(0, 80)
            + "\" crosses " + colorTools.selectorFor(surface.ancestor) + surface.pseudoName
            + " (" + Math.round(overlapRatio * 100) + "% overlap)"
          );
        }
        const belongsToPrimaryHeading = Boolean(element.closest("h1"));
        if (overlapRatio < (belongsToPrimaryHeading ? 0.08 : 0.65)) continue;
        const foregroundValue = getComputedStyle(element).color;
        const foreground = colorTools.parse(foregroundValue);
        if (!foreground.valid || foreground.channels[3] <= 0.001) continue;
        const effectiveForeground = colorTools.composite(foreground.channels, surface.background);
        const style = getComputedStyle(element);
        const fontSize = Number.parseFloat(style.fontSize);
        const fontWeight = Number.parseInt(style.fontWeight, 10) || (/bold/i.test(style.fontWeight) ? 700 : 400);
        const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
        const requiredRatio = large ? 3 : 4.5;
        const ratio = colorTools.contrast(effectiveForeground, surface.background);
        if (ratio < requiredRatio) pseudoLowContrast.push({
          element,
          reliable: true,
          ratio,
          requiredRatio,
          foreground: foregroundValue,
          background: surface.backgroundValue
        });
      }
    }
    const lowContrast = [...conventionalLowContrast, ...pseudoLowContrast].filter((item, index, items) =>
      items.findIndex((candidate) => candidate.element === item.element && candidate.background === item.background) === index);
    const managed = [...document.querySelectorAll("[data-lodesta-map],[data-lodesta-form-id],[data-lodesta-gallery],[data-lodesta-disclosure]")];
    const clippedManagedContent = managed.filter((element) => {
      if (!colorTools.visible(element)) return false;
      const style = getComputedStyle(element);
      const clippedX = ["hidden", "clip"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 2;
      const clippedY = ["hidden", "clip"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
      if (!clippedX && !clippedY) return false;
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll("*")].some((descendant) => {
        if (!colorTools.visible(descendant)) return false;
        const rect = descendant.getBoundingClientRect();
        const hasContent = Boolean(colorTools.textFor(descendant))
          || descendant.matches("a,button,input,select,textarea,img,svg");
        return hasContent && (
          (clippedY && (rect.bottom > bounds.bottom + 2 || rect.top < bounds.top - 2))
          || (clippedX && (rect.right > bounds.right + 2 || rect.left < bounds.left - 2))
        );
      });
    });
    const constrainedManagedMaps = innerWidth >= 720
      ? [...document.querySelectorAll("[data-lodesta-map]")].flatMap((element) => {
          if (!colorTools.visible(element)) return [];
          const surface = element.querySelector("[data-lodesta-map-surface]");
          if (!surface || !colorTools.visible(surface)) return [];
          const columns = getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean);
          const surfaceRect = surface.getBoundingClientRect();
          return columns.length > 1 && surfaceRect.width < 160
            ? [{ element, surfaceWidth: surfaceRect.width, totalWidth: element.getBoundingClientRect().width }]
            : [];
        })
      : [];
    const formFields = [...document.querySelectorAll("input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]),select,textarea")];
    const oversizedSingleLineFields = formFields.filter((element) =>
      !element.matches("textarea")
      && colorTools.visible(element)
      && element.getBoundingClientRect().height > 96);
    const duplicateFieldLabels = formFields.flatMap((field) => {
      const id = field.getAttribute("id");
      if (!id) return [];
      const labels = [...document.querySelectorAll("label[for=\"" + CSS.escape(id) + "\"]")]
        .filter((label) => colorTools.visible(label));
      return labels.length > 1 ? [{ field, labels }] : [];
    });
    const hasVisibleControlArtwork = (control) => {
      const visibleGraphic = [...control.querySelectorAll("img,svg,canvas,picture")]
        .some((graphic) => colorTools.visible(graphic));
      if (visibleGraphic) return true;
      return [...control.querySelectorAll("*")]
        .filter((element) => colorTools.visible(element))
        .some((element) => {
          const style = getComputedStyle(element);
          const background = colorTools.parse(style.backgroundColor);
          const borderWidth = Math.max(
            Number.parseFloat(style.borderTopWidth) || 0,
            Number.parseFloat(style.borderRightWidth) || 0,
            Number.parseFloat(style.borderBottomWidth) || 0,
            Number.parseFloat(style.borderLeftWidth) || 0
          );
          const borderColor = colorTools.parse(style.borderTopColor);
          return style.backgroundImage !== "none"
            || (background.valid && background.channels[3] > .04)
            || (borderWidth > 0 && borderColor.valid && borderColor.channels[3] > .04);
        });
    };
    const emptyControls = controls.filter((element) => {
      if (!colorTools.visible(element)) return false;
      const style = getComputedStyle(element);
      const pseudo = [getComputedStyle(element, "::before"), getComputedStyle(element, "::after")]
        .some((value) => value.content && !["none", "normal", "\"\"", "''"].includes(value.content));
      // Managed icon geometry is verified by the navigation probe. Its
      // reserved marker is enough to avoid duplicating that failure as a
      // generic empty-control finding.
      const visibleManagedGraphic = Boolean(element.querySelector("[data-lodesta-navigation-icon]"));
      const backgroundGraphic = style.backgroundImage !== "none";
      return !colorTools.textFor(element)
        && !pseudo
        && !hasVisibleControlArtwork(element)
        && !visibleManagedGraphic
        && !backgroundGraphic;
    });
    const primaryActionPattern = /\b(call|contact|book|schedule|reserve|order|quote|estimate|appointment|consult|consultation|conversation|help|request|inquire|get started|get in touch)\b/i;
    const primaryActions = controls.filter((element) => {
      const href = element.getAttribute("href") ?? "";
      const label = colorTools.textFor(element) + " " + (element.getAttribute("aria-label") ?? "");
      const authoredMainAction = Boolean(element.closest("main"))
        && element.matches("button,[role=button],[class*='button'],[class*='cta']");
      return colorTools.visible(element)
        && (authoredMainAction || /^(?:tel:|mailto:)/i.test(href) || primaryActionPattern.test(label));
    });
    const mainPrimaryActions = primaryActions.filter((element) => element.closest("main"));
    const primaryTouchActions = primaryActions.filter((element) =>
      element.closest("main")
      || element.matches("button,[role=button],[class*='button'],[class*='cta']"));
    const primaryAction = mainPrimaryActions
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .sort((left, right) => left.rect.top - right.rect.top)[0];
    const primaryHeading = [...document.querySelectorAll("h1")].find((element) => colorTools.visible(element));
    const primaryHeadingRect = primaryHeading?.getBoundingClientRect();
    const essentialTargets = [
      ...controls.filter((element) =>
        colorTools.visible(element)
        && (
          element.matches("button,input[type=button],input[type=submit],input[type=reset],[data-lodesta-menu-toggle]")
          || (innerWidth <= 640 && element.matches("header a[href]"))
          || primaryTouchActions.includes(element)
        )
      ),
      ...formFields.filter((element) => colorTools.visible(element))
    ];
    const smallTargets = essentialTargets.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width < 43.5 || rect.height < 43.5;
    });
    const hitTestFailures = essentialTargets.filter((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return !hit || (hit !== element && !element.contains(hit));
    });
    const headerControlHitTestFailures = controls.flatMap((element) => {
      if (!colorTools.visible(element) || !element.closest("header")) return [];
      const rect = element.getBoundingClientRect();
      const points = [0.2, 0.5, 0.8].flatMap((xRatio) => [0.2, 0.5, 0.8].map((yRatio) => ({
        x: rect.left + rect.width * xRatio,
        y: rect.top + rect.height * yRatio
      }))).filter(({ x, y }) => x >= 0 && x < innerWidth && y >= 0 && y < innerHeight);
      if (points.length < 3) return [];
      const ownedPoints = points.filter(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit === element || Boolean(hit && element.contains(hit));
      }).length;
      if (ownedPoints / points.length >= 0.75) return [];
      const label = colorTools.textFor(element)
        || element.getAttribute("aria-label")
        || "unlabeled control";
      return [
        colorTools.selectorFor(element) + " \"" + label.slice(0, 60) + "\" owns only "
        + ownedPoints + "/" + points.length + " sampled hit points"
      ];
    });
    const browserDefaultControls = elements.filter((element) => {
      if (
        !colorTools.visible(element)
        || !element.matches("button:not([data-lodesta-menu-toggle]),input[type=button],input[type=submit],input[type=reset]")
      ) return false;
      const style = getComputedStyle(element);
      const borderStyles = [style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle];
      return style.appearance !== "none" && borderStyles.some((value) => value === "outset" || value === "inset");
    });
    const bodyStyle = getComputedStyle(document.body);
    const defaultBlueLinks = [...document.querySelectorAll("a")].filter((element) => {
      if (!colorTools.visible(element)) return false;
      const style = getComputedStyle(element);
      return style.color === "rgb(0, 0, 238)" && style.textDecorationLine.includes("underline");
    });
    const browserDefaultActionAnchors = [...document.querySelectorAll("a")].filter((element) => {
      if (!colorTools.visible(element) || !/(?:^|\s)(?:button|btn|cta)(?:\s|$|-)/i.test(element.className)) return false;
      const style = getComputedStyle(element);
      const background = colorTools.parse(style.backgroundColor);
      const borderWidth = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
        .reduce((total, value) => total + (parseFloat(value) || 0), 0);
      return element.getBoundingClientRect().height < 28
        && (!background.valid || background.channels[3] <= 0.001)
        && borderWidth <= 0.1;
    });
    const browserDefaultDocument = (
      browserDefaultActionAnchors.length > 0
      || (/(?:times new roman|serif)/i.test(bodyStyle.fontFamily) && defaultBlueLinks.length >= 2)
    );
    const intentionalHeaderLogoCrop = (element) => {
      if (!(element instanceof HTMLImageElement) || !element.closest("header") || !isOwnerLogoImage(element)) return false;
      const header = element.closest("header");
      const imageRect = element.getBoundingClientRect();
      for (let current = element.parentElement; current && current !== header; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (!["hidden", "clip"].includes(style.overflowX) && !["hidden", "clip"].includes(style.overflowY)) continue;
        const cropRect = current.getBoundingClientRect();
        const fullyVisible = cropRect.left >= -2
          && cropRect.right <= innerWidth + 2
          && cropRect.top >= -2
          && cropRect.width > 0
          && cropRect.height > 0;
        const actuallyCrops = imageRect.width > cropRect.width + 2 || imageRect.height > cropRect.height + 2;
        if (fullyVisible && actuallyCrops) return true;
      }
      return false;
    };
    const intentionallyVisuallyHidden = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const clipped = style.clip !== "auto" || (style.clipPath !== "none" && style.clipPath !== "");
      const overflowClipped = [style.overflowX, style.overflowY].some((value) => ["hidden", "clip"].includes(value));
      return ["absolute", "fixed"].includes(style.position)
        && rect.width <= 2
        && rect.height <= 2
        && overflowClipped
        && (clipped || style.whiteSpace === "nowrap");
    };
    const clippedElements = elements.filter((element) => {
      if (!colorTools.visible(element) || !element.matches("h1,h2,h3,p,img,a[href],button,input,select,textarea")) return false;
      if (intentionallyVisuallyHidden(element)) return false;
      if (intentionalHeaderLogoCrop(element)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.left < -2
        || rect.right > innerWidth + 2
        || rect.top < -2
        || (element.scrollWidth > element.clientWidth + 2 && ["hidden", "clip"].includes(style.overflowX));
    });
    const textClipping = [];
    const textBoxes = [];
    const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = textWalker.nextNode(); node; node = textWalker.nextNode()) {
      const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const parent = node.parentElement;
      if (!text || !parent || !colorTools.visible(parent)) continue;
      if (intentionallyVisuallyHidden(parent)) continue;
      const parentStyle = getComputedStyle(parent);
      const parentClips = ["hidden", "clip"].includes(parentStyle.overflowX)
        || ["hidden", "clip"].includes(parentStyle.overflowY);
      if (
        parentClips
        && (
          parent.scrollHeight > parent.clientHeight + 2
          || parent.scrollWidth > parent.clientWidth + 2
        )
      ) {
        const clippedArea = Math.max(
          1,
          Math.max(0, parent.scrollHeight - parent.clientHeight) * Math.max(1, parent.clientWidth)
          + Math.max(0, parent.scrollWidth - parent.clientWidth) * Math.max(1, parent.clientHeight)
        );
        if (clippedArea >= 64) {
          textClipping.push(
            colorTools.selectorFor(parent) + " \"" + text.slice(0, 80) + "\" (" + Math.round(clippedArea) + "px² clipped)"
          );
        }
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const clientRect of range.getClientRects()) {
        const raw = rectValue(clientRect);
        if (raw.width <= 1 || raw.height <= 1) continue;
        const visibleRect = clippedRect(parent, raw);
        if (rectArea(visibleRect) <= 1) continue;
        textBoxes.push({
          element: parent,
          selector: colorTools.selectorFor(parent),
          text: text.slice(0, 120),
          visibleRect
        });
        if (rectArea(visibleRect) < rectArea(raw) * 0.75) {
          textClipping.push(
            colorTools.selectorFor(parent) + " \"" + text.slice(0, 80) + "\" (" + Math.round(rectArea(raw) - rectArea(visibleRect)) + "px² clipped)"
          );
        }
      }
    }
    const textOcclusion = [];
    const headerControlCollisions = [];
    for (let firstIndex = 0; firstIndex < textBoxes.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < textBoxes.length; secondIndex += 1) {
        const first = textBoxes[firstIndex];
        const second = textBoxes[secondIndex];
        if (
          first.element === second.element
          || first.element.contains(second.element)
          || second.element.contains(first.element)
        ) continue;
        const overlap = intersect(first.visibleRect, second.visibleRect);
        const overlapArea = rectArea(overlap);
        const smallerArea = Math.min(rectArea(first.visibleRect), rectArea(second.visibleRect));
        if (overlapArea < 10 || overlapArea < smallerArea * 0.06) continue;
        const firstHeaderControl = first.element.closest("header a[href],header button,header [role=button]");
        const secondHeaderControl = second.element.closest("header a[href],header button,header [role=button]");
        if (
          firstHeaderControl
          && secondHeaderControl
          && firstHeaderControl !== secondHeaderControl
          && !firstHeaderControl.contains(secondHeaderControl)
          && !secondHeaderControl.contains(firstHeaderControl)
        ) {
          headerControlCollisions.push(
            colorTools.selectorFor(firstHeaderControl) + " \"" + colorTools.textFor(firstHeaderControl).slice(0, 60) + "\" overlaps "
            + colorTools.selectorFor(secondHeaderControl) + " \"" + colorTools.textFor(secondHeaderControl).slice(0, 60) + "\" ("
            + Math.round(overlapArea) + "px²)"
          );
        }
        const firstAncestors = new Set();
        for (let current = first.element; current; current = current.parentElement) firstAncestors.add(current);
        let commonAncestor = document.body;
        for (let current = second.element; current; current = current.parentElement) {
          if (firstAncestors.has(current)) {
            commonAncestor = current;
            break;
          }
        }
        if (commonAncestor.matches("a,button,label,summary")) continue;
        const hasCollisionRisk = (element) => {
          for (let current = element; current && current !== commonAncestor; current = current.parentElement) {
            const style = getComputedStyle(current);
            const margins = [
              style.marginTop,
              style.marginRight,
              style.marginBottom,
              style.marginLeft
            ].map((value) => Number.parseFloat(value) || 0);
            if (
              ["absolute", "fixed", "sticky"].includes(style.position)
              || style.transform !== "none"
              || margins.some((value) => value < -0.5)
            ) return true;
          }
          return false;
        };
        if (!hasCollisionRisk(first.element) && !hasCollisionRisk(second.element)) continue;
        textOcclusion.push(
          first.selector + " \"" + first.text + "\" intersects "
          + second.selector + " \"" + second.text + "\" (" + Math.round(overlapArea) + "px²)"
        );
      }
    }
    const visibleHeaders = [...document.querySelectorAll("header")].filter((header) =>
      colorTools.visible(header)
      // Content authors legitimately use <header> for article and section
      // introductions. Only page-level chrome can cover main content; treating
      // a main/article header as chrome reports every heading as overlapping
      // its own container and sends the author on a phantom repair loop.
      && !header.closest("main,article,footer")
    );
    const headerContentOcclusions = textBoxes.flatMap((box) => {
      if (!box.element.closest("main")) return [];
      const boxArea = rectArea(box.visibleRect);
      if (boxArea <= 1) return [];
      return visibleHeaders.flatMap((header) => {
        const headerRect = rectValue(header.getBoundingClientRect());
        const overlap = intersect(box.visibleRect, headerRect);
        const overlapArea = rectArea(overlap);
        if (overlapArea < 8 || overlapArea < boxArea * 0.06) return [];
        const points = [
          [overlap.left + overlap.width / 2, overlap.top + overlap.height / 2],
          [overlap.left + Math.min(2, overlap.width / 2), overlap.top + overlap.height / 2],
          [overlap.right - Math.min(2, overlap.width / 2), overlap.top + overlap.height / 2]
        ];
        const covered = points.some(([x, y]) => {
          if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return false;
          const hit = document.elementFromPoint(x, y);
          return hit === header || Boolean(hit && header.contains(hit));
        });
        if (!covered) return [];
        return [
          box.selector + " \"" + box.text.slice(0, 80) + "\" overlaps "
          + colorTools.selectorFor(header) + " by " + Math.round(overlapArea) + "px²"
        ];
      });
    });
    const readableLines = bodyText.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.4;
      const lines = Math.max(1, Math.round(rect.height / lineHeight));
      return { element, characters: Math.round(colorTools.textFor(element).length / lines) };
    });
    const longLines = readableLines.filter((item) => item.characters > 90);
    const boundImages = [...document.querySelectorAll('img[src*="/_lodesta/assets/"]')];
    const renderedAssetRevisionIds = [...new Set(boundImages.flatMap((image) => {
      if (!colorTools.visible(image) || !image.complete || image.naturalWidth === 0) return [];
      try {
        const match = new URL(image.currentSrc || image.src, document.baseURI).pathname.match(/^\/_lodesta\/assets\/([^/]+)$/);
        return match ? [decodeURIComponent(match[1])] : [];
      } catch {
        return [];
      }
    }))];
    const imageAltQuality = boundImages.filter((image) => {
      if (!image.hasAttribute("alt")) return true;
      const alt = (image.getAttribute("alt") ?? "").trim();
      if (!alt) return false;
      const words = alt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
      const repeated = words.some((word) => word.length >= 4 && words.filter((candidate) => candidate === word).length >= 3);
      return alt.length < 4
        || alt.length > 220
        || /\.(?:jpe?g|png|webp|gif|svg)\b|https?:\/\/|[_-]{2,}|\b(?:img|dsc|screenshot)[\s_-]*\d+\b|^image$|\bsource photograph\b/i.test(alt)
        || /\bnear me\b/i.test(alt)
        || repeated;
    });
    const filteredRasterLogos = [...document.images].flatMap((image) => {
      if (!colorTools.visible(image)) return [];
      const identityWrapper = image.closest("[class*='brand'],[class*='logo']");
      if (!isCanonicalLogoImage(image)) return [];
      const source = image.currentSrc || image.src;
      if (/\.svg(?:[?#]|$)|image\/svg\+xml/i.test(source)) return [];
      const filteredElement = [image, identityWrapper]
        .filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index)
        .find((candidate) => getComputedStyle(candidate).filter !== "none");
      return filteredElement
        ? [{ image, filteredElement, filter: getComputedStyle(filteredElement).filter }]
        : [];
    });
    const oversizedFooterRasterLogos = [...document.images].flatMap((image) => {
      if (!colorTools.visible(image) || !image.closest("footer") || image.naturalWidth < 2 || image.naturalHeight < 2) return [];
      if (!isCanonicalLogoImage(image)) return [];
      const source = image.currentSrc || image.src;
      if (/\.svg(?:[?#]|$)|image\/svg\+xml/i.test(source)) return [];
      const rect = image.getBoundingClientRect();
      if (rect.width < 240 || rect.height < 160) return [];
      return [{ image, width: rect.width, height: rect.height }];
    });
    const undersizedPrimaryRasterLogos = [...document.images].flatMap((image) => {
      if (!colorTools.visible(image) || !image.closest("header") || image.naturalWidth < 2 || image.naturalHeight < 2) return [];
      if (!isCanonicalLogoImage(image)) return [];
      const source = image.currentSrc || image.src;
      if (/\.svg(?:[?#]|$)|image\/svg\+xml/i.test(source)) return [];
      const sampleWidth = Math.min(160, image.naturalWidth);
      const sampleHeight = Math.min(160, image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return [];
      try {
        context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
      } catch {
        return [];
      }
      let pixels;
      try {
        pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
      } catch {
        return [];
      }
      const sample = (x, y) => {
        const index = (y * sampleWidth + x) * 4;
        return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
      };
      const corners = [sample(0, 0), sample(sampleWidth - 1, 0), sample(0, sampleHeight - 1), sample(sampleWidth - 1, sampleHeight - 1)];
      const background = [0, 1, 2, 3].map((channel) => corners.reduce((sum, color) => sum + color[channel], 0) / corners.length);
      let left = sampleWidth;
      let top = sampleHeight;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < sampleHeight; y += 1) {
        for (let x = 0; x < sampleWidth; x += 1) {
          const color = sample(x, y);
          const colorDistance = Math.abs(color[0] - background[0]) + Math.abs(color[1] - background[1]) + Math.abs(color[2] - background[2]);
          const alphaDistance = Math.abs(color[3] - background[3]);
          const content = background[3] < 32 ? color[3] >= 48 : colorDistance >= 48 || alphaDistance >= 48;
          if (!content) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
      if (right < left || bottom < top) return [];
      const intrinsicContentWidth = ((right - left + 1) / sampleWidth) * image.naturalWidth;
      const intrinsicContentHeight = ((bottom - top + 1) / sampleHeight) * image.naturalHeight;
      const rect = image.getBoundingClientRect();
      const objectFit = getComputedStyle(image).objectFit;
      let visibleContentWidth;
      let visibleContentHeight;
      if (objectFit === "contain" || objectFit === "scale-down") {
        const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
        visibleContentWidth = intrinsicContentWidth * scale;
        visibleContentHeight = intrinsicContentHeight * scale;
      } else if (objectFit === "cover") {
        const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
        visibleContentWidth = Math.min(rect.width, intrinsicContentWidth * scale);
        visibleContentHeight = Math.min(rect.height, intrinsicContentHeight * scale);
      } else {
        visibleContentWidth = (intrinsicContentWidth / image.naturalWidth) * rect.width;
        visibleContentHeight = (intrinsicContentHeight / image.naturalHeight) * rect.height;
      }
      if (Math.max(visibleContentWidth, visibleContentHeight) >= 56 && Math.min(visibleContentWidth, visibleContentHeight) >= 16) return [];
      return [{
        image,
        visibleContentWidth,
        visibleContentHeight,
        boxWidth: rect.width,
        boxHeight: rect.height,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        intrinsicContentWidth,
        intrinsicContentHeight,
        objectFit
      }];
    });
    const lowContrastPrimaryLogos = [...document.images].flatMap((image) => {
      if (!colorTools.visible(image) || !image.closest("header") || image.naturalWidth < 2 || image.naturalHeight < 2) return [];
      if (!isCanonicalLogoImage(image)) return [];
      const sampleWidth = Math.min(180, image.naturalWidth);
      const sampleHeight = Math.min(180, image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return [];
      try {
        context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
      } catch {
        return [];
      }
      let pixels;
      try {
        pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
      } catch {
        return [];
      }

      let current = image;
      let surface;
      let surfaceValue = "rgb(255, 255, 255)";
      while (current) {
        const style = getComputedStyle(current);
        if (
          style.backgroundImage !== "none"
          || Number(style.opacity) < 0.999
          || style.filter !== "none"
          || style.mixBlendMode !== "normal"
        ) return [];
        const parsed = colorTools.parse(style.backgroundColor);
        if (!parsed.valid) return [];
        if (parsed.channels[3] >= 0.999) {
          surface = parsed.channels;
          surfaceValue = style.backgroundColor;
          break;
        }
        if (parsed.channels[3] > 0.001) return [];
        current = current.parentElement;
      }
      surface ??= [255, 255, 255, 1];

      let transparentPixels = 0;
      const contrasts = [];
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const alpha = pixels[offset + 3] / 255;
        if (alpha < 0.08) transparentPixels += 1;
        if (alpha < 0.25) continue;
        const effectivePixel = colorTools.composite([
          pixels[offset],
          pixels[offset + 1],
          pixels[offset + 2],
          alpha
        ], surface);
        contrasts.push(colorTools.contrast(effectivePixel, surface));
      }
      const totalPixels = sampleWidth * sampleHeight;
      if (transparentPixels / totalPixels < 0.02 || contrasts.length < 16) return [];
      contrasts.sort((left, right) => left - right);
      const medianContrast = contrasts[Math.floor(contrasts.length / 2)];
      const clearPixelShare = contrasts.filter((ratio) => ratio >= 3).length / contrasts.length;
      // A few bright accents can otherwise mask a low-contrast wordmark. The
      // majority of visible mark pixels should remain independently legible;
      // this stays advisory because multicolor marks vary substantially.
      if (medianContrast >= 3 || clearPixelShare >= 0.6) return [];
      return [{ image, medianContrast, clearPixelShare, surfaceValue }];
    });
    const lazyAboveFoldImages = [...document.images].filter((image) => {
      const rect = image.getBoundingClientRect();
      return image.getAttribute("loading")?.toLowerCase() === "lazy"
        && colorTools.visible(image)
        && rect.top < window.innerHeight
        && rect.bottom > 0;
    });
    const croppedTransparentGraphics = [...document.querySelectorAll("main img")].flatMap((image) => {
      if (!colorTools.visible(image) || !image.complete || image.naturalWidth < 2 || image.naturalHeight < 2) return [];
      if (isCanonicalLogoImage(image)) return [];
      const style = getComputedStyle(image);
      if (style.objectFit !== "cover") return [];
      const rect = image.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 80) return [];
      const sourceAspect = image.naturalWidth / image.naturalHeight;
      const boxAspect = rect.width / rect.height;
      const horizontalCrop = sourceAspect > boxAspect;
      const visibleFraction = horizontalCrop ? boxAspect / sourceAspect : sourceAspect / boxAspect;
      const croppedFraction = Math.max(0, 1 - visibleFraction);
      if (croppedFraction < .08) return [];
      try {
        const sampleWidth = Math.min(120, image.naturalWidth);
        const sampleHeight = Math.min(120, image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = sampleWidth;
        canvas.height = sampleHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return [];
        context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
        const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
        const positionTokens = style.objectPosition.trim().toLowerCase().split(/\s+/);
        const positionFraction = (token, axis) => {
          if (!token) return .5;
          if (token.endsWith("%")) return Math.min(1, Math.max(0, (Number.parseFloat(token) || 50) / 100));
          if (axis === "x" && token === "left" || axis === "y" && token === "top") return 0;
          if (axis === "x" && token === "right" || axis === "y" && token === "bottom") return 1;
          return .5;
        };
        const cropPosition = horizontalCrop
          ? positionFraction(positionTokens[0], "x")
          : positionFraction(positionTokens[1] ?? positionTokens[0], "y");
        const leadingCrop = croppedFraction * cropPosition;
        const trailingCrop = croppedFraction - leadingCrop;
        let transparentPixels = 0;
        let opaqueCroppedPixels = 0;
        const totalPixels = sampleWidth * sampleHeight;
        for (let y = 0; y < sampleHeight; y += 1) {
          for (let x = 0; x < sampleWidth; x += 1) {
            const alpha = pixels[(y * sampleWidth + x) * 4 + 3];
            if (alpha < 32) transparentPixels += 1;
            const coordinate = horizontalCrop ? x / sampleWidth : y / sampleHeight;
            const inCroppedMargin = coordinate < leadingCrop || coordinate > 1 - trailingCrop;
            if (inCroppedMargin && alpha >= 48) opaqueCroppedPixels += 1;
          }
        }
        if (transparentPixels / totalPixels < .03 || opaqueCroppedPixels < Math.max(12, totalPixels * .01)) return [];
        return [colorTools.selectorFor(image)
          + " crops " + Math.round(croppedFraction * 100) + "% of its source "
          + (horizontalCrop ? "width" : "height")
          + " and discards " + opaqueCroppedPixels + " sampled opaque edge pixels"];
      } catch {
        return [];
      }
    });
    const navLinks = [...document.querySelectorAll("nav a[href]")];
    const visibleNavLinks = navLinks.filter((link) => colorTools.visible(link));
    const visibleExplicitNavToggleControls = [...document.querySelectorAll('button[aria-controls],[role=button][aria-controls],[data-lodesta-menu-toggle],[popovertarget]')]
      .filter((control) => colorTools.visible(control));
    const visibleDisclosureNavToggleControls = [...document.querySelectorAll("details > summary")].filter((summary) =>
      colorTools.visible(summary)
      && (summary.parentElement?.querySelectorAll("a[href]").length ?? 0) >= 2);
    const visibleNavToggleControls = [...visibleExplicitNavToggleControls, ...visibleDisclosureNavToggleControls];
    const visibleNavToggle = visibleNavToggleControls.length > 0;
    const hasVisibleNavigationTriggerArtwork = (control) => {
      if (colorTools.textFor(control).trim()) return true;
      if (hasVisibleControlArtwork(control)) return true;
      return ["::before", "::after"].some((pseudo) => {
        const style = getComputedStyle(control, pseudo);
        if (style.display === "none") return false;
        const width = Number.parseFloat(style.width) || 0;
        const height = Number.parseFloat(style.height) || 0;
        if (width < 1 || height < 1) return false;
        const background = colorTools.parse(style.backgroundColor);
        const color = colorTools.parse(style.color);
        const borderWidth = Math.max(
          Number.parseFloat(style.borderTopWidth) || 0,
          Number.parseFloat(style.borderRightWidth) || 0,
          Number.parseFloat(style.borderBottomWidth) || 0,
          Number.parseFloat(style.borderLeftWidth) || 0
        );
        const borderColor = colorTools.parse(style.borderTopColor);
        const hasContent = !["none", "normal", "\"\"", "''"].includes(style.content);
        return style.backgroundImage !== "none"
          || (background.valid && background.channels[3] > .04)
          || (borderWidth > 0 && borderColor.valid && borderColor.channels[3] > .04)
          || (hasContent && color.valid && color.channels[3] > .04);
      });
    };
    const indiscernibleMobileNavigationToggles = innerWidth <= 640
      ? visibleNavToggleControls.filter((control) => !hasVisibleNavigationTriggerArtwork(control))
      : [];
    const headerActionGroups = new Map();
    const mastheadActions = [...document.querySelectorAll("a[href]")].filter((element) => {
      if (!colorTools.visible(element)) return false;
      return !element.closest("main,footer");
    });
    for (const action of mastheadActions) {
      const label = colorTools.textFor(action).replace(/[\s↗↘→←↓↑+*·•]+$/g, "").trim().toLowerCase();
      let href = action.getAttribute("href") ?? "";
      try {
        const url = new URL(action.href);
        href = (url.pathname.replace(/\/+$/, "") || "/") + url.search + url.hash;
      } catch {
        // Keep the literal destination when the browser cannot resolve it.
      }
      if (!label || !href) continue;
      const key = href + "|" + label;
      const group = headerActionGroups.get(key) ?? [];
      group.push(action);
      headerActionGroups.set(key, group);
    }
    const duplicateHeaderActions = [...headerActionGroups.values()].filter((group) => group.length > 1);
    const callActionDestinationMismatches = [...document.querySelectorAll("a[href]")]
      .filter((element) => colorTools.visible(element))
      .flatMap((element) => {
        const label = colorTools.textFor(element).replace(/[\s↗↘→←↓↑+*·•]+$/g, "").trim();
        const href = element.getAttribute("href") ?? "";
        if (!/^call(?:\s|$)/i.test(label) || /^call\s+or\b/i.test(label) || /^tel:/i.test(href)) return [];
        return [{ element, label, href }];
      });
    const callActionLabelSpacing = [...document.querySelectorAll("a[href^='tel:' i],button")]
      .filter((element) => colorTools.visible(element))
      .flatMap((element) => {
        const label = colorTools.textFor(element).trim();
        if (/^call(?=[(\d+])/i.test(label)) return [{ element, label }];
        const visibleChildren = [...element.children].filter((child) => colorTools.visible(child));
        const actionChild = visibleChildren.find((child) => /^call$/i.test(colorTools.textFor(child).trim()));
        const numberChild = visibleChildren.find((child) => /^\+?\(?\d/.test(colorTools.textFor(child).trim()));
        if (!actionChild || !numberChild) return [];
        const actionRect = actionChild.getBoundingClientRect();
        const numberRect = numberChild.getBoundingClientRect();
        const verticalOverlap = Math.min(actionRect.bottom, numberRect.bottom) - Math.max(actionRect.top, numberRect.top);
        const sameLine = verticalOverlap >= Math.min(actionRect.height, numberRect.height) * 0.5;
        const pixelGap = numberRect.left - actionRect.right;
        return sameLine && pixelGap < 3 ? [{ element, label, pixelGap }] : [];
      });
    const falseAffordances = elements.flatMap((element) => {
      if (!colorTools.visible(element) || element.closest("a[href],button,[role=button],summary,input,select,textarea")) return [];
      const token = colorTools.textFor(element).replace(/\s+/g, "");
      if (!/^(?:\+|−|›|»|→|↗|↘|⌄|⌃)$/.test(token)) return [];
      const owner = element.parentElement?.closest("article,li,[class*='card'],[class*='row'],[class*='item'],[class*='tile']");
      if (!owner || owner.querySelector("a[href],button,[role=button],summary,input,select,textarea")) return [];
      if (colorTools.textFor(owner).length < 8 || !owner.parentElement) return [];
      const ownerRect = owner.getBoundingClientRect();
      const tokenRect = element.getBoundingClientRect();
      if (tokenRect.left + tokenRect.width / 2 < ownerRect.left + ownerRect.width * 0.58) return [];
      const primaryClass = owner.classList.item(0);
      const peers = [...owner.parentElement.children].filter((candidate) =>
        candidate.tagName === owner.tagName
        && (!primaryClass || candidate.classList.contains(primaryClass))
        && colorTools.visible(candidate));
      if (peers.length < 3) return [];
      return [{ element, owner, token, peerCount: peers.length }];
    });
    const misalignedMobileNavigationToggles = innerWidth <= 640
      ? [...document.querySelectorAll("header [data-lodesta-menu-toggle],header button[aria-controls]")]
        .filter((control) => colorTools.visible(control))
        .filter((control) => {
          const rect = control.getBoundingClientRect();
          return innerWidth - rect.right > Math.max(32, innerWidth * 0.12);
        })
      : [];
    const duplicateManagedNavigationIcons = innerWidth <= 640
      ? [...document.querySelectorAll("[data-lodesta-menu-toggle]")]
        .filter((control) => colorTools.visible(control) && control.querySelector("[data-lodesta-navigation-icon]"))
        .filter((control) => ["::before", "::after"].some((pseudo) => {
          const style = getComputedStyle(control, pseudo);
          if (["none", "normal"].includes(style.content) || style.display === "none") return false;
          const width = Number.parseFloat(style.width) || 0;
          const height = Number.parseFloat(style.height) || 0;
          const border = Math.max(
            Number.parseFloat(style.borderTopWidth) || 0,
            Number.parseFloat(style.borderRightWidth) || 0,
            Number.parseFloat(style.borderBottomWidth) || 0,
            Number.parseFloat(style.borderLeftWidth) || 0
          );
          const background = colorTools.parse(style.backgroundColor);
          return (width >= 2 && height >= 2)
            && (border > 0 || style.backgroundImage !== "none" || (background.valid && background.channels[3] > 0.04));
        }))
      : [];
    const navigationRegions = [...document.querySelectorAll("nav,[role=navigation]")];
    const primaryNavigations = navigationRegions.filter((navigation, index) => {
      if (!colorTools.visible(navigation) || navigation.closest("footer")) return false;
      const label = navigation.getAttribute("aria-label") ?? "";
      return Boolean(navigation.closest("header")) || /\b(?:main|primary|site)\b/i.test(label) || index === 0;
    });
    const desktopDualNavigationControls = innerWidth >= 900
      && primaryNavigations.some((navigation) =>
        [...navigation.querySelectorAll("a[href],button,[role=button]")].filter((control) => colorTools.visible(control)).length >= 2)
      ? [...visibleExplicitNavToggleControls, ...visibleDisclosureNavToggleControls]
        .filter((control) => Boolean(control.closest("header")))
      : [];
    const mobileNavigationOverflow = primaryNavigations.filter((navigation) => {
      const controls = [...navigation.querySelectorAll("a[href],button,[role=button]")].filter((control) => colorTools.visible(control));
      if (controls.length < 2) return false;
      const style = getComputedStyle(navigation);
      const bounds = navigation.getBoundingClientRect();
      const visibleLeft = Math.max(0, bounds.left);
      const visibleRight = Math.min(window.innerWidth, bounds.right);
      const scrollsOrClips = ["auto", "scroll", "hidden", "clip"].includes(style.overflowX)
        && navigation.scrollWidth > navigation.clientWidth + 2;
      const controlOutsideViewport = controls.some((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left < visibleLeft - 2 || rect.right > visibleRight + 2;
      });
      return scrollsOrClips || controlOutsideViewport;
    });
    const escapedEntityExamples = [...new Set((document.body.innerText.match(/&(?:#\d+|#x[a-f0-9]+|[a-z][a-z0-9]+);/gi) ?? []).map((value) => value.slice(0, 40)))].slice(0, 3);
    const escapedSequenceExamples = [...new Set((document.body.innerText.match(/\\[nrt]/g) ?? []).map((value) => value.slice(0, 10)))].slice(0, 3);
    const inlineLinkClusters = [];
    const plainTextLink = (link) => {
      const style = getComputedStyle(link);
      const background = colorTools.parse(style.backgroundColor);
      const alpha = background.valid ? background.channels[3] : 0;
      const framingBorderWidth = Math.max(
        Number.parseFloat(style.borderTopWidth) || 0,
        Number.parseFloat(style.borderRightWidth) || 0,
        Number.parseFloat(style.borderLeftWidth) || 0
      );
      const horizontalPadding = Math.max(
        Number.parseFloat(style.paddingLeft) || 0,
        Number.parseFloat(style.paddingRight) || 0
      );
      // A bottom border is commonly a text-link underline, not a control frame.
      // Ignoring it keeps visibly joined underlined CTAs in the spacing check while
      // the other three borders still exclude outline buttons.
      return alpha < 0.04 && style.backgroundImage === "none" && framingBorderWidth < 1 && horizontalPadding < 4;
    };
    for (const parent of elements) {
      const directLinks = [...parent.children].filter((child) => child.matches("a[href]") && colorTools.visible(child));
      if (directLinks.length < 2) continue;
      for (let index = 0; index < directLinks.length - 1; index += 1) {
        const first = directLinks[index];
        const second = directLinks[index + 1];
        if (!colorTools.textFor(first) || !colorTools.textFor(second) || !plainTextLink(first) || !plainTextLink(second)) continue;
        const nodes = [...parent.childNodes];
        const firstNode = nodes.indexOf(first);
        const secondNode = nodes.indexOf(second);
        if (firstNode < 0 || secondNode <= firstNode) continue;
        const visibleSeparator = nodes.slice(firstNode + 1, secondNode).some((node) => (node.textContent ?? "").trim().length > 0);
        if (visibleSeparator) continue;
        const firstRect = first.getBoundingClientRect();
        const secondRect = second.getBoundingClientRect();
        const verticalOverlap = Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top);
        const gap = secondRect.left - firstRect.right;
        if (verticalOverlap < Math.min(firstRect.height, secondRect.height) * 0.5 || gap < -1 || gap >= 4) continue;
        inlineLinkClusters.push(
          "within " + colorTools.selectorFor(parent) + ": "
          + colorTools.selectorFor(first) + " \"" + colorTools.textFor(first).slice(0, 50) + "\" touches "
          + colorTools.selectorFor(second) + " \"" + colorTools.textFor(second).slice(0, 50) + "\" (" + Math.round(gap * 10) / 10 + "px gap)"
        );
      }
    }
    for (const parent of elements.filter((element) => element.closest("footer"))) {
      const directItems = [...parent.children].filter((child) =>
        child.matches("a[href],span,small,strong,p")
        && colorTools.visible(child)
        && colorTools.textFor(child));
      if (directItems.length < 2) continue;
      for (let index = 0; index < directItems.length - 1; index += 1) {
        const first = directItems[index];
        const second = directItems[index + 1];
        const firstIsLink = first.matches("a[href]");
        const secondIsLink = second.matches("a[href]");
        if (firstIsLink === secondIsLink) continue;
        const link = firstIsLink ? first : second;
        if (!plainTextLink(link)) continue;
        const firstRect = first.getBoundingClientRect();
        const secondRect = second.getBoundingClientRect();
        const verticalOverlap = Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top);
        const gap = secondRect.left - firstRect.right;
        if (verticalOverlap < Math.min(firstRect.height, secondRect.height) * 0.5 || gap < -1 || gap >= 4) continue;
        inlineLinkClusters.push(
          "within " + colorTools.selectorFor(parent) + ": "
          + colorTools.selectorFor(first) + " \"" + colorTools.textFor(first).slice(0, 50) + "\" touches "
          + colorTools.selectorFor(second) + " \"" + colorTools.textFor(second).slice(0, 50) + "\" (" + Math.round(gap * 10) / 10 + "px gap)"
        );
      }
    }
    const unstructuredFooterGroups = elements.filter((element) => {
      if (!colorTools.visible(element) || !element.closest("footer") || element.matches("footer")) return false;
      const identity = [element.id, element.className].filter((value) => typeof value === "string").join(" ");
      if (!/footer[-_\s]*(?:top|inner|content|groups?|columns?|grid|main)/i.test(identity)) return false;
      const directGroups = [...element.children].filter((child) =>
        colorTools.visible(child)
        && colorTools.textFor(child).length > 0);
      if (directGroups.length < 3) return false;
      if (directGroups.filter((child) => child.querySelector("a[href],button") || child.matches("a[href],button")).length < 2) return false;
      const style = getComputedStyle(element);
      if (style.display === "grid" || style.display === "flex" || style.display === "inline-grid" || style.display === "inline-flex") return false;
      const rect = element.getBoundingClientRect();
      if (rect.width < Math.min(720, innerWidth * 0.75)) return false;
      const groupRects = directGroups.map((group) => group.getBoundingClientRect());
      return Math.max(...groupRects.map((rect) => rect.top)) - Math.min(...groupRects.map((rect) => rect.top)) >= 80;
    });
    const narrowMediaSplits = innerWidth <= 640 ? [...document.querySelectorAll("h1,h2,h3,h4")].flatMap((heading) => {
      if (!colorTools.visible(heading) || heading.closest("header,footer,nav")) return [];
      const text = colorTools.textFor(heading);
      const rect = heading.getBoundingClientRect();
      const style = getComputedStyle(heading);
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.15;
      const lines = Math.max(1, Math.round(rect.height / lineHeight));
      if (text.length < 20 || rect.width >= innerWidth * 0.58 || lines < 4 || text.length / lines >= 14) return [];
      let container = heading.parentElement;
      for (let depth = 0; container && depth < 5; depth += 1, container = container.parentElement) {
        const media = [...container.querySelectorAll("img,picture,video")].find((candidate) => {
          if (!colorTools.visible(candidate)) return false;
          const mediaRect = candidate.getBoundingClientRect();
          const verticalOverlap = Math.min(rect.bottom, mediaRect.bottom) - Math.max(rect.top, mediaRect.top);
          const sideBySide = mediaRect.right <= rect.left + 4 || rect.right <= mediaRect.left + 4;
          return mediaRect.width >= 48 && verticalOverlap >= Math.min(rect.height, mediaRect.height) * 0.35 && sideBySide;
        });
        if (media) {
          return [colorTools.selectorFor(heading) + " \"" + text.slice(0, 80) + "\" uses "
            + Math.round(rect.width) + "px across " + lines + " lines beside media"];
        }
        const textPeer = [...container.children].find((candidate) => {
          if (candidate.contains(heading) || !colorTools.visible(candidate)) return false;
          const peerText = colorTools.textFor(candidate);
          if (peerText.length < 50) return false;
          const peerRect = candidate.getBoundingClientRect();
          const verticalOverlap = Math.min(rect.bottom, peerRect.bottom) - Math.max(rect.top, peerRect.top);
          const sideBySide = peerRect.right <= rect.left + 4 || rect.right <= peerRect.left + 4;
          return peerRect.width >= 48
            && peerRect.width < innerWidth * 0.58
            && verticalOverlap >= Math.min(rect.height, peerRect.height) * 0.25
            && sideBySide;
        });
        if (textPeer) {
          const peerRect = textPeer.getBoundingClientRect();
          return [colorTools.selectorFor(heading) + " \"" + text.slice(0, 80) + "\" uses "
            + Math.round(rect.width) + "px across " + lines + " lines beside a "
            + Math.round(peerRect.width) + "px text column"];
        }
      }
      return [];
    }) : [];
    const longMobileCardWalls = innerWidth <= 640 ? elements.flatMap((container) => {
      if (!colorTools.visible(container) || !container.closest("main") || container.closest("header,footer,nav")) return [];
      const children = [...container.children].filter((child) => colorTools.visible(child));
      if (children.length < 6) return [];
      const cardLike = children.filter((child) => {
        const rect = child.getBoundingClientRect();
        const paragraph = child.querySelector("p");
        const heading = child.querySelector("h2,h3,h4,strong");
        return rect.width >= innerWidth * 0.72
          && rect.height >= 120
          && Boolean(heading && paragraph)
          && colorTools.textFor(paragraph).length >= 45;
      });
      if (cardLike.length < 6 || cardLike.length < Math.ceil(children.length * 0.75)) return [];
      const rects = cardLike.map((child) => child.getBoundingClientRect());
      const verticalExtent = Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top));
      const distinctRows = new Set(rects.map((rect) => Math.round(rect.top / 8))).size;
      if (distinctRows < 6 || verticalExtent < innerHeight * 1.4) return [];
      return [colorTools.selectorFor(container) + " contains " + cardLike.length
        + " full-width descriptive cards across " + Math.round(verticalExtent) + "px"];
    }) : [];
    const fragmentedHeadings = innerWidth <= 640 ? [...document.querySelectorAll("h1,h2,h3,h4")].flatMap((heading) => {
      if (!colorTools.visible(heading) || heading.closest("header,footer,nav")) return [];
      const text = colorTools.textFor(heading);
      const rect = heading.getBoundingClientRect();
      const style = getComputedStyle(heading);
      if (!style.writingMode.startsWith("horizontal")) return [];
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.15;
      const lines = Math.max(1, Math.round(rect.height / lineHeight));
      if (
        text.length < 20
        || lines < 5
        || rect.width > Math.min(180, innerWidth * 0.5)
        || text.length / lines >= 8
      ) return [];
      return [colorTools.selectorFor(heading) + " \"" + text.slice(0, 80) + "\" uses "
        + Math.round(rect.width) + "px across " + lines + " lines"];
    }) : [];
    const mediaContainerOverflows = [...document.querySelectorAll("img,video")].flatMap((media) => {
      if (!colorTools.visible(media)) return [];
      const mediaStyle = getComputedStyle(media);
      if (["absolute", "fixed"].includes(mediaStyle.position)) return [];
      const container = media.parentElement;
      const composition = container?.parentElement;
      if (!container || !composition || !colorTools.visible(container)) return [];
      const containerStyle = getComputedStyle(container);
      if (["hidden", "clip", "auto", "scroll"].includes(containerStyle.overflowX)
        || ["hidden", "clip", "auto", "scroll"].includes(containerStyle.overflowY)) return [];
      const mediaRect = media.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const overflow = {
        top: Math.max(0, containerRect.top - mediaRect.top),
        right: Math.max(0, mediaRect.right - containerRect.right),
        bottom: Math.max(0, mediaRect.bottom - containerRect.bottom),
        left: Math.max(0, containerRect.left - mediaRect.left)
      };
      const verticalOverflow = Math.max(overflow.top, overflow.bottom);
      const horizontalOverflow = Math.max(overflow.left, overflow.right);
      if (verticalOverflow < Math.max(24, containerRect.height * .08)
        && horizontalOverflow < Math.max(24, containerRect.width * .08)) return [];
      const sibling = [...composition.children].find((candidate) => {
        if (candidate === container || !colorTools.visible(candidate)) return false;
        const hasContent = Boolean(colorTools.textFor(candidate))
          || Boolean(candidate.querySelector("h1,h2,h3,h4,p,a[href],button,input,textarea,select"));
        if (!hasContent) return false;
        const collision = intersect(rectValue(mediaRect), rectValue(candidate.getBoundingClientRect()));
        return collision.width >= 12 && collision.height >= 12 && rectArea(collision) >= 400;
      });
      if (!sibling) return [];
      return [colorTools.selectorFor(media)
        + " (" + Math.round(mediaRect.width) + "×" + Math.round(mediaRect.height) + "px) escapes "
        + colorTools.selectorFor(container)
        + " (" + Math.round(containerRect.width) + "×" + Math.round(containerRect.height) + "px) and overlaps "
        + colorTools.selectorFor(sibling)];
    });
    const syntheticIdentityDevices = elements.filter((element) => {
      if (!colorTools.visible(element) || element.matches("img,svg,picture")) return false;
      const identityHint = [element.id, element.className].filter((value) => typeof value === "string").join(" ");
      const explicitIdentityHint = /(?:^|[-_\s])(stamp|seal|badge|monogram|emblem|lockup|mark|marker|initial|crest)(?:$|[-_\s])/i.test(identityHint);
      const visualPosterHint = /(?:^|[-_\s])(?:art|graphic|visual|poster|shape|orbit)(?:$|[-_\s])/i.test(identityHint);
      if (!explicitIdentityHint && !visualPosterHint) return false;
      const embeddedMedia = [...element.querySelectorAll("img,svg,picture")];
      const embeddedMediaAreRepeatedLogos = embeddedMedia.length > 0 && embeddedMedia.every((media) => {
        if (!(media instanceof HTMLImageElement) || !isCanonicalLogoImage(media)) return false;
        const source = media.currentSrc || media.getAttribute("src") || "";
        if (!source) return false;
        return [...document.images].filter((image) =>
          colorTools.visible(image)
          && (image.currentSrc || image.getAttribute("src") || "") === source).length >= 2;
      });
      if (embeddedMedia.length > 0 && !embeddedMediaAreRepeatedLogos) return false;
      const tokenCandidates = [
        element,
        ...element.querySelectorAll("span,strong,b,small,[class*='word' i],[id*='word' i]")
      ];
      const token = tokenCandidates.find((candidate) => {
        const ownText = [...candidate.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join(" ")
          .trim();
        return /^[A-Z]{1,5}$/.test(ownText);
      });
      const numericToken = tokenCandidates.find((candidate) => {
        const ownText = [...candidate.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join(" ")
          .trim();
        if (!/^\d{1,3}$/.test(ownText)) return false;
        const candidateStyle = getComputedStyle(candidate);
        return (Number.parseFloat(candidateStyle.fontSize) || 0) >= 40;
      });
      const oversizedWordToken = tokenCandidates.find((candidate) => {
        const ownText = [...candidate.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join(" ")
          .trim();
        if (!/^[A-Za-z][A-Za-z0-9&.'’+-]{1,29}$/.test(ownText)) return false;
        return (Number.parseFloat(getComputedStyle(candidate).fontSize) || 0) >= 64;
      });
      const oversizedSymbolToken = tokenCandidates.find((candidate) => {
        const ownText = [...candidate.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join(" ")
          .trim();
        if (!/^[^\p{L}\p{N}\s]{1,4}$/u.test(ownText)) return false;
        return (Number.parseFloat(getComputedStyle(candidate).fontSize) || 0) >= 64;
      });
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const text = colorTools.textFor(element);
      const fontSize = Number.parseFloat(style.fontSize) || 0;
      const hasStyledPseudo = ["::before", "::after"].some((pseudo) => {
        const pseudoStyle = getComputedStyle(element, pseudo);
        return pseudoStyle.content && !["none", "normal"].includes(pseudoStyle.content);
      });
      const compactSlogan = text.length >= 4
        && text.length <= 50
        && text.trim().split(/\s+/).length <= 8
        && (Number.parseFloat(style.fontSize) || 0) >= 24;
      const largeSloganMarker = text.length >= 10
        && text.length <= 100
        && text.trim().split(/\s+/).length <= 14
        && rect.width >= 160
        && rect.height >= 160
        && element.children.length >= 2;
      const borderWidth = Math.max(
        Number.parseFloat(style.borderTopWidth) || 0,
        Number.parseFloat(style.borderRightWidth) || 0,
        Number.parseFloat(style.borderBottomWidth) || 0,
        Number.parseFloat(style.borderLeftWidth) || 0
      );
      const radius = Number.parseFloat(style.borderRadius) || 0;
      const substantialTokenDevice = Boolean(token) && rect.width >= 64 && rect.height >= 64;
      const largeStandaloneToken = Boolean(token) && fontSize >= 48 && rect.width >= 40 && rect.height >= 40;
      const numberedSloganPoster = visualPosterHint
        && Boolean(numericToken)
        && largeSloganMarker
        && rect.width >= 140
        && rect.height >= 140;
      const framedLogoPoster = embeddedMediaAreRepeatedLogos
        && rect.width >= 160
        && rect.height >= 160
        && element.children.length >= 2
        && (Boolean(numericToken) || largeSloganMarker);
      const posterSizedWordmark = visualPosterHint
        && Boolean(oversizedWordToken)
        && rect.width >= 160
        && rect.height >= 160;
      const compactStampedSlogan = explicitIdentityHint
        && text.length >= 4
        && text.length <= 80
        && text.trim().split(/\s+/).length <= 10
        && fontSize >= 12
        && rect.width >= 72
        && rect.height >= 44
        && (borderWidth >= 1 || style.transform !== "none");
      const largeStandaloneSymbol = Boolean(oversizedSymbolToken)
        && rect.width >= 40
        && rect.height >= 40;
      const emptyStyledMarker = !text
        && element.getAttribute("aria-hidden") === "true"
        && rect.width >= 80
        && rect.height >= 80
        && (borderWidth >= 1 || radius >= 12 || style.transform !== "none")
        && (hasStyledPseudo || element.children.length > 0);
      if (!token && !compactSlogan && !largeSloganMarker && !emptyStyledMarker && !numberedSloganPoster && !framedLogoPoster && !posterSizedWordmark && !compactStampedSlogan && !largeStandaloneSymbol) return false;
      if (largeStandaloneToken) return true;
      if (largeStandaloneSymbol) return true;
      if (numberedSloganPoster) return true;
      if (framedLogoPoster) return true;
      if (posterSizedWordmark) return true;
      if (compactStampedSlogan) return true;
      return (borderWidth >= 1 || radius >= 12 || style.transform !== "none")
        && (compactSlogan || largeSloganMarker || substantialTokenDevice || emptyStyledMarker);
    });
    const syntheticIdentityPseudoMarkers = elements.flatMap((element) => {
      if (!colorTools.visible(element) || element.querySelector("img,svg,picture")) return [];
      const identity = [element.id, element.className].filter((value) => typeof value === "string").join(" ");
      if (!/(?:^|[-_\s])(?:brand|identity|logo|wordmark|lockup)(?:$|[-_\s])/i.test(identity)) return [];
      if (!colorTools.textFor(element)) return [];
      return ["::before", "::after"].flatMap((pseudo) => {
        const style = getComputedStyle(element, pseudo);
        if (!style.content || ["none", "normal"].includes(style.content)) return [];
        const width = Number.parseFloat(style.width) || 0;
        const height = Number.parseFloat(style.height) || 0;
        if (width < 4 || height < 4 || width > 48 || height > 48) return [];
        const borderWidth = Math.max(
          Number.parseFloat(style.borderTopWidth) || 0,
          Number.parseFloat(style.borderRightWidth) || 0,
          Number.parseFloat(style.borderBottomWidth) || 0,
          Number.parseFloat(style.borderLeftWidth) || 0
        );
        const background = colorTools.parse(style.backgroundColor);
        if ((!background.valid || background.channels[3] < .2) && borderWidth < 1) return [];
        return [colorTools.selectorFor(element) + pseudo
          + " (" + Math.round(width) + "×" + Math.round(height) + "px CSS marker beside "
          + JSON.stringify(colorTools.textFor(element).slice(0, 80)) + ")"];
      });
    });
    const syntheticIdentityDeviceExamples = [
      ...syntheticIdentityDevices.map((element) =>
        colorTools.selectorFor(element) + " " + JSON.stringify(colorTools.textFor(element).slice(0, 80))),
      ...syntheticIdentityPseudoMarkers
    ];
    const geographyCircleDevices = elements.flatMap((element) => {
      if (!colorTools.visible(element)) return [];
      const text = colorTools.textFor(element);
      const identity = [element.id, element.className].filter((value) => typeof value === "string").join(" ");
      const geographyCue = /\b(?:service areas?|areas? we serve|coverage|radius|for homes in|serving|served across)\b/i.test(text)
        || /\b(?:triangle|region|territory)\b/i.test(text)
        || /(?:^|[-_\s])(?:service[-_\s]?area|coverage|location|geography|region|territory)(?:$|[-_\s])/i.test(identity);
      if (!geographyCue) return [];
      const rect = element.getBoundingClientRect();
      const elementStyle = getComputedStyle(element);
      const elementRadius = elementStyle.borderRadius;
      const elementCircular = elementRadius.includes("%")
        ? (Number.parseFloat(elementRadius) || 0) >= 45
        : (Number.parseFloat(elementRadius) || 0) >= Math.min(rect.width, rect.height) * 0.4;
      const directCircle = rect.width >= 200
        && rect.height >= 200
        && Math.max(rect.width, rect.height) / Math.max(1, Math.min(rect.width, rect.height)) <= 1.2
        && elementCircular
        ? [colorTools.selectorFor(element) + " (" + Math.round(rect.width) + "×" + Math.round(rect.height) + "px) frames " + JSON.stringify(text.slice(0, 80))]
        : [];
      const pseudoCircles = ["::before", "::after"].flatMap((pseudo) => {
        const style = getComputedStyle(element, pseudo);
        if (style.content === "none" || !["absolute", "fixed"].includes(style.position)) return [];
        const width = Number.parseFloat(style.width) || 0;
        const height = Number.parseFloat(style.height) || 0;
        if (width < 240 || height < 240 || Math.max(width, height) / Math.max(1, Math.min(width, height)) > 1.2) return [];
        const radiusValue = style.borderRadius;
        const circular = radiusValue.includes("%")
          ? (Number.parseFloat(radiusValue) || 0) >= 45
          : (Number.parseFloat(radiusValue) || 0) >= Math.min(width, height) * 0.4;
        const borderWidth = Math.max(
          Number.parseFloat(style.borderTopWidth) || 0,
          Number.parseFloat(style.borderRightWidth) || 0,
          Number.parseFloat(style.borderBottomWidth) || 0,
          Number.parseFloat(style.borderLeftWidth) || 0
        );
        if (!circular || borderWidth < 1) return [];
        return [colorTools.selectorFor(element) + pseudo + " (" + Math.round(width) + "×" + Math.round(height) + "px) frames " + JSON.stringify(text.slice(0, 80))];
      });
      return [...directCircle, ...pseudoCircles];
    });
    const circularOutlineLayerCount = (root) => {
      let count = 0;
      const candidates = [root, ...root.querySelectorAll("*")].slice(0, 80);
      for (const candidate of candidates) {
        if (!colorTools.visible(candidate)) continue;
        for (const pseudo of [null, "::before", "::after"]) {
          const style = getComputedStyle(candidate, pseudo);
          if (pseudo && (!style.content || ["none", "normal"].includes(style.content))) continue;
          const rawRect = candidate.getBoundingClientRect();
          const width = pseudo ? Number.parseFloat(style.width) : rawRect.width;
          const height = pseudo ? Number.parseFloat(style.height) : rawRect.height;
          if (!Number.isFinite(width) || !Number.isFinite(height) || width < 40 || height < 40) continue;
          const borderWidth = Math.max(
            Number.parseFloat(style.borderTopWidth) || 0,
            Number.parseFloat(style.borderRightWidth) || 0,
            Number.parseFloat(style.borderBottomWidth) || 0,
            Number.parseFloat(style.borderLeftWidth) || 0
          );
          const radius = Number.parseFloat(style.borderRadius) || 0;
          const circular = /(?:50|100)%/.test(style.borderRadius) || radius >= Math.min(width, height) * .33;
          if (borderWidth >= .5 && circular) {
            count += 1;
            if (style.boxShadow && style.boxShadow !== "none") {
              count += style.boxShadow.match(/(?:rgb|rgba|hsl|hsla)\(/gi)?.length ?? 1;
            }
          }
        }
      }
      return count;
    };
    const headerControlLineTops = new Map();
    for (const box of textBoxes) {
      const control = box.element.closest("header a[href],header button,header [role=button]");
      if (!control || !colorTools.visible(control)) continue;
      const lineTops = headerControlLineTops.get(control) ?? [];
      if (!lineTops.some((top) => Math.abs(top - box.visibleRect.top) <= 2)) lineTops.push(box.visibleRect.top);
      headerControlLineTops.set(control, lineTops);
    }
    const wrappedHeaderControls = innerWidth > 640
      ? controls.filter((control) => {
          if (!colorTools.visible(control) || !control.closest("header")) return false;
          return (headerControlLineTops.get(control)?.length ?? 0) > 1;
        })
      : [];
    // One deliberately stacked CTA can be a valid treatment. Multiple wrapped
    // controls are a stronger signal that the inline header outlived its useful
    // breakpoint and should have yielded to the compact navigation state.
    const crowdedHeaderControls = wrappedHeaderControls.length >= 2 ? wrappedHeaderControls : [];
    const ownPseudoCircularOutlineLayerCount = (root) => {
      let count = 0;
      for (const pseudo of ["::before", "::after"]) {
        const style = getComputedStyle(root, pseudo);
        if (!style.content || ["none", "normal"].includes(style.content)) continue;
        const width = Number.parseFloat(style.width);
        const height = Number.parseFloat(style.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 160 || height < 160) continue;
        const borderWidth = Math.max(
          Number.parseFloat(style.borderTopWidth) || 0,
          Number.parseFloat(style.borderRightWidth) || 0,
          Number.parseFloat(style.borderBottomWidth) || 0,
          Number.parseFloat(style.borderLeftWidth) || 0
        );
        const radius = Number.parseFloat(style.borderRadius) || 0;
        const circular = /(?:50|100)%/.test(style.borderRadius) || radius >= Math.min(width, height) * .33;
        if (borderWidth >= .5 && circular) {
          count += 1;
          if (style.boxShadow && style.boxShadow !== "none") {
            count += style.boxShadow.match(/(?:rgb|rgba|hsl|hsla)\(/gi)?.length ?? 1;
          }
        }
      }
      return count;
    };
    const decorativeDiagramCandidates = elements.flatMap((element) => {
      if (!colorTools.visible(element) || element.matches("img,picture,svg,canvas")) return [];
      if (element.closest("header,nav,footer,form,a[href],button,[role=button],summary")) return [];
      if (element.querySelector("img,picture,svg,canvas,table,dl,[data-lodesta-map]")) return [];
      if (element.hasAttribute("role") && element.getAttribute("aria-label")?.trim()) return [];
      const identity = [element.id, element.className].filter((value) => typeof value === "string").join(" ");
      const explicitDiagramHint = /(?:^|[-_\s])(?:orbit|radar|constellation|network|diagram|drawing)(?:$|[-_\s])/i.test(identity);
      const artContainerHint = /(?:^|[-_\s])(?:art|graphic|visual|mark)(?:$|[-_\s])/i.test(identity);
      const unlabeledPseudoDiagram = ownPseudoCircularOutlineLayerCount(element) >= 2;
      if (!explicitDiagramHint && !artContainerHint && !unlabeledPseudoDiagram) return [];
      const rect = element.getBoundingClientRect();
      if (rect.width < 160 || rect.height < 160) return [];
      const layerCount = circularOutlineLayerCount(element);
      const positionedLayerCount = [...element.querySelectorAll("*")].filter((candidate) => {
        if (!colorTools.visible(candidate)) return false;
        const style = getComputedStyle(candidate);
        if (!["absolute", "fixed"].includes(style.position)) return false;
        const candidateRect = candidate.getBoundingClientRect();
        return candidateRect.width >= 4 && candidateRect.height >= 4;
      }).length;
      const positionedDrawing = explicitDiagramHint
        && element.getAttribute("aria-hidden") === "true"
        && positionedLayerCount >= 3;
      if (layerCount < (explicitDiagramHint ? 1 : unlabeledPseudoDiagram ? 2 : artContainerHint ? 2 : 3) && !positionedDrawing) return [];
      return [{
        element,
        layerCount: Math.max(layerCount, positionedLayerCount),
        layerLabel: layerCount > 0
          ? layerCount + " outlined circular layers"
          : positionedLayerCount + " positioned CSS layers",
        text: colorTools.textFor(element).slice(0, 60)
      }];
    });
    const decorativeDiagrams = decorativeDiagramCandidates.filter((candidate) =>
      !decorativeDiagramCandidates.some((ancestor) =>
        ancestor !== candidate
        && ancestor.element.contains(candidate.element)
        && ancestor.layerCount >= candidate.layerCount));
    const headerBrandCollisions = [...document.querySelectorAll("header img,header picture,header svg")].flatMap((media) => {
      if (!colorTools.visible(media)) return [];
      const header = media.closest("header");
      const previous = header?.previousElementSibling;
      if (!header || !previous || !colorTools.visible(previous)) return [];
      const mediaRect = rectValue(media.getBoundingClientRect());
      const headerRect = rectValue(header.getBoundingClientRect());
      if (mediaRect.top >= headerRect.top - 1) return [];
      const covered = visibleText.find((element) => {
        if (!previous.contains(element)) return false;
        const collision = intersect(mediaRect, rectValue(element.getBoundingClientRect()));
        return collision.width >= 8 && collision.height >= 8 && rectArea(collision) >= 100;
      });
      return covered ? [
        colorTools.selectorFor(media) + " overlaps " + colorTools.selectorFor(covered)
        + " " + JSON.stringify(colorTools.textFor(covered).slice(0, 80))
      ] : [];
    });
    const repeatedSourceImages = [];
    const imageGroups = new Map();
    for (const image of [...document.querySelectorAll("main img")]) {
      if (!colorTools.visible(image)) continue;
      if (isCanonicalLogoImage(image)) continue;
      const source = image.currentSrc || image.src;
      if (!source) continue;
      const section = image.closest("section,article") ?? image.parentElement;
      if (!section) continue;
      const group = imageGroups.get(source) ?? { source, images: [], sections: new Set() };
      group.images.push(image);
      group.sections.add(section);
      imageGroups.set(source, group);
    }
    for (const group of imageGroups.values()) {
      if (group.images.length < 2 || group.sections.size < 2) continue;
      const sourceLabel = (() => {
        try {
          const url = new URL(group.source);
          return url.pathname.split("/").filter(Boolean).at(-1) ?? "image";
        } catch {
          return "inline image";
        }
      })();
      repeatedSourceImages.push(
        sourceLabel + " appears " + group.images.length + " times across " + group.sections.size
        + " sections (" + group.images.slice(0, 2).map((image) => colorTools.selectorFor(image)).join(", ") + ")"
      );
    }
    const ariaReferenceAttributes = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-details", "aria-activedescendant"];
    const missingAriaReferences = elements.flatMap((element) => ariaReferenceAttributes.flatMap((attribute) => {
      const value = element.getAttribute(attribute)?.trim();
      if (!value) return [];
      return value.split(/\s+/).filter((id) => !document.getElementById(id)).map((id) =>
        colorTools.selectorFor(element) + " [" + attribute + "=\"" + id + "\"]");
    }));
    const missingFragmentTargets = [...document.querySelectorAll("a[href^='#']")].filter((anchor) => {
      const href = anchor.getAttribute("href")?.trim() ?? "";
      const rawFragment = href.slice(1);
      if (!rawFragment) return true;
      let fragment = rawFragment;
      try { fragment = decodeURIComponent(rawFragment); } catch {}
      return !document.getElementById(fragment);
    });
    return {
      horizontalOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
      headingOverflowCount: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
        .filter((heading) => !intentionallyVisuallyHidden(heading) && heading.scrollWidth - heading.clientWidth > 2).length,
      brokenImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
      h1Count: document.querySelectorAll("h1").length,
      missingAriaReferenceCount: missingAriaReferences.length,
      missingAriaReferenceExamples: missingAriaReferences.slice(0, 3),
      missingFragmentTargetCount: missingFragmentTargets.length,
      missingFragmentTargetExamples: missingFragmentTargets.slice(0, 5).map((anchor) =>
        colorTools.selectorFor(anchor) + ' [href="' + (anchor.getAttribute("href") ?? "") + '"]'),
      minBodyFontPx: fontSizes.length ? Math.min(...fontSizes) : 16,
      smallBodyTextCount: smallBodyText.length,
      smallBodyTextExamples: smallBodyText.slice(0, 3).map(textExample),
      smallBodyTextFamilies,
      smallDisclosureTextCount: smallDisclosureText.length,
      smallDisclosureTextExamples: smallDisclosureText.slice(0, 3).map(disclosureTextExample),
      smallFormTextCount: smallFormText.length,
      smallFormTextExamples: smallFormText.slice(0, 5).map(textExample),
      oversizedSingleLineFieldCount: oversizedSingleLineFields.length,
      oversizedSingleLineFieldExamples: oversizedSingleLineFields.slice(0, 5).map((element) =>
        colorTools.selectorFor(element) + " (" + Math.round(element.getBoundingClientRect().height) + "px tall)"),
      tinyVisibleTextCount: tinyVisibleText.length,
      tinyTextExamples: tinyVisibleText.slice(0, 3).map(textExample),
      tinyTextFamilies,
      lowContrastCount: lowContrast.length,
      lowContrastExamples: lowContrast.slice(0, 3).map(({ element, ratio, foreground, background }) => ({
        selector: colorTools.selectorFor(element),
        text: colorTools.textFor(element).slice(0, 80),
        foreground,
        background,
        ratio: Math.round(ratio * 100) / 100,
        requiredRatio: lowContrast.find((item) => item.element === element)?.requiredRatio ?? 4.5
      })),
      textSurfaceBoundaryCount: [...new Set(textSurfaceBoundaries)].length,
      textSurfaceBoundaryExamples: [...new Set(textSurfaceBoundaries)].slice(0, 3),
      clippedManagedContentCount: clippedManagedContent.length,
      clippedManagedContentExamples: clippedManagedContent.slice(0, 3).map((element) =>
        colorTools.selectorFor(element) + " (client " + element.clientWidth + "×" + element.clientHeight + ", scroll " + element.scrollWidth + "×" + element.scrollHeight + ")"),
      constrainedManagedMapCount: constrainedManagedMaps.length,
      constrainedManagedMapExamples: constrainedManagedMaps.slice(0, 3).map(({ element, surfaceWidth, totalWidth }) =>
        colorTools.selectorFor(element) + " (location details " + Math.round(surfaceWidth) + "px wide within " + Math.round(totalWidth) + "px total)"),
      emptyControlCount: emptyControls.length,
      emptyControlExamples: emptyControls.slice(0, 3).map((element) => colorTools.selectorFor(element)),
      browserDefaultDocumentCount: browserDefaultDocument ? 1 : 0,
      browserDefaultDocumentExamples: browserDefaultDocument
        ? [
            "body font is " + bodyStyle.fontFamily
            + ", " + defaultBlueLinks.length + " visible default-blue underlined link(s), and "
            + browserDefaultActionAnchors.length + " unstyled CTA-like anchor(s)"
          ]
        : [],
      browserDefaultControlCount: browserDefaultControls.length,
      browserDefaultControlExamples: browserDefaultControls.slice(0, 3).map((element) => {
        const label = colorTools.textFor(element)
          || element.getAttribute("aria-label")
          || element.getAttribute("type")
          || "unlabeled";
        return colorTools.selectorFor(element) + ' "' + label.slice(0, 60) + '"';
      }),
      longLineCount: longLines.length,
      longLineExamples: longLines.slice(0, 3).map((item) => colorTools.selectorFor(item.element) + " (" + item.characters + " chars/line)"),
      smallTargetCount: smallTargets.length,
      smallTargetExamples: smallTargets.slice(0, 5).map((element) => {
        const rect = element.getBoundingClientRect();
        const text = colorTools.textFor(element)
          || element.getAttribute("aria-label")
          || element.getAttribute("name")
          || element.getAttribute("type")
          || "unlabeled";
        return colorTools.selectorFor(element)
          + " \"" + text.slice(0, 60) + "\" ("
          + Math.round(rect.width * 10) / 10 + "×"
          + Math.round(rect.height * 10) / 10 + "px)";
      }),
      duplicateFieldLabelCount: duplicateFieldLabels.length,
      duplicateFieldLabelExamples: duplicateFieldLabels.slice(0, 3).map(({ field, labels }) =>
        colorTools.selectorFor(field) + " has " + labels.length + " visible labels"),
      adjacentDuplicateTextCount: adjacentDuplicateText.length,
      adjacentDuplicateTextExamples: adjacentDuplicateText.slice(0, 3).map((element) =>
        colorTools.selectorFor(element) + ' "' + (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120) + '"'),
      adjacentDuplicateContentBlockCount: adjacentDuplicateContentBlocks.length,
      adjacentDuplicateContentBlockExamples: adjacentDuplicateContentBlocks.slice(0, 3).map(({ element, sibling, text }) =>
        colorTools.selectorFor(element) + " + " + colorTools.selectorFor(sibling) + ' "' + text.slice(0, 140) + '"'),
      internalProvenanceCopyCount: internalProvenanceCopy.length,
      internalProvenanceCopyExamples: internalProvenanceCopy.slice(0, 3).map((element) =>
        colorTools.selectorFor(element) + ' "' + (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 140) + '"'),
      vagueProcessCopyCount: vagueProcessCopy.length,
      vagueProcessCopyExamples: vagueProcessCopy.slice(0, 3).map((element) =>
        colorTools.selectorFor(element) + ' "' + (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 140) + '"'),
      hitTestFailureCount: hitTestFailures.length,
      hitTestFailureExamples: hitTestFailures.slice(0, 3).map(elementGeometryExample),
      clippedElementCount: clippedElements.length,
      clippedElementExamples: clippedElements.slice(0, 3).map(elementGeometryExample),
      textClippingCount: [...new Set(textClipping)].length,
      textClippingExamples: [...new Set(textClipping)].slice(0, 3),
      textOcclusionCount: [...new Set(textOcclusion)].length,
      textOcclusionExamples: [...new Set(textOcclusion)].slice(0, 3),
      headerControlCollisionCount: [...new Set([...headerControlCollisions, ...headerControlHitTestFailures])].length,
      headerControlCollisionExamples: [...new Set([...headerControlCollisions, ...headerControlHitTestFailures])].slice(0, 3),
      headerControlWrapCount: crowdedHeaderControls.length,
      headerControlWrapExamples: crowdedHeaderControls.slice(0, 3).map((element) =>
        colorTools.selectorFor(element) + ' "' + colorTools.textFor(element).slice(0, 60) + '"'),
      inlineLinkClusterCount: [...new Set(inlineLinkClusters)].length,
      inlineLinkClusterExamples: [...new Set(inlineLinkClusters)].slice(0, 3),
      unstructuredFooterGroupCount: unstructuredFooterGroups.length,
      unstructuredFooterGroupExamples: unstructuredFooterGroups.slice(0, 3).map((element) => {
        const rect = element.getBoundingClientRect();
        return colorTools.selectorFor(element)
          + " (display:" + getComputedStyle(element).display
          + "; " + element.children.length + " direct groups; " + Math.round(rect.width) + "×" + Math.round(rect.height) + "px)";
      }),
      narrowMediaSplitCount: [...new Set(narrowMediaSplits)].length,
      narrowMediaSplitExamples: [...new Set(narrowMediaSplits)].slice(0, 3),
      longMobileCardWallCount: [...new Set(longMobileCardWalls)].length,
      longMobileCardWallExamples: [...new Set(longMobileCardWalls)].slice(0, 3),
      fragmentedHeadingCount: [...new Set(fragmentedHeadings)].length,
      fragmentedHeadingExamples: [...new Set(fragmentedHeadings)].slice(0, 3),
      mediaContainerOverflowCount: [...new Set(mediaContainerOverflows)].length,
      mediaContainerOverflowExamples: [...new Set(mediaContainerOverflows)].slice(0, 3),
      headerBrandCollisionCount: [...new Set(headerBrandCollisions)].length,
      headerBrandCollisionExamples: [...new Set(headerBrandCollisions)].slice(0, 3),
      headerContentOcclusionCount: [...new Set(headerContentOcclusions)].length,
      headerContentOcclusionExamples: [...new Set(headerContentOcclusions)].slice(0, 3),
      croppedTransparentGraphicCount: [...new Set(croppedTransparentGraphics)].length,
      croppedTransparentGraphicExamples: [...new Set(croppedTransparentGraphics)].slice(0, 3),
      syntheticIdentityDeviceCount: syntheticIdentityDeviceExamples.length,
      syntheticIdentityDeviceExamples: syntheticIdentityDeviceExamples.slice(0, 12),
      geographyCircleDeviceCount: geographyCircleDevices.length,
      geographyCircleDeviceExamples: geographyCircleDevices.slice(0, 3),
      decorativeDiagramCount: decorativeDiagrams.length,
      decorativeDiagramExamples: decorativeDiagrams.slice(0, 4).map((item) =>
        colorTools.selectorFor(item.element) + " (" + item.layerLabel + "; text " + JSON.stringify(item.text) + ")"),
      duplicateHeaderActionCount: duplicateHeaderActions.reduce((count, group) => count + group.length - 1, 0),
      duplicateHeaderActionExamples: duplicateHeaderActions.slice(0, 3).map((group) =>
        group.map((element) => colorTools.selectorFor(element)).join(" + ")
        + " " + JSON.stringify(colorTools.textFor(group[0]).slice(0, 80))
        + " -> " + JSON.stringify(group[0].getAttribute("href"))),
      callActionDestinationMismatchCount: callActionDestinationMismatches.length,
      callActionDestinationMismatchExamples: callActionDestinationMismatches.slice(0, 3).map((item) =>
        colorTools.selectorFor(item.element)
        + " " + JSON.stringify(item.label.slice(0, 80))
        + " -> " + JSON.stringify(item.href)),
      callActionLabelSpacingCount: callActionLabelSpacing.length,
      callActionLabelSpacingExamples: callActionLabelSpacing.slice(0, 3).map((item) =>
        colorTools.selectorFor(item.element) + " " + JSON.stringify(item.label.slice(0, 80))
        + (Number.isFinite(item.pixelGap) ? " (rendered gap " + Math.round(item.pixelGap * 10) / 10 + "px)" : "")),
      falseAffordanceCount: falseAffordances.length,
      falseAffordanceExamples: falseAffordances.slice(0, 3).map((item) =>
        colorTools.selectorFor(item.owner) + " ends with " + JSON.stringify(item.token)
        + " across " + item.peerCount + " repeated peers but contains no interactive control"),
      repeatedSourceImageCount: repeatedSourceImages.length,
      repeatedSourceImageExamples: repeatedSourceImages.slice(0, 3),
      primaryHeadingAboveFold: Boolean(primaryHeadingRect && primaryHeadingRect.top < innerHeight),
      primaryActionAboveFold: Boolean(primaryAction && primaryAction.rect.top < innerHeight),
      primaryHeadingBeforeAction: Boolean(primaryHeadingRect && primaryAction && primaryHeadingRect.top <= primaryAction.rect.top),
      imageAltQualityCount: imageAltQuality.length,
      imageAltQualityExamples: imageAltQuality.slice(0, 3).map((image) =>
        colorTools.selectorFor(image) + " alt=" + JSON.stringify((image.getAttribute("alt") ?? "").slice(0, 100))),
      filteredRasterLogoCount: filteredRasterLogos.length,
      filteredRasterLogoExamples: filteredRasterLogos.slice(0, 3).map((item) =>
        colorTools.selectorFor(item.image)
        + " filtered by " + colorTools.selectorFor(item.filteredElement)
        + " filter=" + JSON.stringify(item.filter)),
      oversizedFooterRasterLogoCount: oversizedFooterRasterLogos.length,
      oversizedFooterRasterLogoExamples: oversizedFooterRasterLogos.slice(0, 3).map((item) =>
        colorTools.selectorFor(item.image)
        + " (" + Math.round(item.width) + "×" + Math.round(item.height) + "px)"),
      undersizedPrimaryRasterLogoCount: undersizedPrimaryRasterLogos.length,
      undersizedPrimaryRasterLogoExamples: undersizedPrimaryRasterLogos.slice(0, 3).map((item) =>
        colorTools.selectorFor(item.image)
        + " visible mark approximately " + Math.round(item.visibleContentWidth) + "×" + Math.round(item.visibleContentHeight)
        + "px inside " + Math.round(item.boxWidth) + "×" + Math.round(item.boxHeight) + "px image box"
        + "; source mark occupies approximately "
        + Math.round((item.intrinsicContentWidth / item.naturalWidth) * 100) + "%×"
        + Math.round((item.intrinsicContentHeight / item.naturalHeight) * 100) + "% of the "
        + item.naturalWidth + "×" + item.naturalHeight + "px source canvas"
        + "; object-fit=" + item.objectFit),
      lowContrastPrimaryLogoCount: lowContrastPrimaryLogos.length,
      lowContrastPrimaryLogoExamples: lowContrastPrimaryLogos.slice(0, 3).map((item) =>
        colorTools.selectorFor(item.image)
        + " median pixel contrast " + (Math.round(item.medianContrast * 100) / 100) + ":1"
        + "; " + Math.round(item.clearPixelShare * 100) + "% of mark pixels reach 3:1"
        + "; surface " + item.surfaceValue),
      renderedAssetRevisionIds,
      renderedFactIds: [...new Set([...document.querySelectorAll("[data-lodesta-fact-id]")]
        .filter((element) => colorTools.visible(element))
        .map((element) => element.getAttribute("data-lodesta-fact-id"))
        .filter(Boolean))],
      lazyAboveFoldImageCount: lazyAboveFoldImages.length,
      lazyAboveFoldImageExamples: lazyAboveFoldImages.slice(0, 3).map((image) => colorTools.selectorFor(image)),
      missingMobileNavigation: navLinks.length >= 2 && visibleNavLinks.length === 0 && !visibleNavToggle,
      indiscernibleMobileNavigationToggleExamples: indiscernibleMobileNavigationToggles.slice(0, 3).map((control) =>
        colorTools.selectorFor(control) + " has no visible text or painted icon artwork"),
      mobileNavigationOverflowExamples: mobileNavigationOverflow.slice(0, 3).map((navigation) =>
        colorTools.selectorFor(navigation) + " (client " + navigation.clientWidth + "px, scroll " + navigation.scrollWidth + "px)"),
      misalignedMobileNavigationToggleExamples: misalignedMobileNavigationToggles.slice(0, 3).map((control) => {
        const rect = control.getBoundingClientRect();
        return colorTools.selectorFor(control) + " ends " + Math.round(innerWidth - rect.right) + "px from the viewport right edge";
      }),
      duplicateManagedNavigationIconExamples: duplicateManagedNavigationIcons.slice(0, 3).map((control) =>
        colorTools.selectorFor(control) + " draws ::before/::after artwork beside its managed icon"),
      desktopDualNavigationExamples: desktopDualNavigationControls.slice(0, 3).map((control) =>
        colorTools.selectorFor(control) + " remains visible beside a complete desktop navigation"),
      escapedEntityExamples,
      escapedSequenceExamples,
      links: [...document.querySelectorAll("a[href]")].map((link) => link.getAttribute("href") ?? "")
    };
})()`;

async function inspectPage(
  page: Page,
  canonicalLogoRevisionIds: ReadonlySet<string>,
  ownerLogoRevisionIds: ReadonlySet<string>
): Promise<BrowserPageMetrics> {
  await page.evaluate(({ canonical, owner }) => {
    Object.assign(globalThis, {
      __lodestaCanonicalLogoRevisionIds: canonical,
      __lodestaOwnerLogoRevisionIds: owner
    });
  }, { canonical: [...canonicalLogoRevisionIds], owner: [...ownerLogoRevisionIds] });
  return await page.evaluate(browserInspectionSource) as BrowserPageMetrics;
}

async function verifyLeadFormSubmissions(page: Page, route: string) {
  const forms = page.locator("form[data-lodesta-form-id]");
  const findings: ArtifactGateFinding[] = [];
  for (let index = 0; index < await forms.count(); index += 1) {
    const form = forms.nth(index);
    const formId = await form.getAttribute("data-lodesta-form-id") ?? `form_${index + 1}`;
    try {
      for (const field of await form.locator("input:not([type=hidden]):not([type=submit]), textarea").all()) {
        const type = (await field.getAttribute("type") ?? "text").toLowerCase();
        if (type === "checkbox") await field.check();
        else if (type === "radio") {
          if (!await form.locator(`input[type="radio"][name="${await field.getAttribute("name")}"]:checked`).count()) {
            await field.check();
          }
        } else {
          await field.fill(type === "email" ? "browser-gate@example.com" : type === "tel" ? "5125550100" : "Browser gate verification");
        }
      }
      for (const select of await form.locator("select").all()) {
        const options = await select.locator("option").all();
        const value = options.length > 1 ? await options[1].getAttribute("value") : options.length ? await options[0].getAttribute("value") : undefined;
        if (value !== undefined && value !== null) await select.selectOption(value);
      }
      await form.evaluate((element) => (element as HTMLFormElement).requestSubmit());
      const status = form.locator("[data-lodesta-form-status]");
      await status.waitFor({ state: "visible", timeout: 5_000 });
      await page.waitForFunction((id) => {
        const target = document.querySelector(`form[data-lodesta-form-id="${CSS.escape(String(id))}"] [data-lodesta-form-status]`);
        return Boolean(target?.textContent && target.textContent !== "Sending...");
      }, formId, { timeout: 5_000 });
      const message = (await status.textContent())?.trim() ?? "";
      if (!message || /could not send/i.test(message)) {
        findings.push(finding("capability.form_submit", `Lead form ${formId} did not complete the trusted-runtime submission path.`, route, "capability"));
      }
    } catch (error) {
      findings.push(finding("capability.form_submit", `Lead form ${formId} failed browser submission verification: ${error instanceof Error ? error.message : String(error)}`, route, "capability"));
    }
  }
  return findings;
}

type AccessibilityRuntimeContext = {
  attempt: 1 | 2;
  route: string;
  browserVersion: string;
  consoleErrors: string[];
};

type CanonicalAxeRuntime = {
  source: string;
  version: string;
  sourceHash: `sha256:${string}`;
};

let canonicalAxeRuntimePromise: Promise<CanonicalAxeRuntime> | undefined;

async function preloadAutomatedAccessibility(page: Page, context: AccessibilityRuntimeContext) {
  const runtime = await canonicalAxeRuntime();
  try {
    await page.addInitScript({ content: runtime.source });
  } catch (error) {
    throw browserVerificationUnavailable("preload", context, runtime, undefined, error);
  }
}

async function inspectAutomatedAccessibility(page: Page, context: AccessibilityRuntimeContext) {
  const canonical = await canonicalAxeRuntime();
  const readiness = await page.evaluate(() => {
    const runtime = (globalThis as typeof globalThis & {
      axe?: { version?: unknown; run?: unknown };
    }).axe;
    return {
      detectedVersion: typeof runtime?.version === "string" ? runtime.version : undefined,
      runnable: typeof runtime?.run === "function"
    };
  });
  if (!readiness.runnable || readiness.detectedVersion !== canonical.version) {
    throw browserVerificationUnavailable("readiness", context, canonical, readiness.detectedVersion);
  }
  const result = await page.evaluate(async () => {
    const runtime = (globalThis as typeof globalThis & {
      axe: { version: string; run: (context?: unknown, options?: unknown) => Promise<{
        violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }>;
      }> };
    }).axe;
    return {
      version: runtime.version,
      violations: (await runtime.run(document, {
        resultTypes: ["violations"],
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }
      })).violations
    };
  });
  const findings: ArtifactGateFinding[] = [
    finding("accessibility.axe.complete", `axe-core ${result.version} completed on the mobile route.`, context.route, "accessibility", "info")
  ];
  for (const violation of result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")) {
    findings.push(finding(
      `accessibility.axe.${violation.impact}.${violation.id}`,
      `${violation.help}: ${violation.nodes.length} node(s). Examples: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join("; ")}.`,
      context.route,
      "accessibility",
      "warning"
    ));
  }
  return findings;
}

function browserVerificationUnavailable(
  stage: BrowserVerificationUnavailableDetails["stage"],
  context: AccessibilityRuntimeContext,
  runtime: CanonicalAxeRuntime,
  detectedVersion?: string,
  cause?: unknown
) {
  return new BrowserVerificationUnavailableError({
    component: "axe-core",
    stage,
    attempt: context.attempt,
    route: context.route,
    viewport: "mobile",
    browserVersion: context.browserVersion,
    expectedVersion: runtime.version,
    detectedVersion,
    sourceHash: runtime.sourceHash,
    consoleErrors: context.consoleErrors.slice(-5).map((message) => message.slice(0, 500)),
    cause: cause instanceof Error ? cause.message.slice(0, 500) : cause === undefined ? undefined : String(cause).slice(0, 500)
  });
}

async function canonicalAxeRuntime() {
  canonicalAxeRuntimePromise ??= loadCanonicalAxeRuntime();
  return canonicalAxeRuntimePromise;
}

async function loadCanonicalAxeRuntime(): Promise<CanonicalAxeRuntime> {
  const packageRoot = resolve(process.cwd(), "node_modules", "axe-core");
  const [source, packageSource] = await Promise.all([
    readFile(resolve(packageRoot, "axe.min.js"), "utf8"),
    readFile(resolve(packageRoot, "package.json"), "utf8")
  ]);
  const packageDocument = JSON.parse(packageSource) as { version?: unknown };
  if (typeof packageDocument.version !== "string" || !packageDocument.version) {
    throw new Error("browser_verification_unavailable:axe-core package version is unavailable");
  }
  if (!source.includes(`axe.version="${packageDocument.version}"`)) {
    throw new Error("browser_verification_unavailable:axe-core source and package version do not match");
  }
  return {
    source,
    version: packageDocument.version,
    sourceHash: sha256(source)
  };
}

async function settleImages(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}"
  }).catch(() => undefined);
  await page.evaluate(async () => {
    for (const animation of document.getAnimations()) animation.pause();
    for (const media of document.querySelectorAll<HTMLMediaElement>("video,audio")) {
      media.pause();
    }
    for (const image of document.images) image.loading = "eager";
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.race([
      Promise.all([...document.images].map((image) => image.decode().catch(() => undefined))),
      new Promise<void>((resolve) => setTimeout(resolve, 10_000))
    ]);
  });
  await page.waitForFunction(() => [...document.images].every((image) => image.complete), undefined, { timeout: 10_000 }).catch(() => undefined);
  await settleScrollPosition(page, 0);
}

async function settleScrollPosition(page: Page, top: number) {
  let lastState: { target: number; actual: number; maximumScroll: number } | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lastState = await page.evaluate(async (requestedTop) => {
      document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
      document.body.style.setProperty("scroll-behavior", "auto", "important");
      const requested = Math.max(0, Number(requestedTop));
      const maximumBeforeScroll = Math.max(0, Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      ) - window.innerHeight);
      window.scrollTo(0, Math.min(maximumBeforeScroll, requested));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const maximumScroll = Math.max(0, Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      ) - window.innerHeight);
      const target = Math.min(maximumScroll, requested);
      window.scrollTo(0, target);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return { target, actual: window.scrollY, maximumScroll };
    }, top);
    if (Math.abs(lastState.actual - lastState.target) < 1) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`scroll_position_unsettled:${JSON.stringify(lastState)}`);
}

async function inspectCapturePageState(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const rect = header?.getBoundingClientRect();
    return {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      header: rect ? { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : undefined
    };
  });
}

async function navigatePageWithRetry(input: {
  page: Page;
  url: string;
  route: string;
  viewport: BrowserGateCapture["viewport"];
  signal?: AbortSignal;
}) {
  for (const attempts of [1, 2] as const) {
    try {
      return await abortable(input.page.goto(input.url, {
        // Finalized routes are fetched byte-for-byte before browser inspection,
        // and images are settled explicitly below. Network-idle is both
        // redundant and vulnerable to unrelated background polling.
        waitUntil: "load",
        timeout: 30_000
      }), input.signal);
    } catch (error) {
      if (input.signal?.aborted || !transientBrowserInfrastructureError(error)) throw error;
      if (attempts === 2) {
        throw new BrowserVerificationInfrastructureError({
          stage: "navigation",
          route: input.route,
          viewport: input.viewport,
          attempts,
          cause: browserFailureMessage(error)
        });
      }
      await input.page.goto("about:blank", { waitUntil: "commit", timeout: 5_000 }).catch(() => undefined);
    }
  }
  throw new Error("browser_navigation_retry_exhausted");
}

function validRenderedLink(href: string, route: string, routes: Set<string>) {
  if (href === "#") return false;
  if (href.startsWith("#") || /^tel:|^mailto:/i.test(href)) return true;
  if (/^https?:\/\//i.test(href)) {
    try { return ["http:", "https:"].includes(new URL(href).protocol); } catch { return false; }
  }
  try {
    const base = `https://site.invalid${route === "/" ? "/" : `${route}/`}`;
    return routes.has(normalizePath(new URL(href, base).pathname));
  } catch { return false; }
}

export function renderedLinkFailureMessage(
  href: string,
  route: string,
  preparedFindings: ArtifactGateFinding[]
) {
  const base = `Rendered link does not resolve to a declared route or safe public URL: ${href}`;
  if (href !== "#") return base;
  const rewrites = preparedFindings.filter((item) =>
    item.route === route
    && (item.id === "fact.link_mismatch" || item.id === "link.unsafe")
  );
  if (!rewrites.length) return base;
  return `${base}. The sanitizer rewrote the authored link; repair or remove its original source: ${rewrites
    .map((item) => item.message)
    .join(" ")}`;
}

function normalizePath(value: string) {
  const path = `/${value.replace(/^\/+|\/+$/g, "")}`;
  return path === "/" ? path : path.replace(/\/$/, "");
}

function routeKey(route: string) {
  return route === "/" ? "home" : route.slice(1).replace(/[^a-z0-9]+/gi, "-");
}

function comparablePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function finding(
  id: string,
  message: string,
  route: string,
  area: ArtifactGateFinding["area"] = "render",
  severity: ArtifactGateFinding["severity"] = "error"
): ArtifactGateFinding {
  return { id, severity, area, message, route };
}

function transientBrowserInfrastructureError(error: unknown) {
  if (error instanceof BrowserVerificationUnavailableError || error instanceof BrowserVerificationInfrastructureError) return true;
  const message = browserFailureMessage(error);
  if (message === "workflow_deadline_exhausted") return false;
  return /browser.*(?:closed|disconnected|launch)|target.*closed|timeout|timed out|econnreset|econnrefused|socket hang up|harness did not bind/i.test(message);
}

function startupBrowserInfrastructureError(error: unknown) {
  const message = browserFailureMessage(error);
  return /browser.*(?:closed|disconnected|launch)|harness did not bind/i.test(message);
}

function browserFailureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function dedupe(findings: ArtifactGateFinding[]) {
  const seen = new Set<string>();
  return findings.filter((item) => {
    const key = `${item.id}:${item.route}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function send(response: import("node:http").ServerResponse, status: number, body: Buffer, contentType: string) {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

function stopServer(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

function readRequestBody(request: import("node:http").IncomingMessage) {
  return new Promise<void>((resolveBody, reject) => {
    let bytes = 0;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 64 * 1024) request.destroy(new Error("Harness form payload exceeded 64 KiB."));
    });
    request.on("end", resolveBody);
    request.on("error", reject);
  });
}
