import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { generationQaFromObjectiveGate, runObjectiveGenerationGate } from "@/lib/generation-objective-gate";
import { createRegenerableArtifactProvenanceV1 } from "@/lib/regenerable-artifact-provenance";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { assertSiteVersionV3 } from "@/lib/site-version-v3";

export const runtime = "nodejs";

const schema = z.object({
  siteId: z.string().trim().min(1),
  versionId: z.string().trim().min(1).optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid objective QA request", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const selected = parsed.data.versionId
    ? bundle.siteModel.versions.find((candidate) => candidate.id === parsed.data.versionId)
    : bundle.siteModel.versions.find((candidate) => candidate.status === "draft") ?? bundle.siteModel.versions[0];
  if (!selected) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  const version = assertSiteVersionV3(structuredClone(selected), "objective QA version");
  const plan = bundle.presenceAssessment.generationPlan;
  const copy = bundle.presenceAssessment.siteCopy;
  const snapshot = bundle.presenceAssessment.generationInputSnapshot;
  if (!plan || !copy || !snapshot || version.inputSnapshotId !== snapshot.id) {
    return NextResponse.json({ error: "This site uses a stale generation schema. Regenerate it before QA." }, { status: 409 });
  }

  const qaRunId = `objective_qa_${crypto.randomUUID().replace(/-/g, "")}`;
  const gate = await runObjectiveGenerationGate({ snapshot, version, plan, copy, qaRunId });
  version.generationQa = generationQaFromObjectiveGate(bundle, version, gate);
  await repository.saveSiteVersion({ siteId: parsed.data.siteId, version });

  const payload = { gate };
  const createdAt = gate.evaluatedAt;
  await repository.upsertSiteArtifact({
    id: `${parsed.data.siteId}_${version.id}_generation_review`,
    siteId: parsed.data.siteId,
    scope: "qa_evidence",
    artifactType: "generation_review",
    artifactVersion: gate.schemaVersion,
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "objective-site-qa",
      producerVersion: gate.schemaVersion,
      createdAt,
      inputs: { siteId: parsed.data.siteId, versionId: version.id, inputSnapshotId: snapshot.id, plan, copy }
    }),
    contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    payload,
    createdAt
  });

  return NextResponse.json({
    ok: gate.status === "pass",
    versionId: version.id,
    qa: version.generationQa
  }, { status: gate.status === "pass" ? 200 : 409 });
}
