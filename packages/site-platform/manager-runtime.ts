import { sha256, stableJson } from "@/packages/business-data";
import {
  assertCompleteWorkspace,
  type ManagerCompletionV3,
  type ManagerRunRequestV3,
  type ManagerToolCallV3,
  type ManagerToolExecutionV3,
  type ManagerToolRuntimeV3,
  type WorkspaceSourceFile
} from "@/packages/site-agent";
import { sitePlanV1Schema, type SitePlanV1 } from "@/packages/site-contracts";

type BuildResult = {
  revision: string;
  buildDurationMs: number;
  previewPath: string;
  placementId?: string;
};

const maxReadBytesPerCall = 96 * 1024;
const maxReadLinesPerCall = 800;
const maxAppliedReplacements = 30;

export type RuntimeInspectionV3<Checkpoint> = {
  passed: boolean;
  inspectionHash: `sha256:${string}`;
  modelSummary: Record<string, unknown>;
  traceSummary: Record<string, unknown>;
  findingFingerprints?: string[];
  objectiveChecks?: Array<{ kind: string; passed: boolean; detail?: string }>;
  images?: Array<{ type: "input_image"; image_url: string; detail: "high" | "low" }>;
  checkpoint?: Checkpoint;
};

export class WorkspaceManagerRuntimeV3<Checkpoint> implements ManagerToolRuntimeV3 {
  private files = new Map<WorkspaceSourceFile["path"], string>();
  private workspaceHash?: `sha256:${string}`;
  private sandboxRevision: string;
  private successfulBuild?: { workspaceHash: `sha256:${string}`; sandboxRevision: string };
  private passingInspection?: RuntimeInspectionV3<Checkpoint>;
  private firstSuccessfulBuild = false;
  private readCalls = 0;
  private readBytes = 0;
  private readLines = 0;
  private appliedReplacements = 0;
  private anchorFailures = 0;
  private builds = 0;
  private inspections = 0;
  private lastBuildResult?: BuildResult;
  private lastInspection?: RuntimeInspectionV3<Checkpoint>;
  private lastFindingFingerprints?: Set<string>;
  private objectiveChecks: Array<{ kind: string; passed: boolean; detail?: string }> = [];
  private noProgressTransitions = 0;
  private readonly seenWorkspaceHashes = new Set<string>();
  private sitePlan?: SitePlanV1;
  private planHash?: `sha256:${string}`;

  constructor(private readonly options: {
    kind: ManagerRunRequestV3["kind"];
    publicBuildInputId: string;
    toolchainVersion: string;
    sandboxImageDigest: `sha256:${string}`;
    initialFiles?: WorkspaceSourceFile[];
    initialSandboxRevision: string;
    maxBuilds: number;
    maxInspections: number;
    applyBuild(files: WorkspaceSourceFile[], expectedRevision: string): Promise<BuildResult>;
    inspect(files: WorkspaceSourceFile[], sandboxRevision: string): Promise<RuntimeInspectionV3<Checkpoint>>;
    retainDiagnostic?(kind: string, content: string): Promise<{ key: string; contentHash: `sha256:${string}`; bytes: number }>;
  }) {
    this.sandboxRevision = options.initialSandboxRevision;
    for (const file of options.initialFiles ?? []) this.files.set(file.path, file.content);
    this.refreshWorkspaceHash();
    if (this.workspaceHash) this.seenWorkspaceHashes.add(this.workspaceHash);
  }

  acceptPlan(plan: SitePlanV1) {
    const parsed = sitePlanV1Schema.parse(plan);
    if (this.sitePlan) {
      if (stableJson(this.sitePlan) === stableJson(parsed)) return;
      throw new Error("manager_site_plan_already_frozen");
    }
    this.sitePlan = parsed;
    this.planHash = sha256(stableJson(parsed));
  }

  async execute(call: ManagerToolCallV3): Promise<ManagerToolExecutionV3> {
    if (call.name === "set_site_plan") return result({ ok: false, error: "manager_site_plan_already_closed" });
    if (!this.sitePlan || !this.planHash) return result({ ok: false, error: "manager_site_plan_required" });
    if (call.name === "read_workspace") return this.read(call.arguments);
    if (call.name === "search_workspace") return this.search(call.arguments);
    if (call.name === "write_file") return this.write(call.arguments);
    if (call.name === "apply_patch") return this.patch(call.arguments);
    if (call.name === "build_preview") return this.build(call.arguments);
    if (call.name === "inspect_candidate") return this.inspect(call.arguments);
    return this.finish(call.arguments);
  }

  finalCheckpoint() {
    if (!this.passingInspection?.passed || !this.passingInspection.checkpoint) throw new Error("manager_finished_without_passing_checkpoint");
    return this.passingInspection.checkpoint;
  }

  currentFiles() {
    return [...this.files.entries()].map(([path, content]) => ({ path, content })).sort((left, right) => left.path.localeCompare(right.path));
  }

  metrics() {
    return {
      builds: this.builds,
      inspections: this.inspections,
      appliedReplacements: this.appliedReplacements,
      anchorFailures: this.anchorFailures,
      readCalls: this.readCalls,
      readBytes: this.readBytes,
      readLines: this.readLines
      ,noProgressTransitions: this.noProgressTransitions
    };
  }

  stateSummary() {
    return {
      acceptedSitePlan: this.sitePlan ? { planHash: this.planHash, plan: this.sitePlan } : { status: "required" },
      workspace: {
        hash: this.workspaceHash,
        sandboxRevision: this.sandboxRevision,
        files: this.currentFiles().map((file) => ({
          path: file.path,
          contentHash: sha256(file.content),
          lines: file.content.split("\n").length,
          outline: sourceOutline(file)
        })),
        routes: routeOutline(this.files.get("src/site.tsx") ?? "")
      },
      latestBuild: this.successfulBuild ? { status: "passed", ...this.successfulBuild } : this.lastBuildResult ? { status: "stale", ...this.lastBuildResult } : { status: "not_run" },
      latestInspection: this.lastInspection ? {
        status: this.lastInspection.passed ? "passed" : "failed",
        inspectionHash: this.lastInspection.inspectionHash,
        unresolvedFindingFingerprints: this.lastInspection.findingFingerprints ?? [],
        findings: summaryFindings(this.lastInspection.modelSummary)
      } : { status: "not_run" },
      objectiveChecks: this.objectiveChecks,
      convergence: { noProgressTransitions: this.noProgressTransitions, seenWorkspaceStates: this.seenWorkspaceHashes.size }
    };
  }

  private read(args: Record<string, unknown>): ManagerToolExecutionV3 {
    this.readCalls += 1;
    const path = args.path as WorkspaceSourceFile["path"];
    const content = this.files.get(path);
    if (content === undefined) return result({ ok: false, error: "workspace_file_missing", path });
    const lines = content.split("\n");
    const start = Math.max(1, Number(args.startLine ?? 1));
    const end = Math.min(lines.length, Number(args.endLine ?? Math.min(lines.length, start + 199)));
    if (end < start) return result({ ok: false, error: "invalid_line_window", path, startLine: start, endLine: end });
    const selected = lines.slice(start - 1, end).join("\n");
    const bytes = Buffer.byteLength(selected);
    const lineCount = end - start + 1;
    if (bytes > maxReadBytesPerCall || lineCount > maxReadLinesPerCall) {
      return result({
        ok: false,
        error: "read_window_too_large",
        path,
        startLine: start,
        endLine: end,
        requestedBytes: bytes,
        requestedLines: lineCount,
        maxBytes: maxReadBytesPerCall,
        maxLines: maxReadLinesPerCall
      });
    }
    this.readBytes += bytes;
    this.readLines += lineCount;
    return {
      modelOutput: JSON.stringify({ ok: true, path, contentHash: sha256(content), startLine: start, endLine: end, totalLines: lines.length, content: selected }),
      traceOutput: { ok: true, path, contentHash: sha256(content), startLine: start, endLine: end, totalLines: lines.length, bytes }
    };
  }

  private search(args: Record<string, unknown>): ManagerToolExecutionV3 {
    const query = String(args.query ?? "");
    const requestedPath = args.path as WorkspaceSourceFile["path"] | undefined;
    const maxResults = Math.max(1, Math.min(100, Number(args.maxResults ?? 40)));
    const matches: Array<{ path: WorkspaceSourceFile["path"]; line: number; column: number; preview: string }> = [];
    for (const [path, content] of this.files) {
      if (requestedPath && requestedPath !== path) continue;
      for (const [lineIndex, line] of content.split("\n").entries()) {
        let offset = line.indexOf(query);
        while (offset >= 0 && matches.length < maxResults) {
          matches.push({ path, line: lineIndex + 1, column: offset + 1, preview: line.slice(Math.max(0, offset - 120), offset + query.length + 120) });
          offset = line.indexOf(query, offset + Math.max(1, query.length));
        }
        if (matches.length >= maxResults) break;
      }
      if (matches.length >= maxResults) break;
    }
    return result({ ok: true, query, path: requestedPath, matches, truncated: matches.length >= maxResults });
  }

  private write(args: Record<string, unknown>): ManagerToolExecutionV3 {
    if (this.options.kind !== "initial_build" || this.firstSuccessfulBuild) return result({ ok: false, error: "write_file_not_available_after_initial_authoring" });
    const path = args.path as WorkspaceSourceFile["path"];
    const content = String(args.content ?? "");
    this.files.set(path, content);
    this.mutated();
    return result({ ok: true, path, contentHash: sha256(content), workspaceHash: this.workspaceHash });
  }

  private patch(args: Record<string, unknown>): ManagerToolExecutionV3 {
    const requested = args.files as Array<{
      path: WorkspaceSourceFile["path"];
      expectedContentHash: string;
      replacements: Array<{ oldText: string; newText: string }>;
    }>;
    const replacementCount = requested.reduce((total, file) => total + file.replacements.length, 0);
    if (this.appliedReplacements + replacementCount > maxAppliedReplacements) throw new Error("manager_patch_budget_exhausted");
    const seen = new Set<WorkspaceSourceFile["path"]>();
    const pending = new Map<WorkspaceSourceFile["path"], string>();
    for (const [fileIndex, file] of requested.entries()) {
      if (seen.has(file.path)) return this.stalledResult({ ok: false, error: "patch_file_duplicated", path: file.path, fileIndex });
      seen.add(file.path);
      const current = this.files.get(file.path);
      if (current === undefined) return this.stalledResult({ ok: false, error: "workspace_file_missing", path: file.path, fileIndex });
      const currentHash = sha256(current);
      if (file.expectedContentHash !== currentHash) {
        return this.stalledResult({ ok: false, error: "content_hash_conflict", path: file.path, fileIndex, currentContentHash: currentHash });
      }
      let next = current;
      for (const [replacementIndex, replacement] of file.replacements.entries()) {
        const matches = occurrences(next, replacement.oldText);
        if (matches.length !== 1) {
          this.anchorFailures += 1;
          if (this.anchorFailures > 6) throw new Error("manager_patch_anchor_failure_budget_exhausted");
          return this.stalledResult({
            ok: false,
            error: matches.length === 0 ? "patch_anchor_not_found" : "patch_anchor_ambiguous",
            path: file.path,
            fileIndex,
            replacementIndex,
            matchCount: matches.length,
            currentContentHash: currentHash,
            sourceWindow: nearestSourceWindow(next, replacement.oldText)
          });
        }
        next = `${next.slice(0, matches[0])}${replacement.newText}${next.slice(matches[0] + replacement.oldText.length)}`;
      }
      pending.set(file.path, next);
    }
    this.appliedReplacements += replacementCount;
    for (const [path, content] of pending) this.files.set(path, content);
    this.mutated();
    return result({
      ok: true,
      patchesApplied: replacementCount,
      files: [...pending].map(([path, content]) => ({ path, contentHash: sha256(content) })),
      workspaceHash: this.workspaceHash
    });
  }

  private async build(args: Record<string, unknown>): Promise<ManagerToolExecutionV3> {
    if (this.builds >= this.options.maxBuilds) throw new Error("manager_build_budget_exhausted");
    if (!this.workspaceHash || args.expectedWorkspaceHash !== this.workspaceHash) {
      return this.stalledResult({ ok: false, error: "workspace_hash_conflict", workspaceHash: this.workspaceHash });
    }
    if (this.successfulBuild?.workspaceHash === this.workspaceHash && this.lastBuildResult) {
      this.recordNoProgress();
      return result({ ok: true, cached: true, workspaceHash: this.workspaceHash, sandboxRevision: this.lastBuildResult.revision, previewPath: this.lastBuildResult.previewPath, buildDurationMs: 0, placementId: this.lastBuildResult.placementId });
    }
    const files = assertCompleteWorkspace(this.currentFiles());
    this.builds += 1;
    try {
      const built = await this.options.applyBuild(files, this.sandboxRevision);
      this.lastBuildResult = built;
      this.sandboxRevision = built.revision;
      this.successfulBuild = { workspaceHash: this.workspaceHash, sandboxRevision: built.revision };
      this.passingInspection = undefined;
      this.firstSuccessfulBuild = true;
      this.recordNoProgress();
      return result({ ok: true, cached: false, workspaceHash: this.workspaceHash, sandboxRevision: built.revision, previewPath: built.previewPath, buildDurationMs: built.buildDurationMs, placementId: built.placementId });
    } catch (error) {
      const diagnostic = boundedError(error);
      const retained = await this.options.retainDiagnostic?.("build_failure", diagnostic);
      this.recordNoProgress();
      return {
        modelOutput: JSON.stringify({ ok: false, error: diagnostic, diagnostic: retained, workspaceHash: this.workspaceHash, sandboxRevision: this.sandboxRevision, buildNumber: this.builds }),
        traceOutput: { ok: false, error: "build_failed", diagnostic: retained, workspaceHash: this.workspaceHash, sandboxRevision: this.sandboxRevision, buildNumber: this.builds }
      };
    }
  }

  private async inspect(args: Record<string, unknown>): Promise<ManagerToolExecutionV3> {
    if (this.inspections >= this.options.maxInspections) throw new Error("manager_inspection_budget_exhausted");
    if (!this.workspaceHash || !this.successfulBuild
      || args.expectedWorkspaceHash !== this.workspaceHash
      || args.expectedSandboxRevision !== this.sandboxRevision
      || this.successfulBuild.workspaceHash !== this.workspaceHash
      || this.successfulBuild.sandboxRevision !== this.sandboxRevision) {
      return this.stalledResult({ ok: false, error: "inspection_requires_unchanged_successful_build", workspaceHash: this.workspaceHash, sandboxRevision: this.sandboxRevision });
    }
    if (this.lastInspection && this.successfulBuild.workspaceHash === this.workspaceHash && this.successfulBuild.sandboxRevision === this.sandboxRevision) {
      this.recordNoProgress();
      return inspectionResult(this.lastInspection, true);
    }
    this.inspections += 1;
    const inspected = await this.options.inspect(this.currentFiles(), this.sandboxRevision);
    const previous = this.lastFindingFingerprints;
    const next = new Set(inspected.findingFingerprints ?? []);
    const findingDelta = {
      new: [...next].filter((fingerprint) => !previous?.has(fingerprint)),
      remaining: [...next].filter((fingerprint) => previous?.has(fingerprint)),
      resolved: previous ? [...previous].filter((fingerprint) => !next.has(fingerprint)) : []
    };
    const findingsShrank = findingDelta.resolved.length > 0;
    inspected.modelSummary = { ...inspected.modelSummary, findingDelta };
    inspected.traceSummary = { ...inspected.traceSummary, findingDelta };
    this.lastFindingFingerprints = next;
    this.lastInspection = inspected;
    this.objectiveChecks = inspected.objectiveChecks ?? [];
    this.passingInspection = inspected.passed ? inspected : undefined;
    if (inspected.passed || findingsShrank) this.noProgressTransitions = 0;
    else this.recordNoProgress();
    return inspectionResult(inspected, false);
  }

  private finish(args: Record<string, unknown>): ManagerToolExecutionV3 {
    const completion = managerCompletion(args);
    if (!this.planHash) return result({ ok: false, error: "manager_site_plan_required" });
    if (!this.workspaceHash || !this.successfulBuild || !this.passingInspection?.passed || !this.passingInspection.checkpoint) {
      return result({ ok: false, error: "finish_requires_passing_objective_inspection" });
    }
    const expected = {
      workspaceHash: this.workspaceHash,
      sandboxRevision: this.sandboxRevision,
      publicBuildInputId: this.options.publicBuildInputId,
      toolchainVersion: this.options.toolchainVersion,
      sandboxImageDigest: this.options.sandboxImageDigest,
      inspectionHash: this.passingInspection.inspectionHash,
      planHash: this.planHash
    };
    for (const [key, value] of Object.entries(expected)) {
      if (completion[key as keyof ManagerCompletionV3] !== value) return result({ ok: false, error: "finish_state_mismatch", field: key, expected: value });
    }
    if (this.successfulBuild.workspaceHash !== this.workspaceHash || this.successfulBuild.sandboxRevision !== this.sandboxRevision) {
      return result({ ok: false, error: "finish_workspace_changed_after_build" });
    }
    return { modelOutput: JSON.stringify({ ok: true, completed: true }), traceOutput: { ok: true, completed: true, ...expected }, completion };
  }

  private mutated() {
    const previousHash = this.workspaceHash;
    this.refreshWorkspaceHash();
    this.successfulBuild = undefined;
    this.passingInspection = undefined;
    this.lastInspection = undefined;
    this.objectiveChecks = [];
    if (!this.workspaceHash || this.workspaceHash === previousHash || this.seenWorkspaceHashes.has(this.workspaceHash)) this.recordNoProgress();
    else {
      this.seenWorkspaceHashes.add(this.workspaceHash);
      this.noProgressTransitions = 0;
    }
  }

  private stalledResult(value: Record<string, unknown>) {
    this.recordNoProgress();
    return result(value);
  }

  private recordNoProgress() {
    this.noProgressTransitions += 1;
    if (this.noProgressTransitions >= 3) throw new Error("manager_no_progress");
  }

  private refreshWorkspaceHash() {
    this.workspaceHash = this.files.size ? sha256(stableJson(this.currentFiles())) : undefined;
  }
}

function inspectionResult<Checkpoint>(inspection: RuntimeInspectionV3<Checkpoint>, cached: boolean): ManagerToolExecutionV3 {
  const summary = { ...inspection.modelSummary, cached };
  return {
    modelOutput: inspection.images?.length
      ? [{ type: "input_text", text: JSON.stringify(summary) }, ...inspection.images]
      : JSON.stringify(summary),
    traceOutput: { ...inspection.traceSummary, cached }
  };
}

function routeOutline(source: string) {
  return [...source.matchAll(/\bpath\s*:\s*["']([^"']+)["']/g)].map((match) => match[1]).filter((value, index, all) => all.indexOf(value) === index).slice(0, 100);
}

function sourceOutline(file: WorkspaceSourceFile) {
  const patterns = file.path.endsWith(".tsx")
    ? /^(?:export\s+)?(?:const|function|class|interface|type)\s+([A-Za-z0-9_$-]+)/
    : /^([^@][^{]{0,120})\{/;
  return file.content.split("\n").flatMap((line, index) => {
    const match = line.trim().match(patterns);
    return match ? [{ line: index + 1, label: match[1].trim().slice(0, 120) }] : [];
  }).slice(0, 80);
}

function summaryFindings(summary: Record<string, unknown>) {
  const findings = Array.isArray(summary.findings) ? summary.findings : [];
  return findings.slice(0, 100);
}

function managerCompletion(args: Record<string, unknown>) {
  return {
    schemaVersion: "manager-completion-v3" as const,
    ...args
  } as ManagerCompletionV3;
}

function result(value: Record<string, unknown>): ManagerToolExecutionV3 {
  return { modelOutput: JSON.stringify(value), traceOutput: value };
}

function occurrences(source: string, value: string) {
  const matches: number[] = [];
  let index = source.indexOf(value);
  while (index >= 0) {
    matches.push(index);
    index = source.indexOf(value, index + Math.max(1, value.length));
  }
  return matches;
}

function nearestSourceWindow(source: string, anchor: string) {
  const sourceLines = source.split("\n");
  const anchorTokens = new Set(anchor.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
  let best = 0;
  let bestScore = -1;
  for (let index = 0; index < sourceLines.length; index += 1) {
    const tokens = sourceLines[index].toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
    const score = tokens.filter((token) => anchorTokens.has(token)).length;
    if (score > bestScore) { best = index; bestScore = score; }
  }
  const start = Math.max(0, best - 3);
  const end = Math.min(sourceLines.length, best + 4);
  return { startLine: start + 1, endLine: end, content: sourceLines.slice(start, end).join("\n") };
}

function boundedError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.length > 12_000 ? `${value.slice(-11_980)}... [truncated]` : value;
}
