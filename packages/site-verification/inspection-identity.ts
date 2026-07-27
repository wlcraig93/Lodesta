import { sha256, stableJson } from "@/packages/business-data";
import type { SiteBuildArtifact } from "@/packages/site-contracts";

export function createInspectionIdentity(input: {
  context: Record<string, unknown>;
  findings: SiteBuildArtifact["qa"]["findings"];
  captures: Array<{ route: string; viewport: string; bytes: Buffer }>;
}) {
  return sha256(stableJson({
    schemaVersion: 1,
    ...input.context,
    findings: normalizeInspectionFindings(input.findings),
    captures: input.captures
      .map((capture) => ({
        route: capture.route,
        viewport: capture.viewport,
        contentHash: sha256(capture.bytes)
      }))
      .sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
  }));
}

export function normalizeInspectionFindings(findings: SiteBuildArtifact["qa"]["findings"]) {
  return findings
    .map(({ severity, area, message, route }) => ({ severity, area, message, route }))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}
