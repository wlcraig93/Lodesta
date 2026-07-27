import { sha256, stableJson } from "@/packages/business-data";
import {
  assertCompleteWorkspace,
  isSiteAuthoringTerminalError,
  managerCompletionSchema,
  managerToolArguments,
  workspaceSourceFileSchema,
  type ManagerRunRequest,
  type ManagerToolCall,
  type ManagerToolExecution,
  type ManagerToolRuntime,
  type WorkspaceSourceFile
} from "@/packages/site-agent";
import {
  deduplicateVerificationFindings,
  verificationBlockerFeedback
} from "./verification-feedback";

export type BuildResult = {
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

export type RuntimeVisualInspection = {
  inspectionHash: `sha256:${string}`;
  modelSummary: Record<string, unknown>;
  diagnosticSummary: Record<string, unknown>;
  images?: Array<{ type: "input_image"; image_url: string; detail: "high" | "low" }>;
};

export type WorkspaceManagerRuntimeSnapshot<Checkpoint> = {
  schemaVersion: 1;
  files: WorkspaceSourceFile[];
  workspaceHash?: `sha256:${string}`;
  sandboxRevision: string;
  successfulBuild?: { workspaceHash: `sha256:${string}`; sandboxRevision: string; result: BuildResult };
  lastSuccessfulBuild?: {
    workspaceHash: `sha256:${string}`;
    sandboxRevision: string;
    result: BuildResult;
    files: WorkspaceSourceFile[];
  };
  failedBuild?: {
    workspaceHash: `sha256:${string}`;
    sandboxRevision: string;
    error: string;
    diagnostic?: { key: string; contentHash: `sha256:${string}`; bytes: number };
    failureFingerprint: `sha256:${string}`;
  };
  inspection?: RuntimeInspection<Checkpoint>;
  visualInspection?: RuntimeVisualInspection;
  metrics: { builds: number; inspections: number; readCalls: number; readBytes: number; readLines: number };
  mutatedWorkspace: boolean;
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
  private lastSuccessfulBuild?: WorkspaceManagerRuntimeSnapshot<Checkpoint>["lastSuccessfulBuild"];
  private failedBuild?: WorkspaceManagerRuntimeSnapshot<Checkpoint>["failedBuild"];
  private inspection?: RuntimeInspection<Checkpoint>;
  private visualInspection?: RuntimeVisualInspection;
  private builds = 0;
  private inspections = 0;
  private readCalls = 0;
  private readBytes = 0;
  private readLines = 0;
  private mutatedWorkspace = false;

  constructor(private readonly options: {
    kind: ManagerRunRequest["kind"];
    publicBuildInputId: string;
    getPublicBuildInputId?(): string;
    toolchainVersion: string;
    sandboxImageDigest: `sha256:${string}`;
    initialFiles?: WorkspaceSourceFile[];
    initialSandboxRevision: string;
    initialSnapshot?: WorkspaceManagerRuntimeSnapshot<Checkpoint>;
    applyBuild(files: WorkspaceSourceFile[], expectedRevision: string): Promise<BuildResult>;
    inspect(files: WorkspaceSourceFile[], sandboxRevision: string): Promise<RuntimeInspection<Checkpoint>>;
    inspectVisual?(files: WorkspaceSourceFile[], sandboxRevision: string): Promise<RuntimeVisualInspection>;
    createImage?(args: Record<string, unknown>): Promise<ManagerToolExecution>;
    retainDiagnostic?(kind: string, content: string): Promise<{ key: string; contentHash: `sha256:${string}`; bytes: number }>;
  }) {
    const snapshot = options.initialSnapshot;
    this.sandboxRevision = snapshot?.sandboxRevision ?? options.initialSandboxRevision;
    for (const file of snapshot?.files ?? options.initialFiles ?? []) this.files.set(file.path, file.content);
    if (snapshot) {
      this.workspaceHash = snapshot.workspaceHash;
      this.successfulBuild = snapshot.successfulBuild;
      this.lastSuccessfulBuild = snapshot.lastSuccessfulBuild;
      this.failedBuild = snapshot.failedBuild;
      this.inspection = snapshot.inspection;
      this.visualInspection = snapshot.visualInspection;
      this.builds = snapshot.metrics.builds;
      this.inspections = snapshot.metrics.inspections;
      this.readCalls = snapshot.metrics.readCalls;
      this.readBytes = snapshot.metrics.readBytes;
      this.readLines = snapshot.metrics.readLines;
      this.mutatedWorkspace = snapshot.mutatedWorkspace;
    } else {
      this.refreshWorkspaceHash();
    }
  }

  async execute(call: ManagerToolCall): Promise<ManagerToolExecution> {
    switch (call.name) {
      case "list_files": return this.list();
      case "search_files": return this.search(call.arguments);
      case "read_files": return this.read(call.arguments);
      case "write_file": return this.write(call.arguments);
      case "delete_file": return this.delete(call.arguments);
      case "apply_patch": return this.patch(call.arguments);
      case "edit_file": return this.edit(call.arguments);
      case "create_image": {
        if (!this.options.createImage) return result({ ok: false, error: "image_generation_unavailable" });
        const created = await this.options.createImage(call.arguments);
        if (created.diagnosticOutput.ok !== false) {
          this.successfulBuild = undefined;
          this.failedBuild = undefined;
          this.inspection = undefined;
          this.visualInspection = undefined;
        }
        return created;
      }
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

  hasAssessableBuild() {
    return Boolean(this.successfulBuild || this.lastSuccessfulBuild);
  }

  restoreLastSuccessfulBuild() {
    if (!this.lastSuccessfulBuild) return false;
    this.files = new Map(this.lastSuccessfulBuild.files.map((file) => [file.path, file.content]));
    this.workspaceHash = this.lastSuccessfulBuild.workspaceHash;
    this.sandboxRevision = this.lastSuccessfulBuild.sandboxRevision;
    this.successfulBuild = {
      workspaceHash: this.lastSuccessfulBuild.workspaceHash,
      sandboxRevision: this.lastSuccessfulBuild.sandboxRevision,
      result: structuredClone(this.lastSuccessfulBuild.result)
    };
    this.failedBuild = undefined;
    this.inspection = undefined;
    this.visualInspection = undefined;
    return true;
  }

  currentFiles(): WorkspaceSourceFile[] {
    return [...this.files.entries()]
      .map(([path, content]) => workspaceSourceFileSchema.parse({ path, content }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  metrics() {
    return { builds: this.builds, inspections: this.inspections, readCalls: this.readCalls, readBytes: this.readBytes, readLines: this.readLines };
  }

  snapshot(): WorkspaceManagerRuntimeSnapshot<Checkpoint> {
    return {
      schemaVersion: 1,
      files: this.currentFiles(),
      workspaceHash: this.workspaceHash,
      sandboxRevision: this.sandboxRevision,
      successfulBuild: this.successfulBuild ? structuredClone(this.successfulBuild) : undefined,
      lastSuccessfulBuild: this.lastSuccessfulBuild ? structuredClone(this.lastSuccessfulBuild) : undefined,
      failedBuild: this.failedBuild ? structuredClone(this.failedBuild) : undefined,
      inspection: this.inspection ? structuredClone(this.inspection) : undefined,
      visualInspection: this.visualInspection ? structuredClone(this.visualInspection) : undefined,
      metrics: this.metrics(),
      mutatedWorkspace: this.mutatedWorkspace
    };
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
        : this.failedBuild && this.failedBuild.workspaceHash === this.workspaceHash
          ? { status: "failed", workspaceHash: this.failedBuild.workspaceHash, sandboxRevision: this.failedBuild.sandboxRevision, failureFingerprint: this.failedBuild.failureFingerprint }
        : { status: "not_run_or_stale" },
      latestInspection: this.inspection
        ? { status: this.inspection.passed ? "passed" : "failed", inspectionHash: this.inspection.inspectionHash, findings: summaryFindings(this.inspection.modelSummary) }
        : { status: "not_run_or_stale" },
      latestVisualInspection: this.visualInspection
        ? { status: "available", inspectionHash: this.visualInspection.inspectionHash }
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

  private search(args: Record<string, unknown>): ManagerToolExecution {
    const parsed = managerToolArguments.search_files.parse(args);
    const query = parsed.caseSensitive ? parsed.query : parsed.query.toLocaleLowerCase();
    const selected = parsed.paths.length
      ? parsed.paths.map((path) => [path, this.files.get(path)] as const)
      : [...this.files.entries()];
    const matches: Array<{ path: string; line: number; content: string }> = [];
    const missingPaths: string[] = [];
    let truncated = false;
    for (const [path, content] of selected.sort(([left], [right]) => left.localeCompare(right))) {
      if (content === undefined) {
        missingPaths.push(path);
        continue;
      }
      for (const [index, line] of content.split("\n").entries()) {
        const candidate = parsed.caseSensitive ? line : line.toLocaleLowerCase();
        if (!candidate.includes(query)) continue;
        if (matches.length >= 200) {
          truncated = true;
          break;
        }
        matches.push({ path, line: index + 1, content: line.slice(0, 2_000) });
      }
      if (truncated) break;
    }
    return result({
      ok: missingPaths.length === 0,
      query: parsed.query,
      matches,
      matchCount: matches.length,
      truncated,
      missingPaths
    });
  }

  private read(args: Record<string, unknown>): ManagerToolExecution {
    this.readCalls += 1;
    const requested = managerToolArguments.read_files.parse(args).files;
    const files = requested.map((request) => {
      const content = this.files.get(request.path);
      if (content === undefined) return { ok: false as const, error: "workspace_file_missing", path: request.path };
      const lines = content.split("\n");
      const start = request.startLine ?? 1;
      const end = Math.min(lines.length, request.endLine ?? Math.min(lines.length, start + 399));
      if (start > lines.length || end < start) {
        return { ok: false as const, error: "invalid_line_window", path: request.path, startLine: start, endLine: end, totalLines: lines.length };
      }
      const selected = lines.slice(start - 1, end).join("\n");
      const bytes = Buffer.byteLength(selected);
      const lineCount = end - start + 1;
      this.readBytes += bytes;
      this.readLines += lineCount;
      return {
        ok: true as const,
        path: request.path,
        contentHash: sha256(content),
        startLine: start,
        endLine: end,
        totalLines: lines.length,
        bytes,
        lines: lines.slice(start - 1, end).map((line, index) => ({
          line: start + index,
          content: line
        }))
      };
    });
    const diagnosticFiles = files.map(({ lines: _lines, ...file }) => file);
    return {
      modelOutput: JSON.stringify({ ok: files.every((file) => file.ok), files }),
      diagnosticOutput: { ok: files.every((file) => file.ok), files: diagnosticFiles }
    };
  }

  private write(args: Record<string, unknown>): ManagerToolExecution {
    const file = workspaceSourceFileSchema.parse({ path: args.path, content: args.content });
    if (this.files.get(file.path) === file.content) {
      return result({ ok: true, unchanged: true, path: file.path, contentHash: sha256(file.content), workspaceHash: this.workspaceHash });
    }
    this.files.set(file.path, file.content);
    this.mutated();
    return result({ ok: true, path: file.path, contentHash: sha256(file.content), workspaceHash: this.workspaceHash });
  }

  private delete(args: Record<string, unknown>): ManagerToolExecution {
    const path = workspaceSourceFileSchema.shape.path.parse(args.path);
    const existed = this.files.delete(path);
    if (existed) this.mutated();
    return result({ ok: true, unchanged: !existed, path, deleted: existed, workspaceHash: this.workspaceHash });
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
    const changedFiles = [...paths].filter((path) => this.files.get(path) !== next.get(path));
    if (changedFiles.length) {
      this.files = next;
      this.mutated();
    }
    return result({ ok: true, unchanged: changedFiles.length === 0, changedFiles, workspaceHash: this.workspaceHash });
  }

  private edit(args: Record<string, unknown>): ManagerToolExecution {
    const parsed = managerToolArguments.edit_file.parse(args);
    const current = this.files.get(parsed.path);
    if (current === undefined) return result({ ok: false, error: "workspace_file_missing", path: parsed.path });
    const currentHash = sha256(current);
    if (currentHash !== parsed.expectedContentHash) {
      return result({
        ok: false,
        error: "workspace_file_changed",
        path: parsed.path,
        expectedContentHash: parsed.expectedContentHash,
        actualContentHash: currentHash
      });
    }
    const lines = current.split("\n");
    const edits = [...parsed.edits].sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
    let previousBoundary = 0;
    for (const edit of edits) {
      if (
        edit.startLine > lines.length + 1
        || edit.endLine > lines.length
        || edit.endLine < edit.startLine - 1
        || edit.startLine <= previousBoundary
        || (edit.endLine < edit.startLine && edit.content === null)
      ) {
        return result({
          ok: false,
          error: "invalid_targeted_edit",
          path: parsed.path,
          startLine: edit.startLine,
          endLine: edit.endLine,
          totalLines: lines.length
        });
      }
      previousBoundary = Math.max(edit.startLine, edit.endLine);
    }
    const nextLines = [...lines];
    for (const edit of edits.reverse()) {
      const replacement = edit.content === null ? [] : edit.content.split("\n");
      nextLines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...replacement);
    }
    const nextContent = workspaceSourceFileSchema.shape.content.parse(nextLines.join("\n"));
    if (nextContent === current) {
      return result({ ok: true, unchanged: true, path: parsed.path, contentHash: currentHash, workspaceHash: this.workspaceHash });
    }
    this.files.set(parsed.path, nextContent);
    this.mutated();
    return result({
      ok: true,
      unchanged: false,
      path: parsed.path,
      previousContentHash: currentHash,
      contentHash: sha256(nextContent),
      editCount: parsed.edits.length,
      workspaceHash: this.workspaceHash
    });
  }

  private async build(): Promise<ManagerToolExecution> {
    if (!this.workspaceHash) return result({ ok: false, error: "workspace_empty" });
    if (this.successfulBuild?.workspaceHash === this.workspaceHash) {
      return result({ ok: true, cached: true, workspaceHash: this.workspaceHash, sandboxRevision: this.successfulBuild.sandboxRevision, previewPath: this.successfulBuild.result.previewPath, buildDurationMs: 0 });
    }
    if (this.failedBuild?.workspaceHash === this.workspaceHash) {
      return failedBuildResult(this.failedBuild, true);
    }
    this.builds += 1;
    try {
      const files = assertCompleteWorkspace(this.currentFiles());
      const built = await this.options.applyBuild(files, this.sandboxRevision);
      this.sandboxRevision = built.revision;
      this.successfulBuild = { workspaceHash: this.workspaceHash, sandboxRevision: built.revision, result: built };
      this.lastSuccessfulBuild = {
        workspaceHash: this.workspaceHash,
        sandboxRevision: built.revision,
        result: structuredClone(built),
        files: this.currentFiles()
      };
      this.failedBuild = undefined;
      this.inspection = undefined;
      this.visualInspection = undefined;
      return result({ ok: true, cached: false, workspaceHash: this.workspaceHash, sandboxRevision: built.revision, previewPath: built.previewPath, buildDurationMs: built.buildDurationMs, placementId: built.placementId });
    } catch (error) {
      if (isSiteAuthoringTerminalError(error)) throw error;
      const diagnostic = boundedError(error);
      const retained = await this.options.retainDiagnostic?.("build_failure", diagnostic);
      this.failedBuild = {
        workspaceHash: this.workspaceHash,
        sandboxRevision: this.sandboxRevision,
        error: diagnostic,
        diagnostic: retained,
        failureFingerprint: sha256(stableJson({
          workspaceHash: this.workspaceHash,
          error: diagnostic
        }))
      };
      return failedBuildResult(this.failedBuild, false);
    }
  }

  private async inspect(): Promise<ManagerToolExecution> {
    if (!this.workspaceHash || !this.successfulBuild || this.successfulBuild.workspaceHash !== this.workspaceHash) {
      return result({ ok: false, error: "inspection_requires_current_successful_build", workspaceHash: this.workspaceHash });
    }
    if (!this.options.inspectVisual) {
      return result({ ok: false, error: "visual_inspection_unavailable" });
    }
    const cached = Boolean(this.visualInspection);
    if (!this.visualInspection) {
      this.inspections += 1;
      this.visualInspection = await this.options.inspectVisual(this.currentFiles(), this.sandboxRevision);
    }
    return visualInspectionResult(this.visualInspection, cached);
  }

  private async finish(args: Record<string, unknown>): Promise<ManagerToolExecution> {
    let buildPerformed = false;
    if (!this.workspaceHash || !this.successfulBuild || this.successfulBuild.workspaceHash !== this.workspaceHash) {
      const built = await this.build();
      if (built.diagnosticOutput.ok === false) return withFailureStage(built, "compilation", { buildPerformed: true });
      buildPerformed = true;
    }
    const cached = Boolean(this.inspection);
    if (!this.inspection) {
      this.inspections += 1;
      this.inspection = await this.options.inspect(this.currentFiles(), this.sandboxRevision);
      this.inspection.diagnosticSummary = {
        ...this.inspection.diagnosticSummary,
        verificationTimings: {
          compilationMs: this.successfulBuild?.result.buildDurationMs ?? 0,
          ...recordValue(this.inspection.diagnosticSummary.verificationTimings)
        }
      };
    }
    if (!this.inspection.passed || !this.inspection.checkpoint) {
      return withFailureStage(
        inspectionResult(this.inspection, cached, "finish_verification_failed"),
        "verification",
        { buildPerformed }
      );
    }
    const completion = managerCompletionSchema.parse({
      schemaVersion: "manager-completion",
      ownerMessage: args.ownerMessage,
      workspaceHash: this.workspaceHash,
      sandboxRevision: this.sandboxRevision,
      publicBuildInputId: this.options.getPublicBuildInputId?.() ?? this.options.publicBuildInputId,
      toolchainVersion: this.options.toolchainVersion,
      sandboxImageDigest: this.options.sandboxImageDigest,
      inspectionHash: this.inspection.inspectionHash
    });
    return {
      modelOutput: JSON.stringify({ ok: true, completed: true, buildPerformed }),
      diagnosticOutput: { ok: true, completed: true, buildPerformed, workspaceHash: this.workspaceHash, inspectionHash: this.inspection.inspectionHash },
      completion
    };
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
    this.failedBuild = undefined;
    this.inspection = undefined;
    this.visualInspection = undefined;
  }

  private refreshWorkspaceHash() {
    this.workspaceHash = this.files.size ? sha256(stableJson(this.currentFiles())) : undefined;
  }
}

function visualInspectionResult(inspection: RuntimeVisualInspection, cached: boolean): ManagerToolExecution {
  const summary = { ...inspection.modelSummary, ok: true, cached, visualOnly: true };
  return {
    modelOutput: inspection.images?.length
      ? [{ type: "input_text", text: JSON.stringify(summary) }, ...inspection.images]
      : JSON.stringify(summary),
    diagnosticOutput: {
      ...inspection.diagnosticSummary,
      ok: true,
      cached,
      visualOnly: true
    }
  };
}

function withFailureStage(
  execution: ManagerToolExecution,
  failureStage: "compilation" | "verification",
  details: Record<string, unknown> = {}
): ManagerToolExecution {
  const modelValue = typeof execution.modelOutput === "string"
    ? parseObject(execution.modelOutput)
    : undefined;
  return {
    ...execution,
    modelOutput: modelValue
      ? JSON.stringify({ ...modelValue, failureStage, ...details })
      : execution.modelOutput,
    diagnosticOutput: { ...execution.diagnosticOutput, failureStage, ...details }
  };
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function inspectionResult<Checkpoint>(inspection: RuntimeInspection<Checkpoint>, cached: boolean, error?: string): ManagerToolExecution {
  const guidance = !inspection.passed
    ? "Edit every affected occurrence of each grouped root cause before running the release check again. When one cause spans routes or modules, prefer one coherent apply_patch or file rewrite."
    : undefined;
  const compactSummary = compactInspectionSummary(inspection.modelSummary);
  const summary = {
    ...compactSummary,
    ok: inspection.passed,
    cached,
    ...(error ? { error } : {}),
    ...(guidance ? { guidance } : {})
  };
  const failureFingerprint = inspection.passed
    ? undefined
    : sha256(stableJson({
        error: error ?? "release_verification_failed",
        blockers: compactSummary.blockers
      }));
  const includeImages = !inspection.passed && hasVisualBlocker(inspection.modelSummary);
  return {
    modelOutput: includeImages && inspection.images?.length ? [{ type: "input_text", text: JSON.stringify(summary) }, ...inspection.images] : JSON.stringify(summary),
    diagnosticOutput: {
      ...inspection.diagnosticSummary,
      ok: inspection.passed,
      cached,
      ...(failureFingerprint ? { failureFingerprint } : {}),
      ...(error ? { error } : {}),
      ...(guidance ? { guidance } : {})
    }
  };
}

function failedBuildResult(
  failed: NonNullable<WorkspaceManagerRuntimeSnapshot<unknown>["failedBuild"]>,
  cached: boolean
): ManagerToolExecution {
  const guidance = "Edit the workspace source before running build_preview again.";
  return {
    modelOutput: JSON.stringify({
      ok: false,
      error: failed.error,
      diagnostic: failed.diagnostic,
      workspaceHash: failed.workspaceHash,
      sandboxRevision: failed.sandboxRevision,
      failureFingerprint: failed.failureFingerprint,
      cached,
      guidance
    }),
    diagnosticOutput: {
      ok: false,
      error: "build_failed",
      diagnostic: failed.diagnostic,
      workspaceHash: failed.workspaceHash,
      sandboxRevision: failed.sandboxRevision,
      failureFingerprint: failed.failureFingerprint,
      cached,
      guidance
    }
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
  return verificationBlockerFeedback(Array.isArray(summary.blockers) ? summary.blockers : []).blockers;
}

function compactInspectionSummary(summary: Record<string, unknown>) {
  const findings = Array.isArray(summary.findings) ? summary.findings : [];
  const blockerFeedback = verificationBlockerFeedback(Array.isArray(summary.blockers) ? summary.blockers : []);
  const blockers = blockerFeedback.blockers;
  const advisories = deduplicateVerificationFindings(Array.isArray(summary.advisories) ? summary.advisories : []);
  const { findings: _findings, blockers: _blockers, advisories: _advisories, ...rest } = summary;
  const common = {
    ...rest,
    findingCount: numericCount(summary.findingCount, findings.length),
    blockerCount: blockerFeedback.uniqueBlockerCount,
    uniqueBlockerCount: blockerFeedback.uniqueBlockerCount,
    returnedBlockerCount: blockerFeedback.returnedBlockerCount,
    blockersTruncated: blockerFeedback.blockersTruncated,
    advisoryCount: numericCount(summary.advisoryCount, advisories.length),
    blockers
  };
  return blockers.length
    ? { ...common, advisoriesOmitted: advisories.length > 0 }
    : {
        ...common,
        advisories: advisories.slice(0, 8),
        advisoriesTruncated: numericCount(summary.advisoryCount, advisories.length) > 8
      };
}

function hasVisualBlocker(summary: Record<string, unknown>) {
  const visualAreas = new Set(["html", "css", "asset", "accessibility", "render"]);
  const blockers = Array.isArray(summary.blockers) ? summary.blockers : [];
  return blockers.some((blocker) => {
    if (!blocker || typeof blocker !== "object") return false;
    return visualAreas.has(String((blocker as Record<string, unknown>).area ?? ""));
  });
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
