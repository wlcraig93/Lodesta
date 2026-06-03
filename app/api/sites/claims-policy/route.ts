import { NextResponse } from "next/server";
import { z } from "zod";
import { runClaimVerificationReportV2 } from "@/lib/claim-report-v2";
import { runPolicyReportV2 } from "@/lib/policy-report-v2";
import { runRegulatedClaimsPolicyV2 } from "@/lib/regulated-claims-policy-v2";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const claimsPolicySchema = z.object({
  siteId: z.string().trim().min(1),
  versionId: z.string().trim().min(1).optional()
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = claimsPolicySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid claims and policy request", issues: parsed.error.issues }, { status: 400 });
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const version = parsed.data.versionId
    ? bundle.siteModel.versions.find((candidate) => candidate.id === parsed.data.versionId)
    : bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? bundle.siteModel.versions[0];
  if (!version) return NextResponse.json({ error: "No site version is available for claims and policy audit." }, { status: 409 });

  const claimReport = runClaimVerificationReportV2({
    bundle,
    version,
    siteId: bundle.businessProfile.siteId
  });
  const policyReport = runPolicyReportV2({
    bundle,
    version,
    siteId: bundle.businessProfile.siteId
  });
  const regulatedClaimsPolicy = runRegulatedClaimsPolicyV2({
    bundle,
    version,
    siteId: bundle.businessProfile.siteId
  });
  await repository.upsertGenerationArtifact(claimReport.artifact);
  await repository.upsertGenerationArtifact(policyReport.artifact);
  await repository.upsertGenerationArtifact(regulatedClaimsPolicy.artifact);

  return NextResponse.json({
    versionId: version.id,
    summary: `${claimReport.summary} ${policyReport.summary} ${regulatedClaimsPolicy.summary}`,
    claimReport: {
      status: claimReport.status,
      issues: claimReport.issues,
      artifactId: claimReport.artifact.id
    },
    policyReport: {
      status: policyReport.status,
      issues: policyReport.issues,
      artifactId: policyReport.artifact.id
    },
    regulatedClaimsPolicy: {
      status: regulatedClaimsPolicy.status,
      issues: regulatedClaimsPolicy.issues,
      artifactId: regulatedClaimsPolicy.artifact.id
    }
  });
}
