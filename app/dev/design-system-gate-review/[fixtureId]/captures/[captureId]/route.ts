import { notFound } from "next/navigation";
import { designSystemGateReviewCaptureResponseV1 } from "@/lib/design-system-gate-review-captures-v1";
import { designSystemGateReviewFixtureByIdV1 } from "@/lib/design-system-gate-review-fixtures-v1";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fixtureId: string; captureId: string }> }
) {
  if (process.env.NODE_ENV === "production") notFound();
  const { fixtureId, captureId } = await params;
  if (!designSystemGateReviewFixtureByIdV1(fixtureId)) return new Response("Review fixture not found", { status: 404 });
  return designSystemGateReviewCaptureResponseV1(fixtureId, captureId);
}
