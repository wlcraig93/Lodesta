import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/security";
import { hasBearerToken, hasValidAdminToken, hasValidRecoveryWatchdogToken } from "@/lib/auth-policy";
import { processAutomaticRecovery } from "@/lib/recovery-watchdog";
import { siteAuthoringWorkflow } from "@/packages/site-platform";

export const runtime = "nodejs";

const requestSchema = z.object({
  limit: z.number().int().min(1).max(20).optional(),
  staleAfterMs: z.number().int().min(60_000).max(3_600_000).optional()
}).strict();

export async function POST(request: Request) {
  if (hasValidRecoveryWatchdogToken(request.headers)) {
    const body = await request.text();
    if (body.trim() !== "") {
      return NextResponse.json(
        { error: "Machine maintenance requests must have an empty body" },
        { status: 400, headers: { "cache-control": "private, no-store" } }
      );
    }
    const trigger = request.headers.get("x-lodesta-recovery-trigger") === "startup"
      ? "startup"
      : "cloudflare_cron";
    after(async () => {
      try {
        await processAutomaticRecovery(trigger);
      } catch (error) {
        console.error(JSON.stringify({
          event: "automatic_recovery_failed",
          trigger,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    });
    return NextResponse.json(
      { ok: true, scheduled: true, profile: { limit: 4, staleAfterMs: 45 * 60_000 } },
      { status: 202, headers: { "cache-control": "private, no-store" } }
    );
  }
  if (hasBearerToken(request.headers) && !hasValidAdminToken(request.headers)) {
    return NextResponse.json(
      { error: "Recovery watchdog authorization required" },
      { status: 401, headers: { "cache-control": "private, no-store" } }
    );
  }
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid maintenance request", issues: parsed.error.issues }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await siteAuthoringWorkflow.processRecoverableRuns(parsed.data)) });
}
