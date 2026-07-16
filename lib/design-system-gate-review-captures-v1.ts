import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  designSystemGateReviewCaptureV1,
  designSystemGateReviewFixtureByIdV1
} from "./design-system-gate-review-fixtures-v1";

export async function designSystemGateReviewCaptureResponseV1(fixtureId: string, captureId: string) {
  const capture = designSystemGateReviewCaptureV1(fixtureId, captureId);
  const fixture = designSystemGateReviewFixtureByIdV1(fixtureId);
  if (!capture || !fixture) return new Response("Capture not found", { status: 404 });

  const bytes = await readFile(
    join(process.cwd(), ".design", "design-system-gate-review", fixture.captureDirectory, capture.imageFileName)
  ).catch(() => null);
  if (!bytes) return new Response("Capture unavailable", { status: 404 });

  return new Response(bytes, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": capture.mediaType,
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}
