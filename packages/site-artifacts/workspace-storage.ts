import { z } from "zod";
import { sha256, stableJson } from "@/packages/business-data";

const contentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/) as z.ZodType<`sha256:${string}`>;
const timestampSchema = z.string().datetime({ offset: true });
const workspacePathSchema = z.string().min(1).max(300).regex(/^src\/(?!.*\.\.)(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:css|json|ts|tsx)$/);

export const workspaceSourceSidecarV1Schema = z.object({
  schemaVersion: z.literal("workspace-source-sidecar-v1"),
  backupId: z.string().regex(/^[a-f0-9]{64}$/),
  archiveKey: z.string().regex(/^workspace-backups\/[a-f0-9]{64}\.tar\.gz$/),
  archiveHash: contentHashSchema,
  sandboxRevision: z.string().min(1).max(200),
  sourceHash: contentHashSchema,
  files: z.array(z.object({
    path: workspacePathSchema,
    content: z.string().max(4_000_000),
    contentHash: contentHashSchema,
    bytes: z.number().int().nonnegative().max(4_000_000)
  }).strict()).min(1).max(80),
  createdAt: timestampSchema
}).strict().superRefine((value, context) => {
  if (value.archiveKey !== `workspace-backups/${value.backupId}.tar.gz`) {
    context.addIssue({ code: "custom", path: ["archiveKey"], message: "Archive key does not match the sidecar backup ID." });
  }
  for (const [index, file] of value.files.entries()) {
    const bytes = Buffer.from(file.content);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.contentHash) {
      context.addIssue({ code: "custom", path: ["files", index], message: "Source file bytes do not match its immutable metadata." });
    }
  }
  const sourceFiles = value.files.map(({ path, content }) => ({ path, content }));
  if (sha256(stableJson(sourceFiles)) !== value.sourceHash) {
    context.addIssue({ code: "custom", path: ["sourceHash"], message: "Source hash does not match the canonical source-file manifest." });
  }
});
export type WorkspaceSourceSidecarV1 = z.infer<typeof workspaceSourceSidecarV1Schema>;

export function serializeWorkspaceSourceSidecar(value: WorkspaceSourceSidecarV1) {
  return Buffer.from(`${stableJson(workspaceSourceSidecarV1Schema.parse(value))}\n`);
}
