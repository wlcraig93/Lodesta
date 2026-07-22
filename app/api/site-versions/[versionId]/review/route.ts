import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizedOperator } from "@/app/api/site-agent/auth";
import { siteVersionApprovalV1Schema } from "@/packages/site-contracts";
import { sitePlatformRepository } from "@/packages/platform-data";
import { deriveSitePublicationReadiness } from "@/packages/site-platform";

const reviewSchema = z.object({ status: z.enum(["approved", "rejected"]), note: z.string().trim().min(1).max(2000) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const actor = await authorizedOperator(request);
  if (!actor.ok) return actor.response;
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid version review", issues: parsed.error.issues }, { status: 400 });
  const { versionId } = await params;
  const version = await sitePlatformRepository.getSiteVersion(versionId);
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const before = await deriveSitePublicationReadiness({ versionId, repository: sitePlatformRepository });
  const nonApprovalBlockers = before.blockers.filter((blocker) => blocker.code !== "operator_approval");
  if (parsed.data.status === "approved" && nonApprovalBlockers.length) {
    return NextResponse.json({ error: "Candidate has unresolved publication blockers", readiness: before }, { status: 422 });
  }
  const approval = siteVersionApprovalV1Schema.parse({
    schemaVersion: "site-version-approval-v1",
    id: `approval_${randomUUID().replaceAll("-", "")}`,
    siteId: version.siteId,
    versionId: version.id,
    artifactHash: version.artifactHash,
    status: parsed.data.status,
    actorId: actor.actorId,
    note: parsed.data.note,
    createdAt: new Date().toISOString()
  });
  await sitePlatformRepository.saveSiteVersionApproval(approval);
  return NextResponse.json({ approval, readiness: await deriveSitePublicationReadiness({ versionId, repository: sitePlatformRepository }) });
}
