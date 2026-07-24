export type Vertical =
  | "restaurant"
  | "auto_body"
  | "auto_services"
  | "beauty_salon"
  | "med_spa"
  | "law_firm"
  | "dental"
  | "home_services"
  | "fitness"
  | "real_estate"
  | "landscaping"
  | "veterinary"
  | "creative_studio"
  | "general_local";

export type StandardCriterion = {
  id: string;
  layer: "technical_seo" | "conversion" | "trust" | "content_structure";
  vertical: "universal" | Vertical;
  title: string;
  checkMethod: "crawl" | "dom" | "render" | "vision" | "analytics" | "manual";
  threshold: Record<string, unknown>;
  businessConsequence: string;
  generationRule: string;
  auditEligible: boolean;
};

export type RenderViewportName = "desktop" | "tablet" | "mobile";
export type RenderInspectionTarget = "source_site" | "generated_site";

export type RenderScreenshotArtifact = {
  viewport: RenderViewportName;
  width: number;
  height: number;
  path?: string;
  bytes?: number;
  capturedAt: string;
};

export type RenderSectionScreenshotArtifact = RenderScreenshotArtifact & {
  sectionIndex: number;
  sectionId?: string;
  label: string;
  sectionTop: number;
  sectionHeight: number;
  clipped?: boolean;
};

export type RenderInspectionFinding = {
  id: string;
  severity: "pass" | "warning" | "fail";
  title: string;
  evidence: string;
  viewport?: RenderViewportName;
  sectionId?: string;
};

export type RenderElementRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type RenderSectionInspection = {
  viewport: RenderViewportName;
  sectionIndex: number;
  sectionId?: string;
  label: string;
  rect: RenderElementRect;
  textChars: number;
  fillRatio: number;
  imageCount: number;
  brokenImageCount: number;
  minTextContrastRatio?: number;
  headingOverflowPx: number;
  blockOverlapMaxRatio: number;
  figureOverlapMaxRatio: number;
  crampedTextCount: number;
  findings: RenderInspectionFinding[];
  screenshotPath?: string;
  screenshotBytes?: number;
};

export type RenderViewportMetrics = {
  viewport: { name: RenderViewportName; width: number; height: number };
  htmlBytes?: number;
  title?: string;
  bodyTextChars?: number;
  sectionCount?: number;
  ctaCount?: number;
  formCount?: number;
  telLinkCount?: number;
  imageCount?: number;
  loadedImageCount?: number;
  brokenImageCount?: number;
  aboveFoldCtaDetected?: boolean;
  primaryHeroCtaDetected?: boolean;
  primaryHeroCtaAboveFold?: boolean;
  primaryMediaImageLoaded?: boolean;
  siteHeaderDetected?: boolean;
  siteFooterDetected?: boolean;
  horizontalOverflowPx?: number;
  bodyFontSizePx?: number;
  minReadableTextFontSizePx?: number;
  minTextContrastRatio?: number;
  minTextContrastSample?: string;
  headerContrastRatio?: number;
  headerContrastSample?: string;
  headerVisualMode?: string;
  heroH1LineCount?: number;
  heroH1MaxLineWidthPx?: number;
  visualOverlapCount?: number;
  visualOverlapSamples?: string[];
  headingOverflowCount?: number;
  headingOverflowSamples?: string[];
  blockOverlapCount?: number;
  blockOverlapSamples?: string[];
  figureOverlapCount?: number;
  figureOverlapSamples?: string[];
  upscaledImageCount?: number;
  upscaledImageSamples?: string[];
  oversizedImageCount?: number;
  oversizedImageSamples?: string[];
  headerLogoSample?: string;
  a11yStructureIssues?: string[];
  sectionLowFillCount?: number;
  sectionLowFillSamples?: string[];
  crampedTextCount?: number;
  crampedTextSamples?: string[];
  heroMediaEdgeClipCount?: number;
  heroMediaEdgeClipSamples?: string[];
  sectionMediaOverflowCount?: number;
  sectionMediaOverflowSamples?: string[];
  formAffordanceIssueCount?: number;
  formAffordanceIssueSamples?: string[];
  contactFactWrapIssueCount?: number;
  contactFactWrapIssueSamples?: string[];
  consoleErrorCount?: number;
  consoleErrorSamples?: string[];
  headingFontFamily?: string;
  bodyFontFamily?: string;
  brandColorSamples?: string[];
  sectionInspections?: RenderSectionInspection[];
  rects?: {
    hero?: RenderElementRect;
    h1?: RenderElementRect;
    primaryHeroCta?: RenderElementRect;
    stickyCta?: RenderElementRect;
    primaryMedia?: RenderElementRect;
  };
};

export type RenderInspectionResult = {
  target: RenderInspectionTarget;
  siteId?: string;
  versionId?: string;
  siteModelHash?: string;
  qaRunId?: string;
  sourceUrl: string;
  finalUrl?: string;
  adapter: "playwright" | "fetch_fallback";
  capturedAt: string;
  screenshots: RenderScreenshotArtifact[];
  aboveFoldScreenshots?: RenderScreenshotArtifact[];
  sectionScreenshots?: RenderSectionScreenshotArtifact[];
  sectionInspections?: RenderSectionInspection[];
  findings: RenderInspectionFinding[];
  metrics: Omit<RenderViewportMetrics, "viewport">;
  metricsByViewport?: Partial<Record<RenderViewportName, RenderViewportMetrics>>;
  unavailableReason?: string;
};
