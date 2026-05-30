import { NextResponse } from "next/server";
import { repository, type ListAgentRunsFilter } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import type { AgentRunSource, AgentRunStatus } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = new Set<AgentRunStatus>(["queued", "running", "completed", "failed", "canceled"]);
const sources = new Set<AgentRunSource>(["admin_console", "api", "job"]);

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const params = new URL(request.url).searchParams;
  const filter: ListAgentRunsFilter = {
    search: stringParam(params, "q"),
    status: enumParam(params, "status", statuses),
    runType: stringParam(params, "runType"),
    agentType: stringParam(params, "agentType"),
    source: enumParam(params, "source", sources),
    sourceHost: stringParam(params, "sourceHost"),
    targetType: stringParam(params, "targetType"),
    targetId: stringParam(params, "targetId"),
    from: stringParam(params, "from"),
    to: stringParam(params, "to"),
    limit: numberParam(params, "limit"),
    offset: numberParam(params, "offset")
  };
  const result = await repository.listAgentRuns(filter);
  return NextResponse.json(result);
}

function stringParam(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim();
  return value || undefined;
}

function numberParam(params: URLSearchParams, key: string) {
  const value = params.get(key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function enumParam<T extends string>(params: URLSearchParams, key: string, values: Set<T>) {
  const value = params.get(key)?.trim();
  return value && values.has(value as T) ? (value as T) : undefined;
}
