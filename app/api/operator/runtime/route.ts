import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizedOperator } from "@/app/api/site-agent/auth";
import { sitePlatformRepository } from "@/packages/platform-data";
import { promoteRuntimePatch, rollbackRuntimePatch, type RuntimeRegistry } from "@/packages/trusted-runtime";

const seriesIdSchema = z.string().regex(/^site-runtime-v[1-9][0-9]*$/).max(160);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("promote"), seriesId: seriesIdSchema, patchId: z.string().min(1).max(160) }).strict(),
  z.object({ action: z.literal("rollback"), seriesId: seriesIdSchema }).strict()
]);

export async function GET(request: Request) {
  const actor = await authorizedOperator(request);
  if (!actor.ok) return actor.response;
  const parsedSeriesId = seriesIdSchema.safeParse(new URL(request.url).searchParams.get("seriesId"));
  if (!parsedSeriesId.success) return NextResponse.json({ error: "A valid seriesId query parameter is required" }, { status: 400 });
  const runtimeSeriesId = parsedSeriesId.data;
  const series = await sitePlatformRepository.getRuntimeSeries(runtimeSeriesId);
  if (!series) return NextResponse.json({ series: null });
  const [activePatch, previousPatch] = await Promise.all([
    sitePlatformRepository.getRuntimePatch(series.activePatchId),
    series.previousPatchId ? sitePlatformRepository.getRuntimePatch(series.previousPatchId) : undefined
  ]);
  return NextResponse.json({ series, activePatch, previousPatch });
}

export async function POST(request: Request) {
  const actor = await authorizedOperator(request);
  if (!actor.ok) return actor.response;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid runtime action" }, { status: 400 });
  try {
    const registry = repositoryRuntimeRegistry();
    const runtimeSeriesId = parsed.data.seriesId;
    const series = parsed.data.action === "promote"
      ? await promoteRuntimePatch({ registry, seriesId: runtimeSeriesId, patchId: parsed.data.patchId, actorId: actor.actorId })
      : await rollbackRuntimePatch({ registry, seriesId: runtimeSeriesId, actorId: actor.actorId });
    return NextResponse.json({ ok: true, series });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Runtime action failed" }, { status: 409 });
  }
}

function repositoryRuntimeRegistry(): RuntimeRegistry {
  return {
    getSeries: (id) => sitePlatformRepository.getRuntimeSeries(id),
    getPatch: (id) => sitePlatformRepository.getRuntimePatch(id),
    savePatch: async (patch) => sitePlatformRepository.saveRuntimePatch(patch),
    saveSeries: (series) => sitePlatformRepository.saveRuntimeSeries(series)
  };
}
