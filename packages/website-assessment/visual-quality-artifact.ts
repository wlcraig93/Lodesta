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
import { assessmentVerticalForDomainContext } from "./vertical";

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
  const contactSheetKey = input.artifact.qa.screenshotKeys.find((key) => key.endsWith("/contact-sheet.png"));
  if (!contactSheetKey) {
    return unavailableVisualQuality({
      observedAt: input.observedAt,
      limitation: "The retained artifact did not contain a visual-review contact sheet."
    });
  }
  const store = input.store ?? configuredArtifactBlobStore();
  const contactSheet = await store.get(contactSheetKey).catch(() => undefined);
  if (!contactSheet) {
    return unavailableVisualQuality({
      observedAt: input.observedAt,
      limitation: "The retained artifact contact sheet could not be read."
    });
  }
  const screenshots = artifactScreenshots(input.artifact);
  return evaluateVisualQuality({
    contactSheet: contactSheet.bytes,
    contactSheetMimeType: contactSheet.contentType === "image/jpeg"
      ? "image/jpeg"
      : contactSheet.contentType === "image/webp"
        ? "image/webp"
        : "image/png",
    screenshots,
    vertical: assessmentVerticalForDomainContext(input.buildInput.domainContext?.id),
    verticalConfidence: input.buildInput.domainContext ? 1 : 0.35,
    businessName: input.buildInput.business.name,
    primaryLocation: formattedArtifactLocation(input.buildInput),
    services: input.buildInput.business.offerings
      .filter((offering) => offering.status === "confirmed" && offering.visibility === "public")
      .map((offering) => offering.name),
    customerJourneys: input.buildInput.domainContext?.customerJourneys ?? [],
    hasMeaningfulImagery: input.buildInput.business.assets.length > 0
      || input.artifact.capabilityBindings.some((binding) => binding.kind === "gallery"),
    deterministicContext: {
      target: "site_artifact",
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

export function artifactScreenshots(artifact: SiteBuildArtifact): VisualQualityScreenshot[] {
  const screenshots: VisualQualityScreenshot[] = [];
  for (const route of artifact.routes) {
    for (const viewport of ["desktop", "mobile"] as const) {
      const suffix = `/${routeKey(route.path)}-${viewport}.png`;
      const artifactKey = artifact.qa.screenshotKeys.find((key) => key.endsWith(suffix));
      if (artifactKey) screenshots.push({ route: route.path, viewport, artifactKey });
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
