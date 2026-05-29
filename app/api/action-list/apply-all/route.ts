import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { runSiteQa } from "@/lib/qa";
import { requireAdminOrSiteOwner } from "@/lib/security";

const applyAllSchema = z.object({
  siteId: z.string().min(1),
  mode: z.enum(["draft", "publish_after_qa"]).default("draft"),
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
      reason: result && !result.ok ? result.reason : undefined
    });
  }

  const updatedBundle = await repository.getSiteBundle(parsed.data.siteId);
  const qa = updatedBundle ? runSiteQa(updatedBundle, { versionStatus: "draft" }) : null;
  if (parsed.data.mode === "publish_after_qa") {
    if (!qa?.passed) return NextResponse.json({ results, qa, published: false });
    const publish = await repository.publishDraft(parsed.data.siteId);
    return NextResponse.json({ results, qa, published: Boolean(publish?.ok), publish });
  }

  return NextResponse.json({ results, qa, published: false });
}
