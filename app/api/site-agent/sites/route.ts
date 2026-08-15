import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { siteAuthoringKernel } from "@/packages/site-authoring";

const bootstrapSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  idempotencyKey: z.string().trim().min(8).max(160),
  reportingTimezone: z.string().trim().min(1).max(100)
    .refine(validTimezone, "Enter a valid IANA timezone."),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional()
}).strict();

export async function POST(request: Request) {
  const auth = await getCurrentUser();
  if (!auth.configured || !auth.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = bootstrapSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: "Enter a valid public website URL.",
      code: "invalid_url",
      issues: parsed.error.issues
    }, { status: 400 });
  }
  try {
    const result = await siteAuthoringKernel.startProject({
      ...parsed.data,
      actor: { kind: "owner", id: auth.user.id },
      signal: request.signal
    });
    return NextResponse.json({
      siteId: result.site.id,
      runId: result.run.id,
      workspacePath: `/workspace/${result.site.slug}/editor`,
      site: result.site,
      session: result.session,
      run: result.run
    }, { status: 202 });
  } catch (error) {
    const rawCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : error instanceof Error && error.message === "idempotency_key_conflict"
        ? "idempotency_key_conflict"
        : undefined;
    const code = rawCode === "source_invalid" ? "invalid_url" : rawCode ?? "authoring_bootstrap_failed";
    const status = code === "idempotency_key_conflict" ? 409 : code === "invalid_url" ? 400 : 422;
    return NextResponse.json({
      error: code === "invalid_url"
        ? "Enter a valid public website URL."
        : error instanceof Error ? error.message : String(error),
      code
    }, { status });
  }
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
