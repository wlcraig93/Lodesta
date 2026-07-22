import "./load-env";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { sitePlatformRepository } from "../packages/platform-data";
import { AgenticSiteWorkflowV1, candidateAttemptForRun } from "../packages/site-platform";

const editSchema = z.object({
  schemaVersion: z.literal("site-edit-battery-v1"),
  targetId: z.string().min(1),
  actorId: z.string().min(1),
  siteId: z.string().min(1),
  tasks: z.array(z.object({
    id: z.enum(["element_restyle", "add_page", "move_form", "mobile_fix"]),
    instruction: z.string().min(10).max(4000),
    selection: z.object({ route: z.string().startsWith("/"), selector: z.string().min(1).max(1000) }).strict().optional()
  }).strict()).length(4)
}).strict().superRefine((value, context) => {
  const expected = new Set(["element_restyle", "add_page", "move_form", "mobile_fix"]);
  for (const task of value.tasks) expected.delete(task.id);
  if (expected.size) context.addIssue({ code: "custom", message: `Missing edit tasks: ${[...expected].join(", ")}` });
});

const planPath = process.argv.find((item) => item.startsWith("--plan="))?.slice("--plan=".length);
if (!planPath) throw new Error("Usage: quality:edit-battery -- --plan=.data/site-quality/edit-battery.json");
const plan = editSchema.parse(JSON.parse(await readFile(planPath, "utf8")));
const repository = sitePlatformRepository;
const site = await repository.getSite(plan.siteId);
if (!site || site.status !== "experimental") throw new Error("Edit battery requires a retained experimental site.");
const session = await repository.getActiveAgentSession(site.id, plan.actorId);
if (!session) throw new Error("The retained quality-run session is unavailable for this actor.");
const workflow = new AgenticSiteWorkflowV1();
const reportPath = join(dirname(planPath), `${plan.targetId}-edit-battery-report.json`);
const results: unknown[] = [];

for (const task of plan.tasks) {
  progress(task.id, "started");
  const currentSite = await repository.getSite(site.id);
  const versions = await repository.listSiteVersions(site.id);
  const currentVersion = versions.find((version) => version.workspaceRevisionId === currentSite?.currentWorkspaceRevisionId) ?? versions.at(-1);
  const { run } = await workflow.preflightAndEnqueueApply({
    session: { ...session, currentWorkspaceRevisionId: currentSite?.currentWorkspaceRevisionId },
    instruction: task.instruction,
    requestedBy: plan.actorId,
    selection: task.selection ? {
      ...task.selection,
      workspaceRevisionId: currentSite?.currentWorkspaceRevisionId,
      versionId: currentVersion?.id
    } : undefined
  });
  const completed = await workflow.executeRunAndFinalize(run.id);
  const spans = await repository.listTraceSpans(completed.id, { limit: 500 });
  const result = {
    taskId: task.id,
    runId: completed.id,
    status: completed.status,
    candidateVersionId: completed.candidateVersionId,
    objectiveGate: candidateAttemptForRun(completed)?.hardGate,
    appliedPatches: spans.filter((span) => span.kind === "tool_call" && span.name === "apply_patch" && span.status === "succeeded").length,
    writeFileCalls: spans.filter((span) => span.kind === "tool_call" && span.name === "write_file").length,
    usage: completed.usage,
    failure: completed.failureReason
  };
  results.push(result);
  await writeFile(reportPath, `${JSON.stringify({ schemaVersion: "site-edit-battery-report-v1", targetId: plan.targetId, siteId: site.id, results }, null, 2)}\n`);
  progress(task.id, "completed", { runId: completed.id, status: completed.status, objectiveGate: result.objectiveGate });
  if (completed.status !== "succeeded" || result.objectiveGate !== "passed" || result.appliedPatches < 1 || result.writeFileCalls !== 0) {
    throw new Error(`Edit battery stopped at ${task.id}; see ${reportPath}.`);
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, reportPath, results }, null, 2)}\n`);

function progress(taskId: string, stage: string, detail: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ type: "site_edit_battery_progress", targetId: plan.targetId, taskId, stage, at: new Date().toISOString(), ...detail })}\n`);
}
