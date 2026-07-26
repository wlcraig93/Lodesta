import "./load-env";
import {
  denverPlumberBakeoffId,
  ensureDenverPlumberBakeoff,
  getModelBakeoffView,
  modelBakeoffRepository,
  modelBakeoffRunSchema,
  refreshModelBakeoffAssessments,
  runModelBakeoffItem,
  updateModelBakeoffStatus
} from "@/packages/model-bakeoff";
import { processWebsiteAssessmentJobs } from "@/packages/website-assessment/jobs";

const concurrency = Math.max(1, Math.min(Number(process.env.MODEL_BAKEOFF_CONCURRENCY ?? "3"), 3));
let interrupted = false;
let creditExhausted = false;
process.once("SIGINT", () => { interrupted = true; });
process.once("SIGTERM", () => { interrupted = true; });

const experiment = await ensureDenverPlumberBakeoff();
const existing = await modelBakeoffRepository.listRuns(experiment.id);
for (const item of existing.filter((row) =>
  row.status === "building"
  || (experiment.status === "paused_credit" && row.status === "failed" && row.failureCode === "provider_quota_exhausted")
  || (row.status === "failed" && row.failureCode === "platform_version_mismatch")
)) {
    const now = new Date().toISOString();
    await modelBakeoffRepository.saveRun(modelBakeoffRunSchema.parse({
      ...item,
      status: "queued",
      failureCode: undefined,
      failureReason: undefined,
      completedAt: undefined,
      updatedAt: now
    }));
}
await updateModelBakeoffStatus(experiment.id);
const queued = (await modelBakeoffRepository.listRuns(experiment.id)).filter((item) => item.status === "queued");
log("experiment_started", { experimentId: experiment.id, queued: queued.length, concurrency });

let nextIndex = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, queued.length) }, async (_, workerIndex) => {
  while (!interrupted && !creditExhausted) {
    const item = queued[nextIndex++];
    if (!item) return;
    log("run_started", {
      worker: workerIndex + 1,
      ordinal: item.ordinal + 1,
      source: item.source.label,
      model: item.candidate.label,
      route: `${item.candidate.apiProvider}:${item.candidate.modelId}`
    });
    const result = await runModelBakeoffItem(item.id);
    log("run_finished", {
      worker: workerIndex + 1,
      ordinal: item.ordinal + 1,
      source: item.source.label,
      model: item.candidate.label,
      status: result.item.status,
      failureCode: result.item.failureCode
    });
    if (result.creditExhausted) {
      creditExhausted = true;
      log("credit_exhausted", {
        model: item.candidate.label,
        route: `${item.candidate.apiProvider}:${item.candidate.modelId}`
      });
    }
  }
}));

if (!creditExhausted && !interrupted) {
  for (let pass = 1; pass <= 24; pass += 1) {
    await refreshModelBakeoffAssessments(experiment.id);
    const assessing = (await modelBakeoffRepository.listRuns(experiment.id)).filter((item) => item.status === "assessing").length;
    if (!assessing) break;
    log("assessment_pass", { pass, assessing });
    const results = await processWebsiteAssessmentJobs({
      limit: 4,
      workerId: `model-bakeoff-${process.pid}-${pass}`
    });
    if (!results.length) break;
  }
  await refreshModelBakeoffAssessments(experiment.id);
}

const finalExperiment = await updateModelBakeoffStatus(experiment.id, { creditExhausted });
const view = await getModelBakeoffView(experiment.id);
log("experiment_finished", {
  experimentId: experiment.id,
  status: finalExperiment.status,
  interrupted,
  completed: view?.totals.completed,
  failed: view?.totals.failed,
  active: view?.totals.active,
  totalCostUsd: view?.totals.totalCostUsd,
  assessmentCostUsd: view?.totals.assessmentCostUsd
});

if (interrupted) process.exitCode = 130;

function log(event: string, detail: Record<string, unknown>) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...detail }));
}
