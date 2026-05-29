import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { applyRateLimitHeaders, rateLimit, rateLimitConfig } from "@/lib/rate-limit";
import { claimGateForBundle } from "@/lib/site-publication";

const assignmentSchema = z.object({
  siteId: z.string().min(1),
  sessionId: z.string().min(1),
  experimentId: z.string().optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = assignmentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid experiment assignment request", issues: parsed.error.issues }, { status: 400 });
  }

  const limit = rateLimit(request, {
    bucket: "experiment_assign",
    keyParts: [parsed.data.siteId],
    ...rateLimitConfig("LODESTA_EXPERIMENT_ASSIGN", { limit: 300, windowMs: 60_000 })
  });
  if (!limit.ok) return limit.response;

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);

  const claimGate = claimGateForBundle(bundle, await repository.listClaims(parsed.data.siteId));
  if (!claimGate.ok) {
    return applyRateLimitHeaders(
      NextResponse.json({
        assigned: false,
        reason: "Site experiments start after claim and publish.",
        claimGate: claimGate.code
      }),
      limit
    );
  }

  return applyRateLimitHeaders(NextResponse.json(await repository.assignExperiment(parsed.data)), limit);
}
