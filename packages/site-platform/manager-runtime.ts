import { sha256, stableJson } from "@/packages/business-data";
import {
  assertCompleteWorkspace,
  isSiteAuthoringTerminalError,
  managerCompletionSchema,
  workspaceSourceFileSchema,
  type ManagerRunRequest,
  type ManagerToolCall,
  type ManagerToolExecution,
  type ManagerToolRuntime,
  type WorkspaceSourceFile
} from "@/packages/site-agent";

type BuildResult = {
  revision: string;
  buildDurationMs: number;
  previewPath: string;
  placementId?: string;
};

export type RuntimeInspection<Checkpoint> = {
  passed: boolean;
  inspectionHash: `sha256:${string}`;
  modelSummary: Record<string, unknown>;
  diagnosticSummary: Record<string, unknown>;
  images?: Array<{ type: "input_image"; image_url: string; detail: "high" | "low" }>;
  checkpoint?: Checkpoint;
};

/**
 * A deliberately small workspace runtime. The model owns ordinary source files;
 * this class only provides filesystem operations plus the build/release boundary.
 */
export class WorkspaceManagerRuntime<Checkpoint> implements ManagerToolRuntime {
  private files = new Map<string, string>();
  private workspaceHash?: `sha256:${string}`;
  private sandboxRevision: string;
  private successfulBuild?: { workspaceHash: `sha256:${string}`; sandboxRevision: string; result: BuildResult };
  private inspection?: RuntimeInspection<Checkpoint>;
  private builds = 0;
  private inspections = 0;
  private readCalls = 0;
  private readBytes = 0;
  private readLines = 0;
  private mutatedWorkspace = false;

  constructor(private readonly options: {
    kind: ManagerRunRequest["kind"];
    publicBuildInputId: string;
    toolchainVersion: string;
    sandboxImageDigest: `sha256:${string}`;
    initialFiles?: WorkspaceSourceFile[];
    initialSandboxRevision: string;
    applyBuild(files: WorkspaceSourceFile[], expectedRevision: string): Promise<BuildResult>;
    inspect(files: WorkspaceSourceFile[], sandboxRevision: string): Promise<RuntimeInspection<Checkpoint>>;
    retainDiagnostic?(kind: string, content: string): Promise<{ key: string; contentHash: `sha256:${string}`; bytes: number }>;
  }) {
    this.sandboxRevision = options.initialSandboxRevision;
    for (const file of options.initialFiles ?? []) this.files.set(file.path, file.content);
    this.refreshWorkspaceHash();
  }

  async execute(call: ManagerToolCall): Promise<ManagerToolExecution> {
    switch (call.name) {
      case "list_files": return this.list();
      case "read_file": return this.read(call.arguments);
      case "write_file": return this.write(call.arguments);
      case "delete_file": return this.delete(call.arguments);
      case "apply_patch": return this.patch(call.arguments);
      case "build_preview": return this.build();
      case "inspect_site": return this.inspect();
      case "request_input": return this.requestInput(call.arguments);
      case "finish": return this.finish(call.arguments);
    }
  }

  finalCheckpoint() {
    if (!this.inspection?.passed || !this.inspection.checkpoint) throw new Error("manager_finished_without_passing_checkpoint");
    return this.inspection.checkpoint;
  }

  currentFiles(): WorkspaceSourceFile[] {
    return [...this.files.entries()]
      .map(([path, content]) => workspaceSourceFileSchema.parse({ path, content }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  metrics() {
    return { builds: this.builds, inspections: this.inspections, readCalls: this.readCalls, readBytes: this.readBytes, readLines: this.readLines };
  }

  stateSummary() {
    return {
      workspace: {
        hash: this.workspaceHash,
        sandboxRevision: this.sandboxRevision,
        files: this.currentFiles().map((file) => ({
          path: file.path,
          contentHash: sha256(file.content),
          lines: file.content.split("\n").length,
          outline: sourceOutline(file)
        }))
      },
      latestBuild: this.successfulBuild && this.successfulBuild.workspaceHash === this.workspaceHash
        ? { status: "passed", workspaceHash: this.successfulBuild.workspaceHash, sandboxRevision: this.successfulBuild.sandboxRevision, previewPath: this.successfulBuild.result.previewPath }
        : { status: "not_run_or_stale" },
      latestInspection: this.inspection
        ? { status: this.inspection.passed ? "passed" : "failed", inspectionHash: this.inspection.inspectionHash, findings: summaryFindings(this.inspection.modelSummary) }
        : { status: "not_run_or_stale" }
    };
  }

  private list(): ManagerToolExecution {
    return result({
      ok: true,
      workspaceHash: this.workspaceHash,
      files: this.currentFiles().map((file) => ({ path: file.path, contentHash: sha256(file.content), bytes: Buffer.byteLength(file.content), lines: file.content.split("\n").length }))
    });
  }

  private read(args: Record<string, unknown>): ManagerToolExecution {
    this.readCalls += 1;
    const path = String(args.path ?? "");
    const content = this.files.get(path);
    if (content === undefined) return result({ ok: false, error: "workspace_file_missing", path });
    const lines = content.split("\n");
    const start = Math.max(1, Number(args.startLine ?? 1));
    const end = Math.min(lines.length, Number(args.endLine ?? Math.min(lines.length, start + 399)));
    if (end < start) return result({ ok: false, error: "invalid_line_window", path, startLine: start, endLine: end });
    const selected = lines.slice(start - 1, end).join("\n");
    const bytes = Buffer.byteLength(selected);
    const lineCount = end - start + 1;
    this.readBytes += bytes;
    this.readLines += lineCount;
    return {
      modelOutput: JSON.stringify({ ok: true, path, contentHash: sha256(content), startLine: start, endLine: end, totalLines: lines.length, content: selected }),
      diagnosticOutput: { ok: true, path, contentHash: sha256(content), startLine: start, endLine: end, totalLines: lines.length, bytes }
    };
  }

  private write(args: Record<string, unknown>): ManagerToolExecution {
    const file = workspaceSourceFileSchema.parse({ path: args.path, content: args.content });
    this.files.set(file.path, file.content);
    this.mutated();
    return result({ ok: true, path: file.path, contentHash: sha256(file.content), workspaceHash: this.workspaceHash });
  }

  private delete(args: Record<string, unknown>): ManagerToolExecution {
    const path = workspaceSourceFileSchema.shape.path.parse(args.path);
    const existed = this.files.delete(path);
    if (existed) this.mutated();
    return result({ ok: true, path, deleted: existed, workspaceHash: this.workspaceHash });
  }

  private patch(args: Record<string, unknown>): ManagerToolExecution {
    const changes = args.files as Array<{ path: string; content: string | null }>;
    const next = new Map(this.files);
    const paths = new Set<string>();
    for (const change of changes) {
      if (paths.has(change.path)) return result({ ok: false, error: "patch_file_duplicated", path: change.path });
      paths.add(change.path);
      const path = workspaceSourceFileSchema.shape.path.parse(change.path);
      if (change.content === null) next.delete(path);
      else next.set(path, workspaceSourceFileSchema.shape.content.parse(change.content));
    }
    this.files = next;
    this.mutated();
    return result({ ok: true, changedFiles: [...paths], workspaceHash: this.workspaceHash });
  }

  private async build(): Promise<ManagerToolExecution> {
    if (!this.workspaceHash) return result({ ok: false, error: "workspace_empty" });
    if (this.successfulBuild?.workspaceHash === this.workspaceHash) {
      return result({ ok: true, cached: true, workspaceHash: this.workspaceHash, sandboxRevision: this.successfulBuild.sandboxRevision, previewPath: this.successfulBuild.result.previewPath, buildDurationMs: 0 });
    }
    const files = assertCompleteWorkspace(this.currentFiles());
    this.builds += 1;
    try {
      const built = await this.options.applyBuild(files, this.sandboxRevision);
      this.sandboxRevision = built.revision;
      this.successfulBuild = { workspaceHash: this.workspaceHash, sandboxRevision: built.revision, result: built };
      this.inspection = undefined;
      return result({ ok: true, cached: false, workspaceHash: this.workspaceHash, sandboxRevision: built.revision, previewPath: built.previewPath, buildDurationMs: built.buildDurationMs, placementId: built.placementId });
    } catch (error) {
      if (isSiteAuthoringTerminalError(error)) throw error;
      const diagnostic = boundedError(error);
      const retained = await this.options.retainDiagnostic?.("build_failure", diagnostic);
      return {
        modelOutput: JSON.stringify({ ok: false, error: diagnostic, diagnostic: retained, workspaceHash: this.workspaceHash, sandboxRevision: this.sandboxRevision }),
        diagnosticOutput: { ok: false, error: "build_failed", diagnostic: retained, workspaceHash: this.workspaceHash, sandboxRevision: this.sandboxRevision }
      };
    }
  }

  private async inspect(): Promise<ManagerToolExecution> {
    if (!this.workspaceHash || !this.successfulBuild || this.successfulBuild.workspaceHash !== this.workspaceHash) {
      return result({ ok: false, error: "inspection_requires_current_successful_build", workspaceHash: this.workspaceHash });
    }
    if (!this.inspection) {
      this.inspections += 1;
      this.inspection = await this.options.inspect(this.currentFiles(), this.sandboxRevision);
    }
    return inspectionResult(this.inspection, this.inspections > 1);
  }

  private async finish(args: Record<string, unknown>): Promise<ManagerToolExecution> {
    if (!this.workspaceHash || !this.successfulBuild || this.successfulBuild.workspaceHash !== this.workspaceHash) {
      return result({ ok: false, error: "finish_requires_current_successful_build" });
    }
    if (!this.inspection) {
      this.inspections += 1;
      this.inspection = await this.options.inspect(this.currentFiles(), this.sandboxRevision);
    }
    if (!this.inspection.passed || !this.inspection.checkpoint) {
      return inspectionResult(this.inspection, false, "finish_verification_failed");
    }
    const completion = managerCompletionSchema.parse({
      schemaVersion: "manager-completion",
      ownerMessage: args.ownerMessage,
      workspaceHash: this.workspaceHash,
      sandboxRevision: this.sandboxRevision,
      publicBuildInputId: this.options.publicBuildInputId,
      toolchainVersion: this.options.toolchainVersion,
      sandboxImageDigest: this.options.sandboxImageDigest,
      inspectionHash: this.inspection.inspectionHash
    });
    return { modelOutput: JSON.stringify({ ok: true, completed: true }), diagnosticOutput: { ok: true, completed: true, workspaceHash: this.workspaceHash, inspectionHash: this.inspection.inspectionHash }, completion };
  }

  private requestInput(args: Record<string, unknown>): ManagerToolExecution {
    const question = String(args.question ?? "").trim();
    if (this.mutatedWorkspace) return result({ ok: false, error: "input_can_only_be_requested_before_workspace_mutation", guidance: "Complete conservatively with verified evidence, omit the ambiguous claim, and mention the open question in the owner message." });
    return { modelOutput: JSON.stringify({ ok: true, needsInput: true, question }), diagnosticOutput: { ok: true, needsInput: true }, needsInput: { question } };
  }

  private mutated() {
    this.mutatedWorkspace = true;
    this.refreshWorkspaceHash();
    this.successfulBuild = undefined;
    this.inspection = undefined;
  }

  private refreshWorkspaceHash() {
    this.workspaceHash = this.files.size ? sha256(stableJson(this.currentFiles())) : undefined;
  }
}

function inspectionResult<Checkpoint>(inspection: RuntimeInspection<Checkpoint>, cached: boolean, error?: string): ManagerToolExecution {
  const summary = { ...compactInspectionSummary(inspection.modelSummary), ok: inspection.passed, cached, ...(error ? { error } : {}) };
  return {
    modelOutput: inspection.images?.length ? [{ type: "input_text", text: JSON.stringify(summary) }, ...inspection.images] : JSON.stringify(summary),
    diagnosticOutput: { ...inspection.diagnosticSummary, ok: inspection.passed, cached, ...(error ? { error } : {}) }
  };
}

function sourceOutline(file: WorkspaceSourceFile) {
  const patterns = file.path.endsWith(".css") ? /^([^@][^{]{0,120})\{/ : /^(?:export\s+)?(?:const|function|class|interface|type)\s+([A-Za-z0-9_$-]+)/;
  return file.content.split("\n").flatMap((line, index) => {
    const match = line.trim().match(patterns);
    return match ? [{ line: index + 1, label: match[1].trim().slice(0, 120) }] : [];
  }).slice(0, 80);
}

function summaryFindings(summary: Record<string, unknown>) {
  return (Array.isArray(summary.blockers) ? summary.blockers : []).slice(0, 100);
}

function compactInspectionSummary(summary: Record<string, unknown>) {
  const findings = Array.isArray(summary.findings) ? summary.findings : [];
  const blockers = Array.isArray(summary.blockers) ? summary.blockers : [];
  const advisories = Array.isArray(summary.advisories) ? summary.advisories : [];
  const { findings: _findings, blockers: _blockers, advisories: _advisories, ...rest } = summary;
  return {
    ...rest,
    findingCount: numericCount(summary.findingCount, findings.length),
    blockerCount: numericCount(summary.blockerCount, blockers.length),
    advisoryCount: numericCount(summary.advisoryCount, advisories.length),
    blockers: blockers.slice(0, 100),
    advisories: advisories.slice(0, 8),
    advisoriesTruncated: numericCount(summary.advisoryCount, advisories.length) > 8
  };
}

function numericCount(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function result(value: Record<string, unknown>): ManagerToolExecution {
  return { modelOutput: JSON.stringify(value), diagnosticOutput: value };
}

function boundedError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.length > 12_000 ? `${value.slice(-11_980)}... [truncated]` : value;
}
