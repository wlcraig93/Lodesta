import { z } from "zod";
import { replaceSourceDocumentSchema, type SitePublicBuildInput, type SourceSnapshot, type SourceSnapshotPage } from "@/packages/site-contracts";
import { sha256, stableJson } from "./hash";
import { isLegalSourcePagePath, normalizedSourcePagePath } from "./source-page-classification";

const approvalSchema = z.object({
  requestId: z.string().min(1),
  requestedBy: z.string().min(1),
  approvedBy: z.string().min(1),
  siteId: z.string().min(1),
  ownerOperationalRevision: z.number().int().positive(),
  change: replaceSourceDocumentSchema
}).strict();

export type ApprovedSourceDocument = {
  path: string;
  text: string;
  contentHash: string;
  approvalSourceId: string;
  sourceSnapshotId: string;
  sourcePageId: string;
  sourceTextHash: string;
  ownerOperationalRevision: number;
  contentFile: string;
};

/** Immutable, input-bound document authority; never rewrites a scraped page. */
export function resolveApprovedSourceDocuments(input: {
  buildInput: SitePublicBuildInput;
  snapshots: SourceSnapshot[];
  pages: SourceSnapshotPage[];
}): ApprovedSourceDocument[] {
  const boundIds = new Set(input.buildInput.sourceSnapshotIds);
  const snapshots = new Map(input.snapshots.filter(snapshot => boundIds.has(snapshot.id)).map(snapshot => [snapshot.id, snapshot]));
  const approvals = [...snapshots.values()].filter(snapshot => snapshot.sourceType === "owner_input"
    && (snapshot.payload.change as { kind?: unknown } | undefined)?.kind === "replace_source_document")
    .map(snapshot => {
      const parsed = approvalSchema.safeParse(snapshot.payload);
      if (!parsed.success || snapshot.businessId !== input.buildInput.businessId
        || snapshot.contentHash !== sha256(stableJson(snapshot.payload))
        || parsed.data.siteId !== input.buildInput.siteId
        || parsed.data.requestedBy !== parsed.data.approvedBy
        || parsed.data.ownerOperationalRevision > input.buildInput.ownerOperationalRevision) {
        throw new Error("owner_document_authority_invalid");
      }
      return { snapshot, approval: parsed.data };
    }).sort((a, b) => a.approval.ownerOperationalRevision - b.approval.ownerOperationalRevision);
  const resolved = new Map<string, ApprovedSourceDocument>();
  const revisions = new Set<number>();
  for (const { snapshot, approval } of approvals) {
    if (revisions.has(approval.ownerOperationalRevision)) throw new Error("owner_document_authority_ambiguous");
    revisions.add(approval.ownerOperationalRevision);
    const change = approval.change;
    const page = assertSourceDocumentTarget({ ...input, snapshots: [...snapshots.values()], change });
    const previous = resolved.get(change.path);
    if (change.expectedDocumentHash !== (previous?.contentHash ?? page.textContentHash)) {
      throw new Error("owner_document_authority_chain_invalid");
    }
    resolved.set(change.path, {
      path: change.path, text: change.replacementText, contentHash: sha256(change.replacementText),
      approvalSourceId: snapshot.id, sourceSnapshotId: page.sourceSnapshotId, sourcePageId: page.id,
      sourceTextHash: page.textContentHash, ownerOperationalRevision: approval.ownerOperationalRevision,
      contentFile: `source-site/owner-approved/${snapshot.id}.md`
    });
  }
  return [...resolved.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function assertSourceDocumentTarget(input: {
  buildInput: SitePublicBuildInput;
  snapshots: SourceSnapshot[];
  pages: SourceSnapshotPage[];
  change: z.infer<typeof replaceSourceDocumentSchema>;
}) {
  const { change, buildInput } = input;
  const snapshot = input.snapshots.find(item => item.id === change.sourceSnapshotId);
  const page = input.pages.find(item => item.id === change.sourcePageId && item.sourceSnapshotId === change.sourceSnapshotId);
  if (!snapshot || !buildInput.sourceSnapshotIds.includes(snapshot.id) || snapshot.sourceType !== "website"
    || snapshot.businessId !== buildInput.businessId || !page || page.outcome !== "fetched"
    || !isLegalSourcePagePath(change.path) || normalizedSourcePagePath(change.path) !== change.path
    || normalizedSourcePagePath(page.path) !== change.path || !change.replacementText.trim()
    || page.textContentHash !== change.sourceTextHash || sha256(page.extractedText) !== change.sourceTextHash) {
    throw new Error("owner_document_target_invalid");
  }
  return page;
}
