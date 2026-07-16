import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminButtonLink } from "@/components/admin/AdminButton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DesignSystemGateReview } from "@/components/admin/DesignSystemGateReview";
import { latestDesignSystemGateReviewV1 } from "@/lib/design-system-gate-review-v1";
import { designSystemGateReviewFixtureByCandidateIdV1 } from "@/lib/design-system-gate-review-fixtures-v1";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Design System Gate Review | Lodesta",
  robots: { index: false, follow: false }
};

export default async function DesignSystemGateReviewPage({
  params
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const { candidateId } = await params;
  await requireAdminPageAccess(`/admin/site-candidates/${candidateId}/design-system-review`);
  const fixture = designSystemGateReviewFixtureByCandidateIdV1(candidateId);
  if (!fixture) notFound();

  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate || candidate.candidatePurpose !== "test_generation") notFound();
  const artifacts = await repository.listSiteArtifacts({ artifactType: "v3_review_packet" });
  const review = latestDesignSystemGateReviewV1(artifacts, fixture.designSystemId);
  const capturePathBase = `/admin/site-candidates/${candidateId}/design-system-review/captures`;

  return (
    <main className="admin-page design-gate-review-page">
      <AdminPageHeader
        eyebrow="Auto body pilot"
        title={fixture.businessName}
        description={`Compare the replacement against the previous pipeline and two market references. Pricing lens: ${fixture.pricePrompt}.`}
        actions={
          <AdminButtonLink href={`/admin/site-candidates/${candidateId}`} variant="secondary">
            Back to candidate
          </AdminButtonLink>
        }
      />
      <DesignSystemGateReview
        fixture={fixture}
        initialReview={review}
        capturePathBase={capturePathBase}
        pilotPreviewHref={`/site-candidate-previews/${candidateId}`}
      />
    </main>
  );
}
