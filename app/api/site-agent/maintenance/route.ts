import { after, NextResponse } from "next/server";
import { hasValidRecoveryWatchdogToken } from "@/lib/auth-policy";
import { processAutomaticRecovery } from "@/lib/recovery-watchdog";
import { siteAgentRecoveryStaleAfterMs } from "@/packages/site-platform/workflow";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasValidRecoveryWatchdogToken(request.headers)) {
    return NextResponse.json(
      { error: "Recovery watchdog authorization required" },
      { status: 401, headers: { "cache-control": "private, no-store" } }
    );
  }
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
    { ok: true, scheduled: true, profile: { limit: 4, staleAfterMs: siteAgentRecoveryStaleAfterMs } },
    { status: 202, headers: { "cache-control": "private, no-store" } }
  );
}
