import "./load-env";

import { getSupabaseAdminClient } from "../lib/supabase/client";

const supabase = getSupabaseAdminClient();
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17)}${crypto.randomUUID().slice(0, 8)}`;
const heartbeatJobId = `verify_heartbeat_${runId}`;
const staleJobId = `verify_stale_reclaim_${runId}`;

async function main() {
  const workerId = `verify-worker-${runId}`;
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const staleAt = "1970-01-01T00:00:00.000Z";
  try {
    await requireSupabase(
      supabase.from("jobs").insert({
        id: heartbeatJobId,
        kind: "agent_telemetry_cleanup",
        status: "running",
        payload: { verifier: "job_heartbeat" },
        attempts: 1,
        max_attempts: 3,
        run_after: startedAt,
        locked_by: workerId,
        locked_at: startedAt,
        started_at: startedAt,
        created_at: startedAt,
        updated_at: startedAt
      }),
      "insert heartbeat job"
    );
    const heartbeatAt = new Date().toISOString();
    const heartbeatRows = await requireSupabase<Array<{ id: string; locked_at: string }>>(
      supabase
        .from("jobs")
        .update({ locked_at: heartbeatAt, updated_at: heartbeatAt })
        .eq("id", heartbeatJobId)
        .eq("locked_by", workerId)
        .eq("status", "running")
        .select("id, locked_at"),
      "heartbeat matching job"
    );
    assert(heartbeatRows.length === 1, "matching heartbeat must update exactly one row");

    const wrongWorkerRows = await requireSupabase<Array<{ id: string }>>(
      supabase
        .from("jobs")
        .update({ locked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", heartbeatJobId)
        .eq("locked_by", `${workerId}-wrong`)
        .eq("status", "running")
        .select("id"),
      "heartbeat wrong worker"
    );
    assert(wrongWorkerRows.length === 0, "wrong-worker heartbeat must affect zero rows");

    await requireSupabase(
      supabase.from("jobs").insert({
        id: staleJobId,
        kind: "agent_telemetry_cleanup",
        status: "running",
        payload: { verifier: "stale_reclaim" },
        attempts: 1,
        max_attempts: 3,
        run_after: staleAt,
        locked_by: `stale-${workerId}`,
        locked_at: staleAt,
        started_at: staleAt,
        created_at: staleAt,
        updated_at: staleAt
      }),
      "insert stale reclaim job"
    );
    const claimed = await requireSupabase<Array<{ id: string; locked_by: string; status: string; attempts: number }>>(
      supabase.rpc("claim_next_job", { worker_id: workerId, stale_after_seconds: 900 }),
      "claim stale job"
    );
    assert(
      claimed.some((job) => job.id === staleJobId && job.locked_by === workerId && job.status === "running" && job.attempts === 2),
      `stale running job must be reclaimable by claim_next_job; claimed=${JSON.stringify(claimed)}`
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          heartbeatJobId,
          staleJobId,
          checks: ["heartbeat_match", "heartbeat_wrong_worker_zero_rows", "stale_reclaim"]
        },
        null,
        2
      )}\n`
    );
  } finally {
    await supabase.from("jobs").delete().in("id", [heartbeatJobId, staleJobId]);
  }
}

async function requireSupabase<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
