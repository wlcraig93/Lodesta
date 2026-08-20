import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  configuredArtifactBlobStore,
  workspaceSourceSidecarKey,
  workspaceSourceSidecarSchema
} from "../packages/site-artifacts";
import { sitePlatformRepository } from "../packages/platform-data";
import { createArchitectureEvidenceFiles } from "../packages/site-agent/architecture";
import {
  liveAuthoringProfile,
  retainedContentModeForAuthoringProfile
} from "../packages/site-agent/authoring-profile";
import { requiredDestinationsSource } from "../workers/site-sandbox/src/initial-source";

const runId = process.env.LODESTA_RECONSTRUCT_RUN_ID?.trim();
const outputDirectoryInput = process.env.LODESTA_RECONSTRUCT_OUTPUT_DIR?.trim();
const throughSequenceInput = process.env.LODESTA_RECONSTRUCT_THROUGH_SEQUENCE?.trim();

if (!runId) throw new Error("LODESTA_RECONSTRUCT_RUN_ID is required.");
if (!outputDirectoryInput) throw new Error("LODESTA_RECONSTRUCT_OUTPUT_DIR is required.");
const throughSequence = throughSequenceInput ? Number(throughSequenceInput) : undefined;
if (throughSequence !== undefined && (!Number.isInteger(throughSequence) || throughSequence < 1)) {
  throw new Error("LODESTA_RECONSTRUCT_THROUGH_SEQUENCE must be a positive event sequence integer.");
}

const repositoryRoot = resolve(process.cwd());
const outputDirectory = resolve(repositoryRoot, outputDirectoryInput);
const allowedRoot = resolve(repositoryRoot, ".design");
if (outputDirectory !== allowedRoot && !outputDirectory.startsWith(`${allowedRoot}${sep}`)) {
  throw new Error("The reconstruction output must stay under .design/.");
}

type WriteArguments = {
  path: string;
  content: string;
};

type ApplyPatchArguments = {
  files: WriteArguments[];
};

type TargetedEdit = {
  startLine: number;
  endLine: number;
  content: string | null;
};

type EditArguments = {
  path: string;
  expectedContentHash: string;
  edits: TargetedEdit[];
};

type ToolPayload = {
  arguments?: unknown;
  diagnosticResult?: {
    ok?: boolean;
    contentHash?: string;
    workspaceHash?: string;
  };
};

function sha256(content: string) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function assertWorkspacePath(path: string) {
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new Error(`Unsafe workspace path: ${path}`);
  }
}

function applyTargetedEdits(current: string, input: EditArguments) {
  const currentHash = sha256(current);
  if (currentHash !== input.expectedContentHash) {
    throw new Error(`Edit hash mismatch for ${input.path}: expected ${input.expectedContentHash}, found ${currentHash}.`);
  }

  const lines = current.split("\n");
  const edits = [...input.edits].sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
  let previousBoundary = 0;
  for (const edit of edits) {
    if (
      !Number.isInteger(edit.startLine)
      || !Number.isInteger(edit.endLine)
      || edit.startLine < 1
      || edit.startLine > lines.length + 1
      || edit.endLine > lines.length
      || edit.endLine < edit.startLine - 1
      || edit.startLine <= previousBoundary
      || (edit.endLine < edit.startLine && edit.content === null)
    ) {
      throw new Error(`Invalid retained targeted edit for ${input.path} at ${edit.startLine}:${edit.endLine}.`);
    }
    previousBoundary = Math.max(edit.startLine, edit.endLine);
  }

  const nextLines = [...lines];
  for (const edit of edits.reverse()) {
    const replacement = edit.content === null ? [] : edit.content.split("\n");
    nextLines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...replacement);
  }
  return nextLines.join("\n");
}

const run = await sitePlatformRepository.getAgentRun(runId);
if (!run) throw new Error(`Unknown site-agent run ${runId}.`);

const events = await sitePlatformRepository.listAgentRunEvents(runId, { limit: 5_000, order: "ascending" });
const retainedMutations = events.filter((event) => (
  event.kind === "tool_call"
  && (event.name === "apply_patch" || event.name === "write_file" || event.name === "edit_file")
  && event.status === "succeeded"
  && (throughSequence === undefined || event.sequence <= throughSequence)
));
const store = configuredArtifactBlobStore();
const files = new Map<string, string>();
let sourceProvenance: "retained_candidate_sidecar" | "replayed_mutations" = "replayed_mutations";
let retainedCandidateSourceHash: string | undefined;
if (throughSequence === undefined && run.candidateVersionId) {
  const candidateVersion = await sitePlatformRepository.getSiteVersion(run.candidateVersionId);
  if (!candidateVersion) throw new Error(`Candidate version ${run.candidateVersionId} is unavailable.`);
  const workspaceRevision = await sitePlatformRepository.getWorkspaceRevision(candidateVersion.workspaceRevisionId);
  if (!workspaceRevision) throw new Error(`Candidate workspace revision ${candidateVersion.workspaceRevisionId} is unavailable.`);
  const sidecarKey = workspaceSourceSidecarKey(workspaceRevision.sourceArchiveKey);
  const sidecarBlob = await store.get(sidecarKey);
  if (!sidecarBlob) throw new Error(`Candidate workspace sidecar is unavailable: ${sidecarKey}.`);
  const sidecar = workspaceSourceSidecarSchema.parse(JSON.parse(sidecarBlob.bytes.toString("utf8")));
  if (sidecar.archiveKey !== workspaceRevision.sourceArchiveKey || sidecar.sourceHash !== workspaceRevision.sourceHash) {
    throw new Error(`Candidate workspace sidecar does not match revision ${workspaceRevision.id}.`);
  }
  for (const file of sidecar.files) files.set(file.path, file.content);
  sourceProvenance = "retained_candidate_sidecar";
  retainedCandidateSourceHash = workspaceRevision.sourceHash;
} else if (run.kind === "initial_build") {
  const scaffoldSourceRoot = resolve(repositoryRoot, "workers/site-sandbox/scaffold/src");
  for (const relativePath of [
    "site.tsx",
    "styles.css"
  ]) {
    files.set(`src/${relativePath}`, await readFile(resolve(scaffoldSourceRoot, relativePath), "utf8"));
  }
  const buildInput = await sitePlatformRepository.getPublicBuildInput(run.publicBuildInputId);
  if (!buildInput) throw new Error(`Run ${run.id} has no retained public build input ${run.publicBuildInputId}.`);
  files.set("src/required-destinations.tsx", requiredDestinationsSource(buildInput));
  if (run.architecture) {
    const sourcePages = (await Promise.all(
      buildInput.sourceSnapshotIds.map((sourceId) => sitePlatformRepository.listSourceSnapshotPages(sourceId))
    )).flat();
    const authoringProfile = liveAuthoringProfile(run.authoringProfileId, run.kind);
    for (const file of createArchitectureEvidenceFiles(sourcePages, run.architecture.plan, {
      retainedContentMode: retainedContentModeForAuthoringProfile(authoringProfile)
    })) {
      files.set(file.path, file.content);
    }
  }
} else {
  if (!run.exactParentRevisionId) throw new Error(`Edit run ${run.id} has no exact parent revision.`);
  const parentRevision = await sitePlatformRepository.getWorkspaceRevision(run.exactParentRevisionId);
  if (!parentRevision || parentRevision.siteId !== run.siteId) {
    throw new Error(`Edit run ${run.id} has an unavailable or mismatched parent revision ${run.exactParentRevisionId}.`);
  }
  const sidecarKey = workspaceSourceSidecarKey(parentRevision.sourceArchiveKey);
  const sidecarBlob = await store.get(sidecarKey);
  if (!sidecarBlob) throw new Error(`Parent workspace sidecar is unavailable: ${sidecarKey}.`);
  const sidecar = workspaceSourceSidecarSchema.parse(JSON.parse(sidecarBlob.bytes.toString("utf8")));
  if (sidecar.archiveKey !== parentRevision.sourceArchiveKey || sidecar.sourceHash !== parentRevision.sourceHash) {
    throw new Error(`Parent workspace sidecar does not match revision ${parentRevision.id}.`);
  }
  for (const file of sidecar.files) files.set(file.path, file.content);
}
const replayedEvents: Array<{
  sequence: number;
  tool: string;
  path: string;
  contentHash: string;
  retainedWorkspaceHash?: string;
}> = [];

for (const event of sourceProvenance === "retained_candidate_sidecar" ? [] : retainedMutations) {
  if (!event.payloadRef) throw new Error(`Mutation event ${event.sequence} is missing its retained payload.`);
  const blob = await store.get(event.payloadRef);
  if (!blob) throw new Error(`Mutation payload ${event.payloadRef} is unavailable.`);
  const payload = JSON.parse(blob.bytes.toString("utf8")) as ToolPayload;
  if (payload.diagnosticResult?.ok !== true) {
    throw new Error(`Mutation event ${event.sequence} did not retain a successful diagnostic result.`);
  }

  if (event.name === "apply_patch") {
    const input = payload.arguments as ApplyPatchArguments;
    if (!Array.isArray(input.files) || input.files.length === 0) {
      throw new Error(`Malformed retained apply_patch arguments at event ${event.sequence}.`);
    }
    for (const file of input.files) {
      if (typeof file.path !== "string" || typeof file.content !== "string") {
        throw new Error(`Malformed retained apply_patch file at event ${event.sequence}.`);
      }
      assertWorkspacePath(file.path);
      files.set(file.path, file.content);
      replayedEvents.push({
        sequence: event.sequence,
        tool: event.name,
        path: file.path,
        contentHash: sha256(file.content),
        retainedWorkspaceHash: payload.diagnosticResult.workspaceHash
      });
    }
    continue;
  }

  let path: string;
  let content: string;
  if (event.name === "write_file") {
    const input = payload.arguments as WriteArguments;
    path = input.path;
    content = input.content;
    if (typeof path !== "string" || typeof content !== "string") {
      throw new Error(`Malformed retained write_file arguments at event ${event.sequence}.`);
    }
  } else {
    const input = payload.arguments as EditArguments;
    path = input.path;
    if (typeof path !== "string" || typeof input.expectedContentHash !== "string" || !Array.isArray(input.edits)) {
      throw new Error(`Malformed retained edit_file arguments at event ${event.sequence}.`);
    }
    const current = files.get(path);
    if (current === undefined) throw new Error(`Retained edit targets missing file ${path} at event ${event.sequence}.`);
    content = applyTargetedEdits(current, input);
  }

  assertWorkspacePath(path);
  const contentHash = sha256(content);
  if (contentHash !== payload.diagnosticResult.contentHash) {
    throw new Error(
      `Replayed content hash mismatch at event ${event.sequence}: retained ${payload.diagnosticResult.contentHash}, reconstructed ${contentHash}.`
    );
  }
  files.set(path, content);
  replayedEvents.push({
    sequence: event.sequence,
    tool: event.name,
    path,
    contentHash,
    retainedWorkspaceHash: payload.diagnosticResult.workspaceHash
  });
}

for (const [path, content] of files) {
  const destination = resolve(outputDirectory, "workspace", path);
  if (!destination.startsWith(`${resolve(outputDirectory, "workspace")}${sep}`)) {
    throw new Error(`Unsafe reconstruction destination for ${path}.`);
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

const manifest = {
  schemaVersion: 1,
  reconstructedAt: new Date().toISOString(),
  runId,
  siteId: run.siteId,
  sessionId: run.sessionId,
  authoringProfileId: run.authoringProfileId,
  status: run.status,
  throughSequence,
  exactParentRevisionId: run.exactParentRevisionId,
  sourceProvenance,
  finalWorkspaceHash: retainedCandidateSourceHash ?? replayedEvents.at(-1)?.retainedWorkspaceHash,
  files: [...files].map(([path, content]) => ({ path, contentHash: sha256(content), bytes: Buffer.byteLength(content) })),
  replayedEvents
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "reconstruction-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  runId,
  outputDirectory,
  throughSequence,
  mutationEvents: replayedEvents.length,
  files: manifest.files,
  finalWorkspaceHash: manifest.finalWorkspaceHash
}));
