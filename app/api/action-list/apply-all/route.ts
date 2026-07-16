import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { runSiteQa } from "@/lib/qa";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { sendOwnerOperationalEmail } from "@/lib/owner-notifications";

const applyAllSchema = z.object({
  siteId: z.string().min(1),
  mode: z.enum(["draft", "qa"]).default("draft"),
  includeAutoFix: z.boolean().default(true),
  includeOneClick: z.boolean().default(true)
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = applyAllSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid apply-all request", issues: parsed.error.issues }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });

  const allowedModes = new Set([
    parsed.data.includeAutoFix ? "auto_fix" : "",
    parsed.data.includeOneClick ? "one_click" : ""
  ]);
  const candidates = bundle.optimizationFindings.filter(
    (finding) => finding.status === "open" && allowedModes.has(finding.applyMode)
  );
  const results = [];

  for (const finding of candidates) {
    const result = await repository.applyFindingToDraft({ siteId: parsed.data.siteId, findingId: finding.id });
    results.push({
      findingId: finding.id,
      title: finding.title,
      applied: Boolean(result?.ok),
      reason: result && !result.ok ? result.reason : undefined,
      changeSummary: result?.ok ? result.changeSummary : undefined
    });
  }

  const updatedBundle = await repository.getSiteBundle(parsed.data.siteId);
  const qa = updatedBundle ? runSiteQa(updatedBundle, { versionStatus: "draft" }) : null;
  const appliedCount = results.filter((result) => result.applied).length;
  const claims = updatedBundle && appliedCount && qa?.passed ? await repository.listClaims(parsed.data.siteId) : [];
  const draftNotification =
    updatedBundle && appliedCount && qa?.passed
      ? await sendOwnerOperationalEmail({
          bundle: updatedBundle,
          claims,
          kind: "draft_awaiting_publish",
          subject: `${updatedBundle.businessProfile.name}: website draft ready to review`,
          summaryLines: [
            `${appliedCount} action-list improvement${appliedCount === 1 ? "" : "s"} were drafted.`,
            "Draft QA passed. Review the staged version before publishing."
          ],
          actionPath: `/versions/${updatedBundle.siteModel.slug}`
        })
      : {
          kind: "draft_awaiting_publish" as const,
          siteId: parsed.data.siteId,
          status: "skipped" as const,
          message: "No QA-passed draft was staged."
        };

  return NextResponse.json({
    results,
    qa,
    notification: draftNotification,
    published: false,
    publishConfirmationRequired: Boolean(qa?.passed),
    nextAction: qa?.passed ? "review_and_confirm_publish" : "fix_qa_before_publish"
  });
}
