import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { RenderInspectionResult, SiteBundle, VisualQaFinding, VisualQaResult } from "./models";
import { getOpenAiRuntimeSettings } from "./operator-settings";
import { extractOpenAiUsage, sanitizeTelemetryPayload, type AgentTelemetryRecorder } from "./agent-telemetry";
import { openAiRequestSignal } from "./openai-timeout";
import { trustEvidenceItemsV1 } from "./evidence-ledger-v1";

type VisualQaInput = {
  bundle: SiteBundle;
  renderInspection?: RenderInspectionResult;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  signal?: AbortSignal;
  modelReview?: {
    allowed: boolean;
    reason?: string;
  };
};

const defectCategoryValues = [
  "contrast",
  "overflow",
  "blank_layout",
  "unreadable_text",
  "broken_media",
  "cramped_layout",
  "identity_coherence",
  "repetition",
  "none"
] as const;

const findingSchema = z.object({
  id: z.string().min(1).max(80),
  category: z.enum(["hierarchy", "responsive", "conversion", "brand", "trust", "accessibility", "content"]),
  severity: z.enum(["warning", "fail"]),
  title: z.string().min(1).max(120),
  evidence: z.string().min(1).max(360),
  recommendation: z.string().max(360),
  viewport: z.enum(["desktop", "tablet", "mobile", "none"]),
  defectCategory: z.enum(defectCategoryValues),
  confidence: z.number().min(0).max(1)
});

const visualQaSchema = z.object({
  verdict: z.enum(["ship", "revise"]),
  craftScore: z.number().min(0).max(100),
  summary: z.string().min(1).max(420),
  findings: z.array(findingSchema).max(8),
  limitations: z.array(z.string()).max(6)
});

export async function createOpenAiVisualQa(input: VisualQaInput): Promise<VisualQaResult> {
  if (input.modelReview && !input.modelReview.allowed) {
    return createUnavailableVisualQa({
      ...input,
      limitation: input.modelReview.reason ?? "Model-backed visual QA was skipped by the generation cost policy."
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const screenshots = await screenshotInputs(input.renderInspection);
  if (!apiKey || screenshots.length === 0) {
    return createUnavailableVisualQa({
      ...input,
      limitation: !apiKey
        ? "OPENAI_API_KEY is not set; visual QA used deterministic render and SiteModel checks."
        : "No screenshot artifacts were available; visual QA used deterministic render and SiteModel checks."
    });
  }

  const runtimeSettings = await getOpenAiRuntimeSettings();
  const model = runtimeSettings.settings.visualQaModel;
  const body = {
    model,
    reasoning: { effort: "low" },
    max_output_tokens: 2200,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You are Lodesta's visual QA reviewer for generated SMB website previews.",
              "Return only schema-valid JSON through Structured Outputs.",
              "Review like a strict agency creative director, not a lenient implementation checker.",
              "The target is a polished production website that can credibly compete with high-quality Webflow, Framer, Duda, Squarespace, or custom agency work.",
              "Make one holistic ship-or-revise judgment. Do not create dimension scores or average subgrades.",
              "Ship only when a small-business owner could reasonably feel proud to pay $30-$100 per month for the finished site and no material visual, trust, copy, media, conversion, mobile, or accessibility defect remains.",
              "Evaluate hierarchy, mobile usability, CTA clarity, source-backed trust proof, brand fit, visual rhythm, media fit, component depth, visible copy quality, and identity coherence as evidence for that single judgment.",
              "Use revise when copy sounds like planning language, media depicts the wrong work, sections repeat the same treatment, the identity feels disconnected, or the result still looks like a generic template.",
              "When the identity system itself is incoherent, use defectCategory identity_coherence and an id beginning with visual_qa.identity_coherence.",
              "craftScore is diagnostic context for humans, not a gate threshold. Score it on a native 0-100 scale with real resolution.",
              "Use fail for a material reason to revise and warning for a visible improvement that does not independently prevent shipping. Do not emit pass findings.",
              "Do not fail sparse source evidence when the page accurately uses all grounded facts and avoids invented proof; record the constraint in limitations.",
              "Calibration anchors: 100 = a small-business owner would be delighted to pay for this site as the finished product; 95 = flagship generated result with memorable identity, strong section craft, and no meaningful polish concerns; 90 = excellent production-grade, clearly better than a typical polished template, with only minor refinements visible; 85 = strong and credible but still visibly improvable; 80 = solid local-agency quality but not exceptional; 60 = generic, rough, or template-anonymous; 40 = weak or commercially risky; below 40 = broken or embarrassing.",
              "Use the top band precisely: an 88 is strong but misses excellence, a 92 is excellent with small polish opportunities, a 97 is rare and should feel close to custom flagship work.",
              "Do not invent business facts, legal claims, offers, prices, credentials, or reviews.",
              "Treat screenshots as QA evidence only; they are not source-of-truth UI.",
              "When mediaEligibility says intentionalNoMedia is true, do not penalize the result merely because images are absent and do not recommend invented proof. Judge whether the media-independent design still creates sufficient vertical-specific identity and trust.",
              "Screenshots are provided as full-resolution vertical bands sliced top-to-bottom per viewport plus individual section crops labeled by viewport/template. Review every band and crop — a defect low on the page or isolated inside one section is as disqualifying as one at the top.",
              "Cross-origin map iframes can render as gray placeholders in full-page screenshots while loading correctly in section crops. If a full-page band shows a gray map but the matching location section crop shows a loaded map, treat that as a screenshot-capture artifact: do not create a finding, do not classify it as broken_media/blank_layout, and do not penalize the score for it.",
              "For every finding, set defectCategory to the single best-matching concrete defect (contrast, overflow, blank_layout, unreadable_text, broken_media, cramped_layout, identity_coherence, repetition) or none when the finding is an editorial observation without a concrete rendering defect.",
              "unreadable_text means text that literally cannot be read: clipped, obscured, or rendered below legible size. Small-but-legible branding, weak hierarchy, or elements that fail to 'anchor' the design are editorial observations — category none.",
              "craftScore answers one question with brutal honesty: would a small-business owner be proud to pay for this site? Do not inflate a defect-free but stock-feeling page.",
              "Set confidence (0-1) to how certain you are the defect is real and visible in the screenshots; use below 0.5 when unsure."
            ].join(" ")
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(visualQaContext(input))
          },
          ...screenshots.flatMap((screenshot) => [
            { type: "input_text" as const, text: screenshot.label },
            { type: "input_image" as const, image_url: screenshot.imageUrl, detail: "high" as const }
          ])
        ]
      }
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "lodesta_visual_qa",
        strict: true,
        schema: responseJsonSchema
      }
    }
  };

  const startedAt = new Date().toISOString();
  let recorded = false;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: openAiRequestSignal(undefined, input.signal)
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    await input.telemetry?.recordModelCall({
      spanId: input.spanId,
      provider: "openai",
      model,
      endpoint: "/v1/responses",
      operation: "visual_qa",
      status: response.ok ? "completed" : "failed",
      requestJson: sanitizeTelemetryPayload(body),
      responseJson: sanitizeTelemetryPayload(payload),
      ...extractOpenAiUsage(payload),
      errorMessage: response.ok ? undefined : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
      startedAt,
      endedAt,
      durationMs: elapsedMs(startedAt, endedAt)
    });
    recorded = true;
    if (!response.ok) {
      throw new Error(openAiErrorMessage(payload) ?? `OpenAI visual QA failed with status ${response.status}`);
    }
    const text = extractResponseText(payload);
    if (!text) throw new Error("OpenAI visual QA response did not include output text.");
    const parsed = visualQaSchema.parse(JSON.parse(text));
    const renderInspection = input.renderInspection;
    const findings = normalizeFindings(parsed.findings);
    const verdict = normalizeVisualQaVerdict(parsed.verdict, findings);
    const limitations = parsed.verdict === verdict
      ? parsed.limitations
      : [...parsed.limitations, `Verdict normalized from ${parsed.verdict} to ${verdict} to match finding severities.`].slice(0, 6);
    return {
      siteId: input.bundle.businessProfile.siteId,
      source: "openai",
      model,
      target: renderInspection?.target ?? "generated_site_model",
      versionId: renderInspection?.versionId,
      siteModelHash: renderInspection?.siteModelHash,
      qaRunId: renderInspection?.qaRunId,
      evaluatedAt: new Date().toISOString(),
      screenshotCount: screenshots.length,
      schemaVersion: "visual-judgment-v1",
      verdict,
      summary: parsed.summary,
      craftScore: parsed.craftScore,
      findings,
      limitations
    };
  } catch (error) {
    if (!recorded) {
      const endedAt = new Date().toISOString();
      await input.telemetry?.recordModelCall({
        spanId: input.spanId,
        provider: "openai",
        model,
        endpoint: "/v1/responses",
        operation: "visual_qa",
        status: "failed",
        requestJson: sanitizeTelemetryPayload(body),
        errorMessage: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt,
        durationMs: elapsedMs(startedAt, endedAt)
      });
    }
    return createUnavailableVisualQa({
      ...input,
      limitation: `OpenAI visual QA unavailable: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}

function elapsedMs(startedAt: string, endedAt: string) {
  return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
}

export function createUnavailableVisualQa({
  bundle,
  renderInspection,
  limitation
}: VisualQaInput & { limitation?: string }): VisualQaResult {
  return {
    schemaVersion: "visual-judgment-v1",
    siteId: bundle.businessProfile.siteId,
    source: "unavailable",
    target: renderInspection?.target ?? "generated_site_model",
    versionId: renderInspection?.versionId,
    siteModelHash: renderInspection?.siteModelHash,
    qaRunId: renderInspection?.qaRunId,
    evaluatedAt: new Date().toISOString(),
    screenshotCount: renderInspection?.screenshots.length ?? 0,
    verdict: "not_evaluated",
    summary: "Model-backed visual judgment was not available.",
    findings: [],
    limitations: [
      limitation ?? "Model-backed screenshot review requires screenshot artifacts and OPENAI_API_KEY."
    ]
  };
}

// A full-page screenshot of a long site (a 1280x9691 desktop capture is
// routine) is scaled by the vision API to ~270px wide before tiling — every
// section becomes an illegible sliver, which is why squashed full-page review
// missed real defects. Instead we slice each capture into vertical bands at
// native width so the model reads each section at legible resolution. Bands
// fully tile the page (no silent coverage gap); the per-viewport cap only grows
// the band height for very tall pages, it never drops the tail.
const maxBandsPerViewport: Record<string, number> = { desktop: 6, mobile: 5, tablet: 3 };
const maxTotalBands = 14;
const maxSectionCrops = 24;
const bandViewportOrder = ["desktop", "mobile", "tablet"];

async function screenshotInputs(renderInspection?: RenderInspectionResult) {
  const screenshots = (renderInspection?.screenshots ?? []).filter((screenshot) => screenshot.path);
  const sectionScreenshots = (renderInspection?.sectionScreenshots ?? []).filter((screenshot) => screenshot.path);
  const ordered = [...screenshots].sort(
    (left, right) => bandViewportOrder.indexOf(left.viewport) - bandViewportOrder.indexOf(right.viewport)
  );
  const orderedSections = [...sectionScreenshots].sort((left, right) => {
    const viewportDiff = bandViewportOrder.indexOf(left.viewport) - bandViewportOrder.indexOf(right.viewport);
    return viewportDiff || left.sectionIndex - right.sectionIndex;
  });
  const inputs: Array<{ imageUrl: string; label: string }> = [];

  // sharp is a CJS `export =` module; under dynamic import the callable is on
  // `.default` (esbuild/tsx) or the namespace itself (node CJS) — accept either.
  type SharpFn = (input?: Buffer) => import("sharp").Sharp;
  let sharp: SharpFn | undefined;
  try {
    const mod = (await import("sharp")) as unknown;
    const candidate = typeof mod === "function" ? mod : (mod as { default?: unknown }).default;
    sharp = typeof candidate === "function" ? (candidate as SharpFn) : undefined;
  } catch {
    sharp = undefined;
  }

  const pushWhole = async (bytes: Buffer, viewport: string) =>
    inputs.push({ imageUrl: await encodeVisualQaImage(bytes, sharp), label: `${viewport} (full page)` });

  for (const screenshot of ordered) {
    if (inputs.length >= maxTotalBands || !screenshot.path) continue;
    const bytes = await readFile(screenshot.path).catch(() => undefined);
    if (!bytes) continue;
    if (!sharp) {
      await pushWhole(bytes, screenshot.viewport);
      continue;
    }
    try {
      const meta = await sharp(bytes).metadata();
      const width = meta.width ?? screenshot.width;
      const height = meta.height ?? screenshot.height;
      const screenful = Math.max(1, screenshot.height);
      // Short page: one screenful-ish — no banding needed.
      if (height <= screenful * 1.25) {
        await pushWhole(bytes, screenshot.viewport);
        continue;
      }
      const cap = Math.min(maxBandsPerViewport[screenshot.viewport] ?? 4, maxTotalBands - inputs.length);
      const bandCount = Math.max(1, Math.min(cap, Math.ceil(height / screenful)));
      const baseBand = Math.ceil(height / bandCount);
      const overlap = 48;
      for (let index = 0; index < bandCount; index += 1) {
        if (inputs.length >= maxTotalBands) break;
        const top = index * baseBand;
        if (top >= height) break;
        const bandHeight = Math.min(baseBand + (index < bandCount - 1 ? overlap : 0), height - top);
        if (bandHeight <= 0) break;
        const buffer = await sharp(bytes).extract({ left: 0, top, width, height: bandHeight }).png().toBuffer();
        inputs.push({
          imageUrl: await encodeVisualQaImage(buffer, sharp),
          label: `${screenshot.viewport} band ${index + 1}/${bandCount} (y ${top}-${top + bandHeight} of ${height}px)`
        });
      }
    } catch {
      await pushWhole(bytes, screenshot.viewport);
    }
  }
  for (const screenshot of orderedSections.slice(0, maxSectionCrops)) {
    if (!screenshot.path) continue;
    const bytes = await readFile(screenshot.path).catch(() => undefined);
    if (!bytes) continue;
    inputs.push({
      imageUrl: await encodeVisualQaImage(bytes, sharp),
      label: `${screenshot.viewport} ${screenshot.label}${screenshot.clipped ? " (top crop of tall section)" : ""}`
    });
  }
  return inputs;
}

async function encodeVisualQaImage(bytes: Buffer, sharp: ((input?: Buffer) => import("sharp").Sharp) | undefined) {
  if (!sharp) return `data:image/png;base64,${bytes.toString("base64")}`;
  try {
    const encoded = await sharp(bytes)
      .rotate()
      .resize({ width: 960, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${encoded.toString("base64")}`;
  } catch {
    return `data:image/png;base64,${bytes.toString("base64")}`;
  }
}

export function visualQaContext({ bundle, renderInspection }: Pick<VisualQaInput, "bundle" | "renderInspection">) {
  const business = bundle.businessProfile;
  const mediaCandidates = bundle.presenceAssessment.siteDirectorPlanV1?.plannerInputManifest.mediaCandidates ?? [];
  const designSystemId = bundle.presenceAssessment.siteDirectorPlanV1?.designSystem?.id;
  const renderSafeFacts = bundle.presenceAssessment.businessFactGraph?.facts
    .filter((fact) => fact.renderSafety === "render_safe")
    .slice(0, 24)
    .map((fact) => ({ kind: fact.kind, label: fact.label, value: fact.value, sourceUrl: fact.sourceUrl }));
  const trustClaims = trustEvidenceItemsV1(bundle.presenceAssessment.evidenceLedgerV1)
    .slice(0, 8)
    .map((item) => ({ kind: item.kind, text: item.value.text, displayText: item.value.displayText, sourceUrl: item.source.url }));
  return {
    productContract: {
      renderer: "structured multi-tenant Next.js renderer",
      editing: "curated controls",
      sourceMaterialPolicy: "public customer website material and assets are allowed in internal previews with provenance",
      qualityBar:
        "95/100 production-ready local-business website: beautiful, responsive, conversion-focused, source-grounded, visually varied below the hero, and free of generic AI/template copy."
    },
    business: {
      name: business.name,
      vertical: business.vertical,
      categories: business.categories,
      primaryPhonePresent: Boolean(business.phone),
      reviewsSummary: business.reviewsSummary
    },
    sourceGroundedFacts: {
      policy:
        "These values were harvested from source material or approved fact records. Use them to check factual grounding; do not penalize visible copy for using these facts.",
      description: business.description,
      services: business.services,
      serviceHighlights: business.serviceHighlights,
      businessStory: bundle.presenceAssessment.businessUnderstanding?.businessStory,
      contact: {
        phone: business.phone,
        email: business.email,
        phoneProvenance: business.provenance.phone,
        emailProvenance: business.provenance.email
      },
      credentials: business.credentials,
      offers: business.offers,
      trustClaims,
      address: business.address,
      hours: business.hours,
      renderSafeFacts
    },
    mediaEligibility: {
      designSystemId,
      candidateCount: mediaCandidates.length,
      heroEligibleCount: mediaCandidates.filter((asset) => asset.allowedUses.includes("hero")).length,
      proofEligibleCount: mediaCandidates.filter((asset) => asset.proofEligible).length,
      intentionalNoMedia: Boolean(designSystemId?.includes("no_media") && !mediaCandidates.some((asset) => asset.proofEligible || asset.allowedUses.includes("hero"))),
      policy:
        "Only source-approved, rights-cleared, slot-eligible media may render. Zero eligible candidates means the design must remain media-independent rather than fabricate visual proof."
    },
    designSystem: bundle.presenceAssessment.siteDirectorPlanV1?.designSystem
      ? {
          source: bundle.presenceAssessment.siteDirectorPlanV1.source,
          designSystemId: bundle.presenceAssessment.siteDirectorPlanV1.designSystem.id,
          designSystemLabel: bundle.presenceAssessment.siteDirectorPlanV1.designSystem.label,
          sectionCount: bundle.presenceAssessment.siteDirectorPlanV1.plan.home.sections.length
        }
      : undefined,
    brandAssessment: bundle.presenceAssessment.brandAssessment,
    renderInspection: renderInspection
      ? {
          adapter: renderInspection.adapter,
          metrics: renderInspection.metrics,
          findings: renderInspection.findings.slice(0, 12),
          sectionInspections: (renderInspection.sectionInspections ?? []).slice(0, 24).map((section) => ({
            viewport: section.viewport,
            label: section.label,
            templateId: section.templateId,
            fillRatio: Math.round(section.fillRatio * 100) / 100,
            headingOverflowPx: Math.round(section.headingOverflowPx),
            blockOverlapMaxRatio: Math.round(section.blockOverlapMaxRatio * 100) / 100,
            figureOverlapMaxRatio: Math.round(section.figureOverlapMaxRatio * 100) / 100,
            crampedTextCount: section.crampedTextCount,
            brokenImageCount: section.brokenImageCount,
            minTextContrastRatio:
              typeof section.minTextContrastRatio === "number" ? Math.round(section.minTextContrastRatio * 100) / 100 : undefined,
            failures: section.findings.filter((finding) => finding.severity === "fail").map((finding) => finding.id),
            warnings: section.findings.filter((finding) => finding.severity === "warning").map((finding) => finding.id)
          }))
        }
      : undefined
  };
}

function normalizeFindings(findings: z.infer<typeof findingSchema>[]): VisualQaFinding[] {
  return findings.map((finding) => ({
    ...finding,
    id: finding.id.replace(/[^a-z0-9_.-]+/gi, "_"),
    recommendation: finding.recommendation || undefined,
    viewport: finding.viewport === "none" ? undefined : finding.viewport
  }));
}

export function normalizeVisualQaVerdict(
  _modelVerdict: "ship" | "revise",
  findings: Pick<VisualQaFinding, "severity">[]
): "ship" | "revise" {
  return findings.some((finding) => finding.severity === "fail") ? "revise" : "ship";
}

function extractResponseText(payload: unknown) {
  if (isRecord(payload) && typeof payload.output_text === "string") return payload.output_text;
  if (!isRecord(payload) || !Array.isArray(payload.output)) return undefined;
  const parts: string[] = [];
  for (const output of payload.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) continue;
    for (const item of output.content) {
      if (!isRecord(item)) continue;
      if (item.type === "refusal" && typeof item.refusal === "string") {
        throw new Error(`OpenAI visual QA refused: ${item.refusal}`);
      }
      if (typeof item.parsed === "object" && item.parsed) return JSON.stringify(item.parsed);
      if (typeof item.text === "string") parts.push(item.text);
    }
  }
  return parts.join("").trim() || undefined;
}

function openAiErrorMessage(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  return typeof payload.error.message === "string" ? payload.error.message : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "craftScore", "summary", "findings", "limitations"],
  properties: {
    verdict: { type: "string", enum: ["ship", "revise"] },
    craftScore: { type: "number", minimum: 0, maximum: 100 },
    summary: { type: "string", minLength: 1, maxLength: 420 },
    findings: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "severity", "title", "evidence", "recommendation", "viewport", "defectCategory", "confidence"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          category: {
            type: "string",
            enum: ["hierarchy", "responsive", "conversion", "brand", "trust", "accessibility", "content"]
          },
          severity: { type: "string", enum: ["warning", "fail"] },
          title: { type: "string", minLength: 1, maxLength: 120 },
          evidence: { type: "string", minLength: 1, maxLength: 360 },
          recommendation: { type: "string", maxLength: 360 },
          viewport: { type: "string", enum: ["desktop", "tablet", "mobile", "none"] },
          defectCategory: {
            type: "string",
            enum: ["contrast", "overflow", "blank_layout", "unreadable_text", "broken_media", "cramped_layout", "identity_coherence", "repetition", "none"]
          },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    },
    limitations: {
      type: "array",
      maxItems: 6,
      items: { type: "string" }
    }
  }
} as const;
