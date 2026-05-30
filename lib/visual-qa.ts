import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { RenderInspectionResult, SiteBundle, VisualQaFinding, VisualQaResult } from "./models";
import { getOpenAiRuntimeSettings } from "./operator-settings";
import { extractOpenAiUsage, sanitizeTelemetryPayload, type AgentTelemetryRecorder } from "./agent-telemetry";

type VisualQaInput = {
  bundle: SiteBundle;
  renderInspection?: RenderInspectionResult;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
};

const findingSchema = z.object({
  id: z.string().min(1).max(80),
  category: z.enum(["hierarchy", "responsive", "conversion", "brand", "trust", "accessibility", "content"]),
  severity: z.enum(["pass", "warning", "fail"]),
  title: z.string().min(1).max(120),
  evidence: z.string().min(1).max(360),
  recommendation: z.string().max(360),
  viewport: z.enum(["desktop", "mobile", "none"])
});

const visualQaSchema = z.object({
  summary: z.string().min(1).max(420),
  findings: z.array(findingSchema).min(3).max(10),
  limitations: z.array(z.string()).min(1).max(6)
});

export async function createOpenAiVisualQa(input: VisualQaInput): Promise<VisualQaResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const screenshots = await screenshotInputs(input.renderInspection);
  if (!apiKey || screenshots.length === 0) {
    return createDeterministicVisualQa({
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
              "Evaluate hierarchy, mobile usability, CTA clarity, trust proof, brand fit, accessibility risks, and visible content quality.",
              "Do not invent business facts, legal claims, offers, prices, credentials, or reviews.",
              "Treat screenshots as QA evidence only; they are not source-of-truth UI."
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
          ...screenshots.map((screenshot) => ({
            type: "input_image" as const,
            image_url: screenshot.imageUrl,
            detail: "high" as const
          }))
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
      body: JSON.stringify(body)
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
    return {
      siteId: input.bundle.businessProfile.siteId,
      source: "openai",
      model,
      target: "source_site",
      evaluatedAt: new Date().toISOString(),
      screenshotCount: screenshots.length,
      selectedDesignDirectionId: input.bundle.presenceAssessment.selectedDesignDirectionId,
      summary: parsed.summary,
      findings: normalizeFindings(parsed.findings),
      limitations: parsed.limitations
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
    return createDeterministicVisualQa({
      ...input,
      limitation: `OpenAI visual QA unavailable: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}

function elapsedMs(startedAt: string, endedAt: string) {
  return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
}

export function createDeterministicVisualQa({
  bundle,
  renderInspection,
  limitation
}: VisualQaInput & { limitation?: string }): VisualQaResult {
  const selectedDirection = bundle.presenceAssessment.designDirections?.find((direction) => direction.selected);
  const version = bundle.siteModel.versions.find((item) => item.status === "published") ?? bundle.siteModel.versions[0];
  const home = version?.pages.find((page) => page.slug === "") ?? version?.pages[0];
  const sectionTypes = home?.sections.map((section) => section.type) ?? [];
  const metrics = renderInspection?.metrics;
  const findings: VisualQaFinding[] = [
    {
      id: "visual_qa.content_depth",
      category: "content",
      severity: metrics?.bodyTextChars === undefined || metrics.bodyTextChars >= 120 ? "pass" : "fail",
      title: "Rendered page has visible content",
      evidence:
        metrics?.bodyTextChars === undefined
          ? "No screenshot text metric was available, so SiteModel content depth is used as fallback evidence."
          : `${metrics.bodyTextChars} visible text characters were detected in render inspection.`,
      recommendation: metrics?.bodyTextChars !== undefined && metrics.bodyTextChars < 120 ? "Re-render the preview and inspect for blank or hidden content." : undefined
    },
    {
      id: "visual_qa.cta_clarity",
      category: "conversion",
      severity: metrics?.ctaCount === undefined || metrics.ctaCount > 0 ? "pass" : "fail",
      title: "Primary actions are visually available",
      evidence:
        metrics?.ctaCount === undefined
          ? "Structured hero and CTA sections are present in the SiteModel."
          : `${metrics.ctaCount} CTA-like elements were detected in render inspection.`,
      recommendation: metrics?.ctaCount === 0 ? "Restore a visible primary CTA above the fold." : undefined
    },
    {
      id: "visual_qa.above_fold_action",
      category: "hierarchy",
      severity: metrics?.aboveFoldCtaDetected === false ? "warning" : "pass",
      title: "Above-fold hierarchy supports action",
      evidence:
        metrics?.aboveFoldCtaDetected === false
          ? "Render inspection did not detect a CTA near the first viewport."
          : "CTA hierarchy is present in the first structured sections or render inspection.",
      recommendation: metrics?.aboveFoldCtaDetected === false ? "Move the primary CTA higher in the hero on desktop and mobile." : undefined
    },
    {
      id: "visual_qa.direction_alignment",
      category: "brand",
      severity: selectedDirection && sectionTypes.length >= 3 ? "pass" : "warning",
      title: "Selected design direction can compile into sections",
      evidence: selectedDirection
        ? `${selectedDirection.label} emphasizes ${selectedDirection.sectionEmphasis.slice(0, 4).join(", ")}; home sections are ${sectionTypes.slice(0, 5).join(", ")}.`
        : "No selected design direction was attached.",
      recommendation: selectedDirection ? undefined : "Select a design direction before visual QA."
    },
    {
      id: "visual_qa.screenshot_artifacts",
      category: "responsive",
      severity: renderInspection?.screenshots.length ? "pass" : "warning",
      title: "Screenshot artifacts are available for visual review",
      evidence: renderInspection?.screenshots.length
        ? `${renderInspection.screenshots.length} screenshot artifact(s) were captured.`
        : "No screenshot artifact was available; deterministic QA used render metrics and SiteModel checks only.",
      recommendation: renderInspection?.screenshots.length ? undefined : "Install Playwright/browser execution or connect an external browser provider."
    }
  ];

  return {
    siteId: bundle.businessProfile.siteId,
    source: "deterministic_fallback",
    target: renderInspection ? "source_site" : "generated_site_model",
    evaluatedAt: new Date().toISOString(),
    screenshotCount: renderInspection?.screenshots.length ?? 0,
    selectedDesignDirectionId: bundle.presenceAssessment.selectedDesignDirectionId,
    summary: summarizeFindings(findings),
    findings,
    limitations: [
      limitation ?? "Deterministic visual QA checks render metrics and structured sections, not raw pixels.",
      "Model-backed screenshot review runs only when screenshot artifacts and OPENAI_API_KEY are available."
    ]
  };
}

async function screenshotInputs(renderInspection?: RenderInspectionResult) {
  const screenshots = renderInspection?.screenshots.filter((screenshot) => screenshot.path).slice(0, 2) ?? [];
  const inputs: Array<{ imageUrl: string }> = [];
  for (const screenshot of screenshots) {
    if (!screenshot.path) continue;
    const bytes = await readFile(screenshot.path).catch(() => undefined);
    if (!bytes) continue;
    inputs.push({ imageUrl: `data:image/png;base64,${bytes.toString("base64")}` });
  }
  return inputs;
}

function visualQaContext({ bundle, renderInspection }: VisualQaInput) {
  const selectedDirection = bundle.presenceAssessment.designDirections?.find((direction) => direction.selected);
  return {
    productContract: {
      renderer: "structured multi-tenant Next.js renderer",
      editing: "curated controls",
      sourceMaterialPolicy: "public customer website material and assets are allowed in internal previews with provenance"
    },
    business: {
      name: bundle.businessProfile.name,
      vertical: bundle.businessProfile.vertical,
      categories: bundle.businessProfile.categories,
      primaryPhonePresent: Boolean(bundle.businessProfile.phone),
      reviewsSummary: bundle.businessProfile.reviewsSummary
    },
    selectedDesignDirection: selectedDirection
      ? {
          id: selectedDirection.id,
          strategy: selectedDirection.strategy,
          label: selectedDirection.label,
          rationale: selectedDirection.rationale,
          sectionEmphasis: selectedDirection.sectionEmphasis,
          generationRules: selectedDirection.generationRules,
          riskNotes: selectedDirection.riskNotes
        }
      : undefined,
    brandAssessment: bundle.presenceAssessment.brandAssessment,
    renderInspection: renderInspection
      ? {
          adapter: renderInspection.adapter,
          metrics: renderInspection.metrics,
          findings: renderInspection.findings.slice(0, 12)
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

function summarizeFindings(findings: VisualQaFinding[]) {
  const failures = findings.filter((finding) => finding.severity === "fail").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  if (failures) return `${failures} visual QA failure${failures === 1 ? "" : "s"} require review before launch.`;
  if (warnings) return `${warnings} visual QA warning${warnings === 1 ? "" : "s"} should be reviewed before publish.`;
  return "Visual QA checks passed for the available render and SiteModel evidence.";
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
  required: ["summary", "findings", "limitations"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 420 },
    findings: {
      type: "array",
      minItems: 3,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "severity", "title", "evidence", "recommendation", "viewport"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          category: {
            type: "string",
            enum: ["hierarchy", "responsive", "conversion", "brand", "trust", "accessibility", "content"]
          },
          severity: { type: "string", enum: ["pass", "warning", "fail"] },
          title: { type: "string", minLength: 1, maxLength: 120 },
          evidence: { type: "string", minLength: 1, maxLength: 360 },
          recommendation: { type: "string", maxLength: 360 },
          viewport: { type: "string", enum: ["desktop", "mobile", "none"] }
        }
      }
    },
    limitations: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string" }
    }
  }
} as const;
