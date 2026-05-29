import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { runSiteQa } from "@/lib/qa";
import { requireAdminOrSiteOwner } from "@/lib/security";

const aiEditSchema = z.object({
  siteId: z.string().min(1),
  message: z.string().min(1).max(4000),
  mode: z.enum(["draft", "qa"]).default("draft")
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = aiEditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid AI edit request", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const result = await repository.applyAiEdit({
    siteId: parsed.data.siteId,
    message: parsed.data.message
  });
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        issues: result.guardrailIssues,
        warnings: result.warnings,
        result
      },
      { status: 400 }
    );
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  const qa = bundle ? runSiteQa(bundle, { versionStatus: "draft" }) : null;

  return NextResponse.json({
    ...withoutBundle(result),
    qa,
    published: false,
    publishConfirmationRequired: Boolean(result.mutated && qa?.passed),
    nextAction: qa?.passed ? "review_and_confirm_publish" : "fix_qa_before_publish"
  });
}

function withoutBundle<T extends { bundle?: unknown }>(result: T) {
  const { bundle: _bundle, ...rest } = result;
  return rest;
}
