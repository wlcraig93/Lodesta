import { sha256, stableJson } from "@/packages/business-data";
import {
  assertCompleteWorkspace,
  isSiteAuthoringTerminalError,
  managerCompletionSchema,
  managerToolArguments,
  validateWorkspaceSourcePolicy,
  workspaceSourceFileSchema,
  type ManagerCompletion,
  type ManagerRunRequest,
  type ManagerToolCall,
  type ManagerToolExecution,
  type ManagerToolRuntime,
  type WorkspaceReferenceFile,
  type WorkspaceSourceFile
} from "@/packages/site-agent";
import { normalizeRoutePath } from "@/packages/site-verification";
import {
  groupVerificationFindings,
  verificationBlockerFeedback
} from "./verification-feedback";
import { validateCandidateSourceDispositions } from "./source-coverage";

const inspectionToolTimeoutMs = 8 * 60_000;

export type BuildResult = {
  revision: string;
  buildDurationMs: number;
  previewPath: string;
  placementId?: string;
};

export type WorkspaceReleasePlan = {
  routePaths: string[];
  browserRoutePaths: string[];
  visualReviewRoutePaths: string[];
  redirects: ManagerCompletion["redirects"];
  retiredSourcePaths: ManagerCompletion["retiredSourcePaths"];
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

type RuntimeInspectionPhase = "browser_navigation_capture" | "visual_evidence_preparation" | "persistence";

export type WorkspaceManagerRuntimeSnapshot<Checkpoint> = {
  schemaVersion: 1;
  files: WorkspaceSourceFile[];
  workspaceHash?: `sha256:${string}`;
  sandboxRevision: string;
  successfulBuild?: { workspaceHash: `sha256:${string}`; sandboxRevision: string; result: BuildResult };
  failedBuild?: {
    workspaceHash: `sha256:${string}`;
    sandboxRevision: string;
    error: string;
    diagnostic?: { key: string; contentHash: `sha256:${string}`; bytes: number };
    failureFingerprint: `sha256:${string}`;
  };
  inspection?: RuntimeInspection<Checkpoint>;
  visualInspection?: RuntimeVisualInspection;
  metrics: {
    builds: number;
    inspections: number;
    readCalls: number;
    readBytes: number;
    readLines: number;
    sourceOpens: number;
    sourceSearches: number;
    retrievalRequests: number;
    retrievalFailures: number;
  };
  mutatedWorkspace: boolean;
};

/**
 * A deliberately small workspace runtime. The model owns ordinary source files;
 * this class only provides filesystem operations plus the build/release boundary.
 */
export class WorkspaceManagerRuntime<Checkpoint> implements ManagerToolRuntime {
  private files = new Map<string, string>();
  private referenceFiles = new Map<string, string>();
  private workspaceHash?: `sha256:${string}`;
  private sandboxRevision: string;
  private successfulBuild?: { workspaceHash: `sha256:${string}`; sandboxRevision: string; result: BuildResult };
  private failedBuild?: WorkspaceManagerRuntimeSnapshot<Checkpoint>["failedBuild"];
  private inspection?: RuntimeInspection<Checkpoint>;
  private visualInspection?: RuntimeVisualInspection;
  private builds = 0;
  private inspections = 0;
  private readCalls = 0;
  private readBytes = 0;
  private readLines = 0;
  private sourceOpens = 0;
  private sourceSearches = 0;
  private retrievalRequests = 0;
  private retrievalFailures = 0;
  private mutatedWorkspace = false;

  constructor(private readonly options: {
    kind: ManagerRunRequest["kind"];
    publicBuildInputId: string;
    getPublicBuildInputId?(): string;
    toolchainVersion: string;
    sandboxImageDigest: `sha256:${string}`;
    initialFiles?: WorkspaceSourceFile[];
    referenceFiles?: WorkspaceReferenceFile[];
    initialSandboxRevision: string;
    initialSnapshot?: WorkspaceManagerRuntimeSnapshot<Checkpoint>;
    releasePlan?: WorkspaceReleasePlan;
    selection?: ManagerRunRequest["selection"];
    applyBuild(files: WorkspaceSourceFile[], expectedRevision: string, signal?: AbortSignal): Promise<BuildResult>;
    inspect(files: WorkspaceSourceFile[], sandboxRevision: string, signal?: AbortSignal): Promise<RuntimeInspection<Checkpoint>>;
    verify?(files: WorkspaceSourceFile[], sandboxRevision: string, signal?: AbortSignal): Promise<RuntimeInspection<Checkpoint>>;
    listBuiltRoutePaths?(sandboxRevision: string): Promise<string[]>;
    inspectVisual?(files: WorkspaceSourceFile[], sandboxRevision: string, target: {
      route?: string;
      selector?: string;
      label?: string;
    }, signal?: AbortSignal, onPhase?: (phase: RuntimeInspectionPhase, durationMs?: number) => void): Promise<RuntimeVisualInspection>;
    visualInspectionFeedback?: "prioritized-homepage" | "blockers-only-homepage" | "material-only-homepage" | "component-diagnostic-homepage" | "component-diagnostic-route-family" | "component-diagnostic-route-family-shared-first" | "component-diagnostic-route-family-quality-led" | "component-diagnostic-route-family-material-only" | "component-diagnostic-route-family-material-copy" | "component-diagnostic-route-family-balanced" | "component-diagnostic-route-family-component-evidence";
    configureLeadForm?(args: Record<string, unknown>): Promise<ManagerToolExecution>;
    createImage?(args: Record<string, unknown>): Promise<ManagerToolExecution>;
    executeSourceTool?(call: ManagerToolCall): Promise<ManagerToolExecution>;
    retainDiagnostic?(kind: string, content: string): Promise<{ key: string; contentHash: `sha256:${string}`; bytes: number }>;
  }) {
    const snapshot = options.initialSnapshot;
    this.sandboxRevision = snapshot?.sandboxRevision ?? options.initialSandboxRevision;
    for (const file of snapshot?.files ?? options.initialFiles ?? []) this.files.set(file.path, file.content);
    for (const file of options.referenceFiles ?? []) this.referenceFiles.set(file.path, file.content);
    if (snapshot) {
      this.workspaceHash = snapshot.workspaceHash;
      this.successfulBuild = snapshot.successfulBuild;
      this.failedBuild = snapshot.failedBuild;
      this.inspection = snapshot.inspection;
      this.visualInspection = snapshot.visualInspection;
      this.builds = snapshot.metrics.builds;
      this.inspections = snapshot.metrics.inspections;
      this.readCalls = snapshot.metrics.readCalls;
      this.readBytes = snapshot.metrics.readBytes;
      this.readLines = snapshot.metrics.readLines;
      this.sourceOpens = snapshot.metrics.sourceOpens;
      this.sourceSearches = snapshot.metrics.sourceSearches;
      this.retrievalRequests = snapshot.metrics.retrievalRequests;
      this.retrievalFailures = snapshot.metrics.retrievalFailures;
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
      case "search_sources":
      case "read_source_page":
      case "list_source_pages":
      case "list_source_resources":
      case "adopt_source_asset":
      case "search_public_web":
      case "retry_source":
      case "inspect_assets":
      case "retrieve_public_source": {
        if (!this.options.executeSourceTool) return result({ ok: false, error: "source_tool_unavailable" });
        if (call.name === "search_sources") this.sourceSearches += 1;
        if (call.name === "read_source_page" || call.name === "list_source_pages" || call.name === "list_source_resources" || call.name === "adopt_source_asset" || call.name === "inspect_assets") this.sourceOpens += 1;
        if (call.name === "retry_source" || call.name === "retrieve_public_source" || call.name === "search_public_web") this.retrievalRequests += 1;
        const execution = await this.options.executeSourceTool(call);
        if (
          (call.name === "retry_source" || call.name === "retrieve_public_source" || call.name === "search_public_web")
          && execution.diagnosticOutput.ok === false
        ) {
          this.retrievalFailures += 1;
        }
        return execution;
      }
      case "write_file": return this.write(call.arguments);
      case "delete_file": return this.delete(call.arguments);
      case "apply_patch": return this.patch(call.arguments);
      case "edit_file": return this.edit(call.arguments);
      case "configure_lead_form": {
        if (!this.options.configureLeadForm) return result({ ok: false, error: "lead_form_configuration_unavailable" });
        const configured = await this.options.configureLeadForm(call.arguments);
        if (configured.diagnosticOutput.ok !== false) {
          this.successfulBuild = undefined;
          this.failedBuild = undefined;
          this.inspection = undefined;
          this.visualInspection = undefined;
        }
        return configured;
      }
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
      // Retained run events and internal diagnostics may still replay this
      // operation. New authors are not offered it as a model-facing tool.
      case "build_preview": return this.build();
      case "inspect_site": return this.inspect(call.arguments);
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
    return {
      builds: this.builds,
      inspections: this.inspections,
      readCalls: this.readCalls,
      readBytes: this.readBytes,
      readLines: this.readLines,
      sourceOpens: this.sourceOpens,
      sourceSearches: this.sourceSearches,
      retrievalRequests: this.retrievalRequests,
      retrievalFailures: this.retrievalFailures
    };
  }

  snapshot(): WorkspaceManagerRuntimeSnapshot<Checkpoint> {
    return {
      schemaVersion: 1,
      files: this.currentFiles(),
      workspaceHash: this.workspaceHash,
      sandboxRevision: this.sandboxRevision,
      successfulBuild: this.successfulBuild ? structuredClone(this.successfulBuild) : undefined,
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
      files: [
        ...this.currentFiles().map((file) => ({ path: file.path, contentHash: sha256(file.content), bytes: Buffer.byteLength(file.content), lines: file.content.split("\n").length, readOnly: false })),
        ...[...this.referenceFiles.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, content]) => ({
          path,
          contentHash: sha256(content),
          bytes: Buffer.byteLength(content),
          lines: content.split("\n").length,
          readOnly: true
        }))
      ]
    });
  }

  private search(args: Record<string, unknown>): ManagerToolExecution {
    const parsed = managerToolArguments.search_files.parse(args);
    const query = parsed.caseSensitive ? parsed.query : parsed.query.toLocaleLowerCase();
    const selected = parsed.paths.length
      ? parsed.paths.map((path) => [path, this.readableFile(path)] as const)
      : [...this.files.entries(), ...this.referenceFiles.entries()];
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
      const content = this.readableFile(request.path);
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
    const succeededCount = files.filter((file) => file.ok).length;
    const failedCount = files.length - succeededCount;
    const complete = failedCount === 0;
    return {
      modelOutput: JSON.stringify({
        ok: succeededCount > 0,
        complete,
        succeededCount,
        failedCount,
        files
      }),
      diagnosticOutput: {
        ok: succeededCount > 0,
        complete,
        succeededCount,
        failedCount,
        files: diagnosticFiles
      }
    };
  }

  private write(args: Record<string, unknown>): ManagerToolExecution {
    const file = workspaceSourceFileSchema.parse({ path: args.path, content: args.content });
    if (this.files.get(file.path) === file.content) {
      return result({ ok: true, unchanged: true, path: file.path, contentHash: sha256(file.content), workspaceHash: this.workspaceHash });
    }
    const rejected = invalidSourceMutation(file);
    if (rejected) return rejected;
    this.files.set(file.path, file.content);
    this.mutated();
    return result({ ok: true, path: file.path, contentHash: sha256(file.content), workspaceHash: this.workspaceHash });
  }

  private readableFile(path: string) {
    return this.files.get(path) ?? this.referenceFiles.get(path);
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
      else {
        const file = workspaceSourceFileSchema.parse({ path, content: change.content });
        const rejected = invalidSourceMutation(file);
        if (rejected) return rejected;
        next.set(path, file.content);
      }
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
    if (
      parsed.path.endsWith(".css")
      && lines.length === 1
      && current.length >= 4_096
      && nextContent.length < current.length * 0.75
      && edits.some((edit) => edit.startLine === 1 && edit.endLine === 1)
    ) {
      return result({
        ok: false,
        error: "minified_stylesheet_destructive_edit",
        path: parsed.path,
        currentBytes: Buffer.byteLength(current),
        proposedBytes: Buffer.byteLength(nextContent),
        workspaceUnchanged: true,
        guidance: "This stylesheet is one long source line, so replacing line 1 would discard most existing styles. To append CSS, insert at EOF with startLine 2 and endLine 1. To replace it intentionally, use write_file with the complete stylesheet."
      });
    }
    const rejected = invalidSourceMutation({ path: parsed.path, content: nextContent });
    if (rejected) return rejected;
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

  private async build(signal?: AbortSignal): Promise<ManagerToolExecution> {
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
      const built = await this.options.applyBuild(files, this.sandboxRevision, signal);
      this.sandboxRevision = built.revision;
      this.successfulBuild = { workspaceHash: this.workspaceHash, sandboxRevision: built.revision, result: built };
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

  private async inspect(args: Record<string, unknown>): Promise<ManagerToolExecution> {
    const startedAt = Date.now();
    const timeoutSignal = AbortSignal.timeout(inspectionToolTimeoutMs);
    let failurePhase = "build";
    const phaseTimings: Record<string, number> = {};
    const operation = this.inspectWithinDeadline(args, timeoutSignal, phaseTimings, (phase) => {
      failurePhase = phase;
    });
    try {
      const execution = await raceWithAbort(operation, timeoutSignal);
      execution.diagnosticOutput.inspectionPhases = {
        ...phaseTimings,
        totalMs: Date.now() - startedAt
      };
      return execution;
    } catch (error) {
      const cause = boundedError(error);
      if (!timeoutSignal.aborted) {
        await this.options.retainDiagnostic?.("inspection_failure", JSON.stringify({
          failurePhase,
          cause,
          phaseTimings,
          durationMs: Date.now() - startedAt
        })).catch(() => undefined);
        throw error;
      }
      await this.options.retainDiagnostic?.("inspection_timeout", JSON.stringify({
        failurePhase,
        cause,
        phaseTimings,
        durationMs: Date.now() - startedAt
      })).catch(() => undefined);
      return result({
        ok: false,
        error: "inspection_timeout",
        recoverable: true,
        failurePhase,
        sanitizedCause: cause,
        inspectionPhases: {
          ...phaseTimings,
          totalMs: Date.now() - startedAt
        }
      });
    }
  }

  private async inspectWithinDeadline(
    args: Record<string, unknown>,
    signal: AbortSignal,
    phaseTimings: Record<string, number>,
    setPhase: (phase: string) => void
  ): Promise<ManagerToolExecution> {
    const parsed = managerToolArguments.inspect_site.parse(args);
    const route = parsed.route ?? (this.options.kind === "initial_build" ? undefined : this.options.selection?.route);
    const selection = this.options.selection?.route === route ? this.options.selection : undefined;
    let buildPerformed = false;
    if (!this.workspaceHash || !this.successfulBuild || this.successfulBuild.workspaceHash !== this.workspaceHash) {
      setPhase("build");
      const phaseStartedAt = Date.now();
      const built = await this.build(signal);
      phaseTimings.buildMs = Date.now() - phaseStartedAt;
      if (built.diagnosticOutput.ok === false) {
        return withFailureStage(built, "compilation", { buildPerformed: true });
      }
      buildPerformed = true;
    }
    if (!this.options.inspectVisual) {
      return result({ ok: false, error: "visual_inspection_unavailable" });
    }
    const mechanicalCached = Boolean(this.inspection);
    if (!this.inspection) {
      this.inspections += 1;
      setPhase("mechanical_analysis");
      const phaseStartedAt = Date.now();
      this.inspection = await this.options.inspect(this.currentFiles(), this.sandboxRevision, signal);
      phaseTimings.mechanicalAnalysisMs = Date.now() - phaseStartedAt;
      this.inspection.diagnosticSummary = {
        ...this.inspection.diagnosticSummary,
        verificationTimings: {
          compilationMs: this.successfulBuild?.result.buildDurationMs ?? 0,
          ...recordValue(this.inspection.diagnosticSummary.verificationTimings)
        }
      };
    }
    const cached = Boolean(
      this.visualInspection
      && this.visualInspection.modelSummary.requestedRoute === route
      && this.visualInspection.modelSummary.requestedSelector === selection?.selector
    );
    if (!cached) {
      this.inspections += 1;
      const phaseStartedAt = Date.now();
      this.visualInspection = await this.options.inspectVisual(this.currentFiles(), this.sandboxRevision, {
        route,
        selector: selection?.selector,
        label: selection?.label
      }, signal, (phase, durationMs) => {
        setPhase(phase);
        if (durationMs === undefined) return;
        if (phase === "browser_navigation_capture") phaseTimings.browserNavigationCaptureMs = durationMs;
        if (phase === "visual_evidence_preparation") phaseTimings.visualEvidencePreparationMs = durationMs;
        if (phase === "persistence") phaseTimings.persistenceMs = durationMs;
      });
      phaseTimings.visualInspectionMs = Date.now() - phaseStartedAt;
    }
    const inspection = this.visualInspection;
    if (!inspection) return result({ ok: false, error: "visual_inspection_unavailable" });
    return visualInspectionResult(
      inspection,
      cached,
      buildPerformed,
      this.options.visualInspectionFeedback,
      this.inspection,
      mechanicalCached,
      this.successfulBuild?.result.previewPath
    );
  }

  private async finish(args: Record<string, unknown>): Promise<ManagerToolExecution> {
    const finish = managerToolArguments.finish.parse(args);
    const redirects = this.options.releasePlan?.redirects ?? [];
    const retiredSourcePaths = this.options.releasePlan?.retiredSourcePaths ?? [];
    try {
      validateCandidateSourceDispositions({
        redirects,
        retiredSourcePaths
      });
    } catch (error) {
      return invalidSourceDisposition(error);
    }
    const built = await this.build();
    if (built.diagnosticOutput.ok === false) return withFailureStage(built, "compilation", { buildPerformed: true });
    const buildPerformed = built.diagnosticOutput.cached !== true;
    if (this.options.releasePlan) {
      if (!this.options.listBuiltRoutePaths) throw new Error("release_plan_route_reader_required");
      const builtRoutePaths = await this.options.listBuiltRoutePaths(this.sandboxRevision);
      const plannedRouteError = invalidPlannedRoutes(
        this.options.releasePlan.routePaths,
        builtRoutePaths,
        this.options.releasePlan.redirects,
        this.options.releasePlan.retiredSourcePaths
      );
      if (plannedRouteError) return plannedRouteError;
      try {
        validateCandidateSourceDispositions({
          redirects,
          retiredSourcePaths,
          liveRoutes: new Set(builtRoutePaths)
        });
      } catch (error) {
        return invalidSourceDisposition(error);
      }
    }
    const cached = Boolean(this.inspection?.checkpoint);
    if (!this.inspection?.checkpoint) {
      this.inspections += 1;
      this.inspection = await (this.options.verify ?? this.options.inspect)(this.currentFiles(), this.sandboxRevision);
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
    const availableRoutes = inspectionRoutes(this.inspection.modelSummary);
    const routeMetadata = completionRouteMetadata(this.options.kind, this.options.selection?.route, availableRoutes);
    if (!routeMetadata) {
      return result({
        ok: false,
        error: "finish_route_inventory_empty",
        guidance: "The verified artifact exposed no live routes. Restore the approved route set before finishing."
      });
    }
    try {
      validateCandidateSourceDispositions({
        redirects,
        retiredSourcePaths,
        ...(availableRoutes.size ? { liveRoutes: availableRoutes } : {})
      });
    } catch (error) {
      return invalidSourceDisposition(error);
    }
    const completion = managerCompletionSchema.parse({
      schemaVersion: "manager-completion",
      ownerMessage: finish.ownerMessage,
      workspaceHash: this.workspaceHash,
      sandboxRevision: this.sandboxRevision,
      publicBuildInputId: this.options.getPublicBuildInputId?.() ?? this.options.publicBuildInputId,
      toolchainVersion: this.options.toolchainVersion,
      sandboxImageDigest: this.options.sandboxImageDigest,
      inspectionHash: this.inspection.inspectionHash,
      focusRoute: routeMetadata.focusRoute,
      changedRoutes: routeMetadata.changedRoutes,
      redirects,
      retiredSourcePaths
    });
    return {
      modelOutput: JSON.stringify({ ok: true, completed: true, buildPerformed }),
      diagnosticOutput: {
        ok: true,
        completed: true,
        buildPerformed,
        releasePlanApplied: Boolean(this.options.releasePlan),
        workspaceHash: this.workspaceHash,
        inspectionHash: this.inspection.inspectionHash
      },
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

function visualInspectionResult(
  inspection: RuntimeVisualInspection,
  cached: boolean,
  buildPerformed: boolean,
  feedback?: "prioritized-homepage" | "blockers-only-homepage" | "material-only-homepage" | "component-diagnostic-homepage" | "component-diagnostic-route-family" | "component-diagnostic-route-family-shared-first" | "component-diagnostic-route-family-quality-led" | "component-diagnostic-route-family-material-only" | "component-diagnostic-route-family-material-copy" | "component-diagnostic-route-family-balanced" | "component-diagnostic-route-family-component-evidence",
  mechanicalInspection?: RuntimeInspection<unknown>,
  mechanicalCached = false,
  previewPath?: string
): ManagerToolExecution {
  const modelSummary = feedback === "component-diagnostic-route-family-component-evidence"
    ? componentDiagnosticRouteFamilyComponentEvidenceVisualSummary(inspection.modelSummary)
    : feedback === "component-diagnostic-route-family-balanced"
    ? componentDiagnosticRouteFamilyBalancedVisualSummary(inspection.modelSummary)
    : feedback === "component-diagnostic-route-family-material-copy"
    ? componentDiagnosticRouteFamilyMaterialCopyVisualSummary(inspection.modelSummary)
    : feedback === "component-diagnostic-route-family-material-only"
    ? componentDiagnosticRouteFamilyMaterialOnlyVisualSummary(inspection.modelSummary)
    : feedback === "component-diagnostic-route-family-quality-led"
    ? componentDiagnosticRouteFamilyQualityLedVisualSummary(inspection.modelSummary)
    : feedback === "component-diagnostic-route-family-shared-first"
    ? componentDiagnosticRouteFamilySharedFirstVisualSummary(inspection.modelSummary)
    : feedback === "component-diagnostic-route-family"
    ? componentDiagnosticRouteFamilyVisualSummary(inspection.modelSummary)
    : feedback === "blockers-only-homepage"
    ? blockersOnlyHomepageVisualSummary(inspection.modelSummary)
    : feedback === "material-only-homepage"
    ? materialOnlyHomepageVisualSummary(inspection.modelSummary)
    : feedback === "component-diagnostic-homepage"
    ? componentDiagnosticHomepageVisualSummary(inspection.modelSummary)
    : feedback === "prioritized-homepage"
      ? prioritizedHomepageVisualSummary(inspection.modelSummary)
      : inspection.modelSummary;
  const visualFindings = Array.isArray(modelSummary.findings)
    ? modelSummary.findings.filter((finding): finding is Record<string, unknown> => Boolean(finding && typeof finding === "object" && !Array.isArray(finding)))
    : [];
  const mechanicalSummary = mechanicalInspection ? compactInspectionSummary(mechanicalInspection.modelSummary) : undefined;
  const mechanicalBlockers = mechanicalSummary && Array.isArray(mechanicalSummary.blockers) ? mechanicalSummary.blockers : [];
  const mechanicalAdvisories = mechanicalSummary && Array.isArray(mechanicalSummary.advisories) ? mechanicalSummary.advisories : [];
  const blockingFindings = groupVerificationFindings([
    ...mechanicalBlockers,
    ...visualFindings.filter((finding) => finding.severity === "error")
  ]);
  const advisoryFindings = groupVerificationFindings([
    ...mechanicalAdvisories,
    ...visualFindings.filter((finding) => finding.severity === "warning")
  ]);
  const summary = {
    ...modelSummary,
    ok: mechanicalInspection?.passed !== false,
    cached,
    mechanicalCached,
    buildPerformed,
    previewPath,
    blockingFindings,
    advisoryFindings,
    mechanicalInspection: mechanicalInspection ? {
      passed: mechanicalInspection.passed,
      inspectionHash: mechanicalInspection.inspectionHash
    } : undefined,
    visualScope: "targeted",
    mechanicalScope: "all-routes"
  };
  return {
    modelOutput: inspection.images?.length
      ? [{ type: "input_text", text: JSON.stringify(summary) }, ...inspection.images]
      : JSON.stringify(summary),
    diagnosticOutput: {
      ...inspection.diagnosticSummary,
      ok: mechanicalInspection?.passed !== false,
      cached,
      mechanicalCached,
      buildPerformed,
      previewPath,
      blockingFindings,
      advisoryFindings,
      mechanicalInspectionHash: mechanicalInspection?.inspectionHash,
      visualScope: "targeted",
      mechanicalScope: "all-routes"
    }
  };
}

export function prioritizedHomepageVisualSummary(summary: Record<string, unknown>) {
  return homepageVisualSummary(summary, "launch-floor");
}

export function blockersOnlyHomepageVisualSummary(summary: Record<string, unknown>) {
  const findings = Array.isArray(summary.findings)
    ? summary.findings.filter((finding): finding is Record<string, unknown> => Boolean(finding && typeof finding === "object" && !Array.isArray(finding)))
    : [];
  const blockers = findings.filter((finding) => finding.severity === "error");
  const result = homepageVisualSummary({ ...summary, findings: blockers }, "launch-floor");
  return {
    ...result,
    evaluationFindingCount: findings.length,
    advisoryFindingCount: findings.filter((finding) => finding.severity === "warning").length,
    authorFeedbackPolicy: "blockers-only"
  };
}

const materialHomepageAdvisoryIds = new Set([
  "functional.navigation_toggle",
  "render.inline_link_spacing",
  "render.call_action_label_spacing",
  "render.mobile_navigation_design",
  "render.horizontal_overflow",
  "render.clipping_overlap",
  "render.empty_control",
  "render.primary_geometry",
  "render.adjacent_duplicate_text",
  "render.internal_provenance_copy",
  "render.duplicate_navigation_icon",
  "render.geography_circle",
  "render.decorative_diagram",
  "render.synthetic_identity_device",
  "render.desktop_dual_navigation",
  "render.duplicate_header_action",
  "render.false_affordance",
  "render.footer_group_layout",
  "render.mobile_narrow_split",
  "render.raster_logo_filter",
  "render.raster_logo_content_scale",
  "render.duplicate_field_label",
  "render.oversized_single_line_field",
  "render.form_text",
  "render.body_font",
  "render.tiny_text",
  "render.target_size"
]);

/**
 * Operator-only middle arm: preserve all hard errors and expose only a small
 * grouped set of concrete, high-confidence integrity warnings. The complete
 * inspection remains in diagnostic events and the release gate is unchanged.
 */
export function materialOnlyHomepageVisualSummary(summary: Record<string, unknown>) {
  const findings = Array.isArray(summary.findings)
    ? summary.findings.filter((finding): finding is Record<string, unknown> => Boolean(finding && typeof finding === "object" && !Array.isArray(finding)))
    : [];
  const errors = findings.filter((finding) => finding.severity === "error");
  const advisories = findings.filter((finding) =>
    finding.severity === "warning" && materialHomepageAdvisoryIds.has(String(finding.id ?? ""))
  );
  const summarized = homepageVisualSummary({ ...summary, findings: [...errors, ...advisories] }, "launch-floor");
  const returned = Array.isArray(summarized.findings)
    ? summarized.findings.filter((finding) => Boolean(finding && typeof finding === "object" && !Array.isArray(finding))) as Array<Record<string, unknown>>
    : [];
  const returnedErrors = returned.filter((finding) => finding.severity === "error");
  const returnedAdvisories = returned.filter((finding) => finding.severity === "warning");
  return {
    ...summarized,
    evaluationFindingCount: findings.length,
    advisoryFindingCount: findings.filter((finding) => finding.severity === "warning").length,
    actionableFindingCount: errors.length + advisories.length,
    returnedFindingCount: returnedErrors.length + returnedAdvisories.length,
    findingsTruncated: errors.length + advisories.length > returnedErrors.length + returnedAdvisories.length,
    findings: [...returnedErrors, ...returnedAdvisories],
    authorFeedbackPolicy: "material-only",
    feedbackGuidance: errors.length || advisories.length
      ? "Correct every returned error. Treat warnings as grouped visual-integrity evidence, not an invitation to redesign unrelated working components. Repair shared causes once, then reinspect only if the changed pixels remain materially uncertain; otherwise finish and let deterministic release verification check operability."
      : "The deterministic homepage launch floor and material-integrity screen are clean. If the supplied pixels show no plainly visible broken hierarchy, misleading visual, or unfinished composition, finish now without cosmetic churn."
  };
}

export function componentDiagnosticHomepageVisualSummary(summary: Record<string, unknown>) {
  return homepageVisualSummary(summary, "component-diagnostic");
}

export function componentDiagnosticRouteFamilyVisualSummary(summary: Record<string, unknown>) {
  return homepageVisualSummary(summary, "component-diagnostic-route-family");
}

export function componentDiagnosticRouteFamilySharedFirstVisualSummary(summary: Record<string, unknown>) {
  return homepageVisualSummary(summary, "component-diagnostic-route-family-shared-first");
}

export function componentDiagnosticRouteFamilyQualityLedVisualSummary(summary: Record<string, unknown>) {
  return homepageVisualSummary(summary, "component-diagnostic-route-family-quality-led");
}

/**
 * Operator-only route-family treatment. Preserve the complete diagnostic event,
 * but return grouped hard errors and high-confidence
 * visual-integrity warnings to the author. This keeps browser evidence useful
 * without turning every heuristic observation into a redesign request.
 */
export function componentDiagnosticRouteFamilyMaterialOnlyVisualSummary(summary: Record<string, unknown>) {
  return boundedRouteFamilyVisualSummary(summary, materialHomepageAdvisoryIds, "route-family-material-only");
}

const materialCopyRouteFamilyAdvisoryIds = new Set([
  ...materialHomepageAdvisoryIds,
  "render.vague_process_copy",
  "route.orphan",
  "render.local_presence_missing"
]);

/** Operator-only follow-up that adds grouped copy and route-integrity evidence. */
export function componentDiagnosticRouteFamilyMaterialCopyVisualSummary(summary: Record<string, unknown>) {
  return boundedRouteFamilyVisualSummary(summary, materialCopyRouteFamilyAdvisoryIds, "route-family-material-copy");
}

const balancedRouteFamilyAdvisoryIds = new Set([
  ...materialHomepageAdvisoryIds,
  "render.vague_process_copy",
  "route.orphan"
]);

/** Operator-only balanced launch-floor treatment with five grouped advisories. */
export function componentDiagnosticRouteFamilyBalancedVisualSummary(summary: Record<string, unknown>) {
  return boundedRouteFamilyVisualSummary(summary, balancedRouteFamilyAdvisoryIds, "route-family-balanced");
}

const componentEvidenceRouteFamilyAdvisoryIds = new Set([
  ...balancedRouteFamilyAdvisoryIds,
  "render.header_control_wrap"
]);

/** Operator-only follow-up with complete shared-component examples and tablet-header evidence. */
export function componentDiagnosticRouteFamilyComponentEvidenceVisualSummary(summary: Record<string, unknown>) {
  return boundedRouteFamilyVisualSummary(summary, componentEvidenceRouteFamilyAdvisoryIds, "route-family-component-evidence");
}

function boundedRouteFamilyVisualSummary(
  summary: Record<string, unknown>,
  advisoryIds: ReadonlySet<string>,
  policy: "route-family-material-only" | "route-family-material-copy" | "route-family-balanced" | "route-family-component-evidence"
) {
  const findings = Array.isArray(summary.findings)
    ? summary.findings.filter((finding): finding is Record<string, unknown> => Boolean(finding && typeof finding === "object" && !Array.isArray(finding)))
    : [];
  const errors = findings.filter((finding) => finding.severity === "error");
  const advisories = findings.filter((finding) =>
    finding.severity === "warning" && advisoryIds.has(String(finding.id ?? ""))
  );
  const summarized = homepageVisualSummary(
    { ...summary, findings: [...errors, ...advisories] },
    "component-diagnostic-route-family"
  );
  const returned = Array.isArray(summarized.findings)
    ? summarized.findings.filter((finding) => Boolean(finding && typeof finding === "object" && !Array.isArray(finding))) as Array<Record<string, unknown>>
    : [];
  const returnedErrors = returned.filter((finding) => finding.severity === "error");
  const returnedAdvisories = returned.filter((finding) => finding.severity === "warning");
  const selected = [...returnedErrors, ...returnedAdvisories];
  return {
    ...summarized,
    evaluationFindingCount: findings.length,
    advisoryFindingCount: findings.filter((finding) => finding.severity === "warning").length,
    actionableFindingCount: errors.length + advisories.length,
    returnedFindingCount: selected.length,
    findingsTruncated: errors.length + advisories.length > selected.length,
    findings: selected,
    authorFeedbackPolicy: policy,
    feedbackGuidance: selected.length
      ? "Correct every returned error. Treat each grouped warning as advisory evidence: repair it only when the supplied pixels confirm a material defect and the change preserves working page structure, H1s, primary actions, navigation, routes, and brand decisions. Repair shared causes once at their canonical declaration. Reinspect one affected route only when changed pixels remain materially uncertain; otherwise finish and let deterministic release verification check the full site."
      : "The deterministic route-family launch floor and material-integrity screen are clean. If the supplied pixels show no plainly visible broken hierarchy, misleading visual, or unfinished composition, finish now without cosmetic churn."
  };
}

function homepageVisualSummary(summary: Record<string, unknown>, feedbackMode: "launch-floor" | "component-diagnostic" | "component-diagnostic-route-family" | "component-diagnostic-route-family-shared-first" | "component-diagnostic-route-family-quality-led") {
  const findings = Array.isArray(summary.findings)
    ? summary.findings.filter((finding): finding is Record<string, unknown> => Boolean(finding && typeof finding === "object" && !Array.isArray(finding)))
    : [];
  const actionable = findings.filter((finding) => finding.severity === "error" || finding.severity === "warning");
  const builtRoutes = stringRouteList(summary.routes);
  const inspectedRoutes = Array.isArray(summary.inspectedRoutes)
    ? stringRouteList(summary.inspectedRoutes)
    : builtRoutes;
  const visualEvidenceRoutes = stringRouteList(summary.visualEvidenceRoutes);
  const routeCount = inspectedRoutes.length;
  const qualityLed = feedbackMode === "component-diagnostic-route-family-quality-led";
  const familyDiagnostic = (feedbackMode === "component-diagnostic-route-family" || feedbackMode === "component-diagnostic-route-family-shared-first" || qualityLed) && routeCount > 1;
  const grouped = new Map<string, Record<string, unknown> & { occurrences: number; viewports: string[]; affectedRoutes: string[]; exampleRoutes: string[]; exampleMessages: string[] }>();
  for (const finding of actionable) {
    const id = typeof finding.id === "string" ? finding.id : "unknown";
    const route = typeof finding.route === "string" ? finding.route : "";
    const message = typeof finding.message === "string" ? finding.message : "";
    const key = familyDiagnostic
      ? id === "fact.sensitive_unsupported" ? `${id}:${message}` : id
      : `${id}:${route}`;
    const viewports = ["desktop", "tablet", "mobile"].filter((viewport) => new RegExp(`\\b${viewport}\\b`, "i").test(message));
    const retained = grouped.get(key);
    if (retained) {
      retained.occurrences += 1;
      retained.viewports = [...new Set([...retained.viewports, ...viewports])];
      retained.affectedRoutes = [...new Set([...retained.affectedRoutes, route].filter(Boolean))];
      if (message && !retained.exampleMessages.includes(message) && retained.exampleMessages.length < 3 && (!route || !retained.exampleRoutes.includes(route))) {
        retained.exampleMessages.push(message);
        if (route) retained.exampleRoutes.push(route);
      }
      if (finding.severity === "error" && retained.severity !== "error") {
        grouped.set(key, {
          ...finding,
          occurrences: retained.occurrences,
          viewports: retained.viewports,
          affectedRoutes: retained.affectedRoutes,
          exampleRoutes: retained.exampleRoutes,
          exampleMessages: retained.exampleMessages
        });
      }
      continue;
    }
    grouped.set(key, { ...finding, occurrences: 1, viewports, affectedRoutes: route ? [route] : [], exampleRoutes: route ? [route] : [], exampleMessages: message ? [message] : [] });
  }
  const priority = new Map([
    ["functional.navigation_toggle", 0],
    ["render.call_action_label_spacing", 1],
    ["render.inline_link_spacing", 1],
    ["render.mobile_navigation_design", 2],
    ["render.header_control_wrap", 2],
    ["render.contrast", 3],
    ["render.missing_glyph", 3],
    ["render.empty_control", 3],
    ["render.horizontal_overflow", 4],
    ["render.clipping_overlap", 5],
    ["render.primary_geometry", 6],
    ["render.lazy_above_fold_image", 6],
    ["render.adjacent_duplicate_text", 7],
    ["render.internal_provenance_copy", 7],
    ["render.vague_process_copy", 7],
    ["advisory.ia_structure", 7],
    ["advisory.ia_repetition", 7],
    ["advisory.asset_reuse", 7],
    ["advisory.raw_data_copy", 7],
    ["route.orphan", 8],
    ["render.local_presence_missing", 9],
    ["render.duplicate_navigation_icon", 8],
    ["render.geography_circle", 7],
    ["render.decorative_diagram", 8],
    ["render.synthetic_identity_device", 9],
    ["render.desktop_dual_navigation", 10],
    ["render.duplicate_header_action", 11],
    ["render.false_affordance", 12],
    ["render.footer_group_layout", 13],
    ["render.mobile_narrow_split", 14],
    ["render.raster_logo_filter", 15],
    ["render.raster_logo_content_scale", 16],
    ["render.duplicate_field_label", 17],
    ["render.oversized_single_line_field", 17],
    ["render.form_text", 18],
    ["render.body_font", 19],
    ["render.tiny_text", 20],
    ["render.target_size", 21]
  ]);
  if (feedbackMode === "component-diagnostic-route-family-shared-first" || qualityLed) {
    priority.set("metadata.description_duplicate", -3);
    priority.set("route.orphan", -2);
    priority.set("render.browser_default_control_chrome", -1);
  }
  const prioritized = [...grouped.values()].sort((left, right) =>
    (left.severity === "error" ? 0 : 1) - (right.severity === "error" ? 0 : 1)
    || (priority.get(String(left.id)) ?? 100) - (priority.get(String(right.id)) ?? 100)
    || String(left.id).localeCompare(String(right.id))
  );
  const diverse = prioritized;
  const { findings: _findings, ...rest } = summary;
  const baseFeedbackGuidance = [
    actionable.length
      ? "Correct every error. Use grouped warnings and their exampleMessages with the supplied pixels and source evidence to identify material defects; repair shared causes at the canonical declaration. Readability, contrast, form text, essential target size, hidden content, and broken interaction need concrete attention, not unrelated redesign."
      : "The inspected technical checks are clean; this is not a judgment of the complete site's quality.",
    "Preserve the approved route ledger and working behavior. Assess IA similarity as evidence, not a score to clear: repair genuinely thin or interchangeable answers, but keep appropriate shared structures. Do not edit merely to make an advisory disappear.",
    qualityLed
      ? "Compare the supplied routes, their copy, and relevant source material. Check customer-purpose hierarchy, concrete route-specific answers, accurate proof and imagery, responsive composition, opened phone navigation, and the complete form. Remove internal research language from customer copy. Follow the task skill for design and content judgment."
      : "Judge the supplied screenshots for material content, identity, accessibility, or functional defects.",
    "For an initial build, choose additional routes when their distinct content or composition leaves a material uncertainty; this sample is not whole-site approval. For an owner edit, keep review within the requested change. Reinspect affected routes when changed pixels remain uncertain. Finish when no concrete material problem remains; full release verification still checks the complete approved site."
  ].join(" ");
  const scopeGuidance = builtRoutes.length > inspectedRoutes.length
    ? `Fresh browser evidence in this pass covers only ${inspectedRoutes.join(", ")} (${inspectedRoutes.length} of ${builtRoutes.length} built routes). Do not treat it as current evidence for the other ${builtRoutes.length - inspectedRoutes.length} routes.`
    : visualEvidenceRoutes.length > 0 && inspectedRoutes.length > visualEvidenceRoutes.length
      ? `Fresh deterministic browser findings cover ${inspectedRoutes.length} routes, while the supplied native frames cover ${visualEvidenceRoutes.length}: ${visualEvidenceRoutes.join(", ")}. Match images to the one-based visualEvidenceFrames index. Do not infer visual review for routes or states absent from those frames.`
      : "";
  const feedbackGuidance = [scopeGuidance, baseFeedbackGuidance].filter(Boolean).join(" ");
  return {
    ...rest,
    builtRouteCount: builtRoutes.length,
    inspectedRouteCount: inspectedRoutes.length,
    visualEvidenceRouteCount: visualEvidenceRoutes.length,
    findingCount: findings.length,
    actionableFindingCount: actionable.length,
    returnedFindingCount: diverse.length,
    findingsTruncated: false,
    findings: diverse,
    feedbackGuidance
  };
}

function stringRouteList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((route) => {
    if (typeof route === "string" && route.startsWith("/")) return [normalizeRoutePath(route)];
    if (!route || typeof route !== "object" || Array.isArray(route)) return [];
    const path = (route as Record<string, unknown>).path;
    return typeof path === "string" && path.startsWith("/") ? [normalizeRoutePath(path)] : [];
  }))];
}

function inspectionRoutes(summary: Record<string, unknown>) {
  const routes = Array.isArray(summary.routes) ? summary.routes : [];
  return new Set(routes.flatMap((route) => {
    if (typeof route === "string") return route.startsWith("/") ? [normalizeRoutePath(route)] : [];
    const path = route && typeof route === "object" ? (route as Record<string, unknown>).path : undefined;
    return typeof path === "string" && path.startsWith("/") ? [normalizeRoutePath(path)] : [];
  }));
}

function completionRouteMetadata(
  kind: ManagerRunRequest["kind"],
  selectedRoute: string | undefined,
  availableRoutes: Set<string>
) {
  const changedRoutes = [...availableRoutes].sort((left, right) => left.localeCompare(right));
  if (!changedRoutes.length) return undefined;
  const preferredRoute = kind === "initial_build"
    ? "/"
    : normalizeRoutePath(selectedRoute ?? "/");
  const focusRoute = availableRoutes.has(preferredRoute)
    ? preferredRoute
    : availableRoutes.has("/")
      ? "/"
      : changedRoutes[0]!;
  return { focusRoute, changedRoutes };
}

function invalidPlannedRoutes(
  expectedRoutes: string[],
  actualRoutes: string[],
  redirects: ManagerCompletion["redirects"] = [],
  retiredSourcePaths: ManagerCompletion["retiredSourcePaths"] = []
): ManagerToolExecution | undefined {
  const expectedCounts = countPaths(expectedRoutes);
  const actualCounts = countPaths(actualRoutes);
  const duplicateExpectedRoutes = [...expectedCounts].filter(([, count]) => count > 1).map(([path]) => path);
  if (duplicateExpectedRoutes.length) throw new Error(`release_plan_duplicate_routes:${duplicateExpectedRoutes.join(",")}`);
  const expected = new Set(expectedCounts.keys());
  const actual = new Set(actualCounts.keys());
  const missingRoutes = [...expected].filter((path) => !actual.has(path)).sort();
  const extraRoutes = [...actual].filter((path) => !expected.has(path)).sort();
  if (!missingRoutes.length && !extraRoutes.length && actualRoutes.length === expectedRoutes.length) return undefined;
  const redirectedDestinations = new Map(redirects.map((redirect) => [
    normalizeRoutePath(redirect.sourcePath),
    normalizeRoutePath(redirect.destinationPath)
  ]));
  const retired = new Set(retiredSourcePaths.map((entry) => normalizeRoutePath(entry.sourcePath)));
  const extraRouteRepairs = extraRoutes.slice(0, 50).map((sourcePath) => {
    const destinationPath = redirectedDestinations.get(sourcePath);
    return destinationPath
      ? { sourcePath, action: "remove_route_and_repoint_all_internal_links", destinationPath }
      : { sourcePath, action: retired.has(sourcePath) ? "remove_route_and_all_internal_links" : "remove_unapproved_route_and_all_internal_links" };
  });
  return result({
    ok: false,
    error: "release_plan_route_mismatch",
    expectedRouteCount: expectedRoutes.length,
    actualRouteCount: actualRoutes.length,
    missingRouteCount: missingRoutes.length,
    extraRouteCount: extraRoutes.length,
    missingRoutes: missingRoutes.slice(0, 50),
    extraRoutes: extraRoutes.slice(0, 50),
    extraRouteRepairs,
    guidance: "Make the emitted route set exactly match the approved architecture before finishing. Remove every extra route declaration and every internal link to it across shared navigation, footers, hubs, breadcrumbs, sitemaps, related-content data, and route components; when extraRouteRepairs supplies destinationPath, repoint those links there. Removing only the emitted route array entry leaves broken links and is not a complete repair. The release plan is authoritative for this run."
  });
}

function countPaths(paths: string[]) {
  const counts = new Map<string, number>();
  for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
  return counts;
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
  const guidance = "Edit the workspace source before inspecting or finishing again.";
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
  const advisories = groupVerificationFindings(Array.isArray(summary.advisories) ? summary.advisories : []);
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
  return {
    ...common,
    advisories,
    advisoriesTruncated: false
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

function invalidSourceMutation(file: WorkspaceSourceFile): ManagerToolExecution | undefined {
  const findings = validateWorkspaceSourcePolicy([file]).filter((finding) => (
    finding.id !== "source.required_file"
    && finding.path === file.path
  ));
  if (!findings.length) return undefined;
  return result({
    ok: false,
    error: "source_validation_failed",
    path: file.path,
    workspaceUnchanged: true,
    findings,
    guidance: "The mutation was not applied. Correct every reported source-policy or syntax finding and retry against the same current file hash."
  });
}

function result(value: Record<string, unknown>): ManagerToolExecution {
  return { modelOutput: JSON.stringify(value), diagnosticOutput: value };
}

function invalidSourceDisposition(error: unknown): ManagerToolExecution {
  return result({
    ok: false,
    error: "finish_source_disposition_invalid",
    detail: boundedError(error),
    guidance: "Use plain same-site pathname values only. Omit query-string or fragment variants, remove conflicting or duplicate dispositions, and point every redirect directly to a live route before calling finish again."
  });
}

function boundedError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.length > 12_000 ? `${value.slice(-11_980)}... [truncated]` : value;
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("inspection_timeout"));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error("inspection_timeout"));
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      }
    );
  });
}
