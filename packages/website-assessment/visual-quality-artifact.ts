import type { SiteBuildArtifact, SitePublicBuildInput } from "@/packages/site-contracts";
import { configuredArtifactBlobStore, type ArtifactBlobStore } from "@/packages/site-artifacts";
import { createArtifactContactSheets, type BrowserGateCapture } from "@/packages/site-verification";
import type { VisualQuality } from "./contracts";
import {
  evaluateVisualQuality,
  visualQualityModelIsConfigured,
  type VisualQualityResponsesClient,
  type VisualQualityScreenshot
} from "./visual-quality-evaluator";
import { unavailableVisualQuality } from "./visual-quality";
import { inferAssessmentVertical } from "./vertical";
import {
  selectArtifactReviewRoutePaths
} from "./route-selection";

export async function evaluateArtifactVisualQuality(input: {
  artifact: SiteBuildArtifact;
  buildInput: SitePublicBuildInput;
  observedAt: string;
  signal?: AbortSignal;
  store?: ArtifactBlobStore;
  client?: VisualQualityResponsesClient;
}): Promise<VisualQuality> {
  if (!input.client && !visualQualityModelIsConfigured()) {
    return unavailableVisualQuality({
      observedAt: input.observedAt,
      limitation: "Visual Quality was unavailable because the multimodal evaluator is not configured."
    });
  }
  const store = input.store ?? configuredArtifactBlobStore();
  const selectedRoutes = selectArtifactReviewRoutePaths(
    input.artifact.routes,
    input.buildInput.intent.pageRequirements
  );
  const screenshots = artifactScreenshots(input.artifact, selectedRoutes);
  const screenshotRoutes = new Set(screenshots.map((screenshot) => screenshot.route));
  const missingRoutes = selectedRoutes.filter((route) => !screenshotRoutes.has(route));
  if (missingRoutes.length) {
    return unavailableVisualQuality({
      observedAt: input.observedAt,
      limitation: `Visual Quality was unavailable because exact retained frames were missing for: ${missingRoutes.join(", ")}.`
    });
  }
  // Read the small canonical evidence set in order. The artifact broker can
  // legitimately throttle a burst of concurrent immutable reads; serial reads
  // keep assessment deterministic without adding retries or recovery policy.
  const retainedCaptures: Array<{
    screenshot: VisualQualityScreenshot;
    blob: Awaited<ReturnType<ArtifactBlobStore["get"]>>;
  }> = [];
  for (const screenshot of screenshots) {
    retainedCaptures.push({
      screenshot,
      blob: await store.get(screenshot.artifactKey).catch(() => undefined)
    });
  }
  const unreadableCaptures = retainedCaptures.filter((capture) => !capture.blob);
  if (unreadableCaptures.length) {
    return unavailableVisualQuality({
      observedAt: input.observedAt,
      limitation: `Labeled retained artifact screenshots could not be read for: ${unreadableCaptures
        .map(({ screenshot }) => `${screenshot.route} ${screenshot.viewport} ${screenshot.frame}`)
        .join(", ")}.`
    });
  }
  let contactSheets: Awaited<ReturnType<typeof createArtifactContactSheets>>;
  try {
    contactSheets = await createArtifactContactSheets(
      retainedCaptures.map(({ screenshot, blob }): BrowserGateCapture => ({
        key: screenshot.artifactKey,
        route: screenshot.route,
        viewport: screenshot.viewport,
        stage: "settled",
        frame: screenshot.frame,
        bytes: blob!.bytes
      })),
      selectedRoutes
    );
  } catch (error) {
    return unavailableVisualQuality({
      observedAt: input.observedAt,
      limitation: `The exact labeled artifact review sheets could not be assembled: ${error instanceof Error ? error.message : String(error)}`
    });
  }
  const vertical = artifactVertical(input.artifact, input.buildInput);
  return evaluateVisualQuality({
    contactSheets: contactSheets.map((sheet) => ({
      viewport: sheet.viewport,
      bytes: sheet.bytes,
      mimeType: "image/png" as const
    })),
    screenshots,
    vertical: vertical.vertical,
    verticalConfidence: vertical.confidence,
    businessName: input.buildInput.business.name,
    primaryLocation: formattedArtifactLocation(input.buildInput),
    services: input.buildInput.business.offerings
      .filter((offering) => offering.status === "confirmed" && offering.visibility === "public")
      .map((offering) => offering.name),
    customerJourneys: inferredArtifactJourneys(input.buildInput),
    hasMeaningfulImagery: input.buildInput.business.assets.length > 0
      || input.artifact.capabilityBindings.some((binding) => binding.kind === "gallery"),
    deterministicContext: {
      target: "site_artifact",
      routeSelection: {
        policy: "artifact_route_family_review",
        selectedRoutes
      },
      routes: input.artifact.routes.map((route) => ({
        path: route.path,
        title: route.title,
        description: route.description
      })),
      hardGate: input.artifact.qa.hardGate,
      navigationEvidence: {
        interactiveDisclosureObserved: input.artifact.qa.findings.some((finding) =>
          finding.id === "functional.navigation_reachability"
        ),
        openedStateCaptured: screenshots.some((screenshot) => screenshot.frame === "navigation")
      },
      renderFindings: input.artifact.qa.findings
        .filter((finding) => finding.area === "render" || finding.area === "asset")
        .slice(0, 50)
    },
    limitations: [
      "Visual Quality used exact route-labeled retained artifact screenshots reassembled for the canonical sample; public-serving behavior is assessed after publication."
    ],
    observedAt: input.observedAt,
    signal: input.signal,
    client: input.client
  });
}

export function artifactVertical(
  artifact: SiteBuildArtifact,
  buildInput: SitePublicBuildInput
) {
  return inferAssessmentVertical({
    textEvidence: [
      buildInput.business.name,
      ...buildInput.business.offerings
        .filter((offering) => offering.status === "confirmed" && offering.visibility === "public")
        .map((offering) => offering.name),
      ...artifact.routes.flatMap((route) => [route.title, route.description])
    ]
  });
}

export function artifactScreenshots(
  artifact: SiteBuildArtifact,
  selectedRoutes: string[] = artifact.routes.map((route) => route.path)
): VisualQualityScreenshot[] {
  const screenshots: VisualQualityScreenshot[] = [];
  for (const route of artifact.routes.filter((item) => selectedRoutes.includes(item.path))) {
    for (const viewport of ["desktop", "mobile"] as const) {
      for (const frame of ["top", "middle", "bottom", "navigation"] as const) {
        const suffix = `/${routeKey(route.path)}-${viewport}-${frame}.png`;
        const artifactKey = artifact.qa.screenshotKeys.find((key) => key.endsWith(suffix));
        if (artifactKey) screenshots.push({ route: route.path, viewport, frame, artifactKey });
      }
    }
  }
  return screenshots;
}

function routeKey(route: string) {
  return route === "/" ? "home" : route.slice(1).replace(/[^a-z0-9]+/gi, "-");
}

function formattedArtifactLocation(buildInput: SitePublicBuildInput) {
  const location = buildInput.business.locations[0];
  return location
    ? [location.street, location.city, location.region, location.postalCode].filter(Boolean).join(", ")
    : buildInput.business.serviceAreas[0]?.label;
}

function inferredArtifactJourneys(buildInput: SitePublicBuildInput) {
  return [
    buildInput.business.contacts.phone ? "Call the business" : undefined,
    buildInput.forms.length ? "Submit an inquiry" : undefined,
    buildInput.business.offerings.some((offering) => offering.status === "confirmed" && offering.visibility === "public")
      ? "Evaluate a specific service"
      : undefined,
    buildInput.business.locations.length ? "Confirm location and hours" : undefined
  ].filter((value): value is string => Boolean(value));
}
