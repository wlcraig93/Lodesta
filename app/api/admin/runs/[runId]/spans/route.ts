import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/security";
import { configuredArtifactBlobStore } from "@/packages/site-artifacts";
import { sitePlatformRepository } from "@/packages/platform-data";

const querySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  includePayload: z.enum(["0", "1"]).default("0")
}).strict();

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { runId } = await params;
  const record = await sitePlatformRepository.getAgentRunAdminRecord(runId);
  if (!record) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!record.run) return NextResponse.json({ error: record.issue ?? "stale schema - rebuild", runId }, { status: 409 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid trace query", issues: parsed.error.issues }, { status: 400 });
  const objective = await sitePlatformRepository.getEditObjective(runId);
  const [spans, preflightSpans] = await Promise.all([
    sitePlatformRepository.listTraceSpans(runId, { afterSequence: parsed.data.after, limit: parsed.data.limit }),
    objective && parsed.data.after === undefined ? sitePlatformRepository.listTraceSpans(objective.requestId, { limit: 50 }) : []
  ]);
  const allSpans = [...preflightSpans, ...spans];
  const payloads: Record<string, unknown> = {};
  if (parsed.data.includePayload === "1") {
    const store = configuredArtifactBlobStore();
    for (const span of allSpans) {
      if (!span.payloadRef) continue;
      const blob = await store.get(span.payloadRef);
      payloads[span.id] = !blob
        ? { expired: true }
        : blob.contentHash !== span.payloadHash
          ? { integrityError: true }
          : JSON.parse(blob.bytes.toString("utf8"));
    }
  }
  return NextResponse.json({ runId, objective, preflightSpans, spans, payloads, nextAfter: spans.at(-1)?.sequence });
}
