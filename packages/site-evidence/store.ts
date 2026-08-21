import { LocalArtifactBlobStore, type ImmutableBlob } from "@/packages/site-artifacts/blob-store";

export interface SiteEvidenceStore {
  get(key: string): Promise<ImmutableBlob | undefined>;
  putImmutable(blob: ImmutableBlob): Promise<void>;
}

export function configuredSiteEvidenceStore(): SiteEvidenceStore {
  // The destructive reset verifies a local, independently downloaded copy.
  // Remote retention is a separate operator concern and never adds GitHub or
  // another third party to the reset's availability boundary.
  return new LocalArtifactBlobStore(
    process.env.LODESTA_LOCAL_EVIDENCE_ROOT ?? `${process.cwd()}/.data/site-evidence`
  );
}
