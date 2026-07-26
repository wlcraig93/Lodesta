import { getSupabaseAdminClient } from "@/lib/supabase/client";
import {
  modelBakeoffExperimentSchema,
  modelBakeoffRunSchema,
  type ModelBakeoffExperiment,
  type ModelBakeoffRun
} from "./contracts";

export interface ModelBakeoffRepository {
  createExperiment(experiment: ModelBakeoffExperiment, runs: ModelBakeoffRun[]): Promise<void>;
  getExperiment(id: string): Promise<ModelBakeoffExperiment | null>;
  listExperiments(): Promise<ModelBakeoffExperiment[]>;
  saveExperiment(experiment: ModelBakeoffExperiment): Promise<void>;
  getRun(id: string): Promise<ModelBakeoffRun | null>;
  listRuns(experimentId: string): Promise<ModelBakeoffRun[]>;
  saveRun(run: ModelBakeoffRun): Promise<void>;
}

class SupabaseModelBakeoffRepository implements ModelBakeoffRepository {
  private get client() {
    return getSupabaseAdminClient();
  }

  async createExperiment(experiment: ModelBakeoffExperiment, runs: ModelBakeoffRun[]) {
    const parsedExperiment = modelBakeoffExperimentSchema.parse(experiment);
    const parsedRuns = runs.map((run) => modelBakeoffRunSchema.parse(run));
    const existing = await this.getExperiment(parsedExperiment.id);
    if (existing) {
      if (JSON.stringify(existing.sources) !== JSON.stringify(parsedExperiment.sources)
        || JSON.stringify(existing.candidates) !== JSON.stringify(parsedExperiment.candidates)) {
        throw new Error("Model bake-off idempotency conflict.");
      }
      return;
    }
    await result(this.client.from("model_bakeoff_experiments").insert(experimentRow(parsedExperiment)), "Create model bake-off");
    await result(this.client.from("model_bakeoff_runs").insert(parsedRuns.map(runRow)), "Create model bake-off runs");
  }

  async getExperiment(id: string) {
    const response = await this.client.from("model_bakeoff_experiments").select("document").eq("id", id).maybeSingle();
    if (response.error) throw new Error(`Get model bake-off: ${response.error.message}`);
    const row = response.data as { document: unknown } | null;
    return row ? modelBakeoffExperimentSchema.parse(row.document) : null;
  }

  async listExperiments() {
    const rows = await result<Array<{ document: unknown }>>(
      this.client.from("model_bakeoff_experiments").select("document").order("created_at", { ascending: false }),
      "List model bake-offs"
    );
    return rows.map((row) => modelBakeoffExperimentSchema.parse(row.document));
  }

  async saveExperiment(experiment: ModelBakeoffExperiment) {
    const parsed = modelBakeoffExperimentSchema.parse(experiment);
    await result(this.client.from("model_bakeoff_experiments").upsert(experimentRow(parsed), { onConflict: "id" }), "Save model bake-off");
  }

  async getRun(id: string) {
    const response = await this.client.from("model_bakeoff_runs").select("document").eq("id", id).maybeSingle();
    if (response.error) throw new Error(`Get model bake-off run: ${response.error.message}`);
    const row = response.data as { document: unknown } | null;
    return row ? modelBakeoffRunSchema.parse(row.document) : null;
  }

  async listRuns(experimentId: string) {
    const rows = await result<Array<{ document: unknown }>>(
      this.client.from("model_bakeoff_runs").select("document").eq("experiment_id", experimentId).order("ordinal"),
      "List model bake-off runs"
    );
    return rows.map((row) => modelBakeoffRunSchema.parse(row.document));
  }

  async saveRun(run: ModelBakeoffRun) {
    const parsed = modelBakeoffRunSchema.parse(run);
    await result(this.client.from("model_bakeoff_runs").upsert(runRow(parsed), { onConflict: "id" }), "Save model bake-off run");
  }
}

function experimentRow(value: ModelBakeoffExperiment) {
  return {
    id: value.id,
    schema_version: value.schemaVersion,
    status: value.status,
    requested_by: value.requestedBy,
    document: value,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
    completed_at: value.completedAt ?? null
  };
}

function runRow(value: ModelBakeoffRun) {
  return {
    id: value.id,
    experiment_id: value.experimentId,
    schema_version: value.schemaVersion,
    ordinal: value.ordinal,
    source_key: value.source.key,
    candidate_key: value.candidate.key,
    status: value.status,
    site_id: value.siteId ?? null,
    run_id: value.runId ?? null,
    candidate_version_id: value.candidateVersionId ?? null,
    assessment_id: value.assessmentId ?? null,
    failure_code: value.failureCode ?? null,
    document: value,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
    completed_at: value.completedAt ?? null
  };
}

async function result<T = unknown>(
  promise: PromiseLike<unknown>,
  operation: string
) {
  const { data, error } = await promise as { data: T; error: { message: string } | null };
  if (error) throw new Error(`${operation}: ${error.message}`);
  return data;
}

export const modelBakeoffRepository: ModelBakeoffRepository = new SupabaseModelBakeoffRepository();
