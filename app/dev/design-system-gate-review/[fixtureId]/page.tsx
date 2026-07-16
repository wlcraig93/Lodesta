import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DesignSystemGateReview } from "@/components/admin/DesignSystemGateReview";
import { latestDesignSystemGateReviewV1 } from "@/lib/design-system-gate-review-v1";
import { designSystemGateReviewFixtureByIdV1 } from "@/lib/design-system-gate-review-fixtures-v1";
import { repository } from "@/lib/repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Development Design System Gate Review | Lodesta",
  robots: { index: false, follow: false }
};

export default async function DevelopmentDesignSystemGateReviewPage({
  params
}: {
  params: Promise<{ fixtureId: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { fixtureId } = await params;
  const fixture = designSystemGateReviewFixtureByIdV1(fixtureId);
  if (!fixture) notFound();

  const artifacts = await repository.listSiteArtifacts({ artifactType: "v3_review_packet" });
  const review = latestDesignSystemGateReviewV1(artifacts, fixture.designSystemId);

  return (
    <main className="admin-page design-gate-review-page design-gate-review-page-dev">
      <AdminPageHeader
        eyebrow="Development review"
        title={fixture.businessName}
        description={`Four-way gate comparison. Pricing lens: ${fixture.pricePrompt}.`}
      />
      <DesignSystemGateReview
        fixture={fixture}
        initialReview={review}
        capturePathBase={`/dev/design-system-gate-review/${fixtureId}/captures`}
        pilotPreviewHref={`/dev/site-candidate-previews/${fixture.candidateId}`}
        saveEnabled={false}
      />
    </main>
  );
}
