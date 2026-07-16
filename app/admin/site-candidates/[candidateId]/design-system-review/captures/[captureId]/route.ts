import { designSystemGateReviewCaptureResponseV1 } from "@/lib/design-system-gate-review-captures-v1";
import { designSystemGateReviewFixtureByCandidateIdV1 } from "@/lib/design-system-gate-review-fixtures-v1";
import { requireAdminPageAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ candidateId: string; captureId: string }> }
) {
  const { candidateId, captureId } = await params;
  await requireAdminPageAccess(`/admin/site-candidates/${candidateId}/design-system-review`);
  const fixture = designSystemGateReviewFixtureByCandidateIdV1(candidateId);
  if (!fixture) return new Response("Review fixture not found", { status: 404 });
  return designSystemGateReviewCaptureResponseV1(fixture.fixtureId, captureId);
}
