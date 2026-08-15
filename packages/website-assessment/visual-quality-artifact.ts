import type { SiteBuildArtifact, SitePublicBuildInput } from "@/packages/site-contracts";
import { configuredArtifactBlobStore, type ArtifactBlobStore } from "@/packages/site-artifacts";
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
  selectArtifactVisualRoutes
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
  const contactSheetKeys = (["desktop", "mobile"] as const).map((viewport) => ({
    viewport,
    key: input.artifact.qa.screenshotKeys.find((key) =>
      key.endsWith(`/contact-sheet-${viewport}.png`)
    )
  }));
  if (contactSheetKeys.some((sheet) => !sheet.key)) {
    return unavailableVisualQuality({
      observedAt: input.observedAt,
      limitation: "The retained artifact did not contain separate native-frame desktop and mobile visual-review sheets."
    });
  }
  const store = input.store ?? configuredArtifactBlobStore();
  const retainedSheets = await Promise.all(contactSheetKeys.map(async (sheet) => ({
    viewport: sheet.viewport,
    blob: await store.get(sheet.key!).catch(() => undefined)
  })));
  if (retainedSheets.some((sheet) => !sheet.blob)) {
    return unavailableVisualQuality({
      observedAt: input.observedAt,
      limitation: "One or more retained artifact visual-review sheets could not be read."
    });
  }
  const routeSelection = artifactRouteSelection(input.artifact, input.buildInput);
  const vertical = artifactVertical(input.artifact, input.buildInput);
  const screenshots = artifactScreenshots(
    input.artifact,
    routeSelection.selected.flatMap((selection) => selection.route ? [selection.route] : [])
  );
  return evaluateVisualQuality({
    contactSheets: retainedSheets.map((sheet) => ({
      viewport: sheet.viewport,
      bytes: sheet.blob!.bytes,
      mimeType: sheet.blob!.contentType === "image/jpeg"
        ? "image/jpeg" as const
        : sheet.blob!.contentType === "image/webp"
          ? "image/webp" as const
          : "image/png" as const
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
      routeSelection,
      routes: input.artifact.routes.map((route) => ({
        path: route.path,
        title: route.title,
        description: route.description
      })),
      hardGate: input.artifact.qa.hardGate,
      renderFindings: input.artifact.qa.findings
        .filter((finding) => finding.area === "render" || finding.area === "asset")
        .slice(0, 50)
    },
    limitations: [
      "Visual Quality used retained artifact verification screenshots; public-serving behavior is assessed after publication."
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
      for (const frame of ["top", "middle", "bottom"] as const) {
        const suffix = `/${routeKey(route.path)}-${viewport}-${frame}.png`;
        const artifactKey = artifact.qa.screenshotKeys.find((key) => key.endsWith(suffix));
        if (artifactKey) screenshots.push({ route: route.path, viewport, frame, artifactKey });
      }
    }
  }
  return screenshots;
}

function artifactRouteSelection(
  artifact: SiteBuildArtifact,
  buildInput: SitePublicBuildInput
) {
  return selectArtifactVisualRoutes(artifact.routes, buildInput.intent.pageRequirements);
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
