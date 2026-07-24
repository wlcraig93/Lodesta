import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { isSupportedSiteAgentModel } from "@/packages/site-agent/run-policy";
import { siteAgentApiProviderSchema } from "@/packages/site-contracts";
import { getSupabaseAdminClient } from "./supabase/client";

export const SITE_AUTHORING_MODEL_SETTING_KEY = "site_authoring_models";
export const SITE_AUTHORING_MODEL_DEFAULTS = {
  siteAgentProvider: "openai",
  siteAgentModel: "gpt-5.6-sol",
  ingestionModel: "gpt-5.6-sol"
} as const;

const cacheTtlMs = 60_000;
const lkgMaxAgeMs = 10 * 60_000;
const localSettingsFile = join(process.cwd(), ".data", "operator-settings.json");
const modelSlugSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._~:/-]+$/, "Model must be a valid model slug.");
const settingsObjectSchema = z.object({
  siteAgentProvider: siteAgentApiProviderSchema,
  siteAgentModel: modelSlugSchema,
  ingestionModel: modelSlugSchema
}).strict();
function refineSettings(
  value: z.infer<typeof settingsObjectSchema>,
  context: z.RefinementCtx
) {
  if (value.siteAgentProvider === "openai" && !isSupportedSiteAgentModel(value.siteAgentModel)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["siteAgentModel"], message: "Direct OpenAI site agent models must have a configured pricing entry." });
  }
  if (value.siteAgentProvider === "openrouter" && !value.siteAgentModel.includes("/")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["siteAgentModel"], message: "OpenRouter models must use a provider-qualified slug such as openai/gpt-5." });
  }
}
const settingsSchema = settingsObjectSchema.superRefine(refineSettings);
const updateSchema = settingsObjectSchema.extend({ version: z.coerce.number().int().min(0) }).superRefine(refineSettings);

export type SiteAuthoringModelSettings = z.infer<typeof settingsSchema>;
export type SiteAuthoringModelSettingsSource = "db" | "file" | "cache" | "lkg" | "default";
export type SiteAuthoringModelSettingsSnapshot = {
  settings: SiteAuthoringModelSettings;
  version: number;
  source: SiteAuthoringModelSettingsSource;
  updatedBy?: string;
  updatedAt?: string;
  warning?: string;
};

type StoredSetting = {
  value: SiteAuthoringModelSettings;
  version: number;
  updatedBy?: string;
  updatedAt?: string;
  source: "db" | "file" | "default";
};

type LocalSettingsFile = {
  settings?: Record<string, { value: unknown; version: number; updatedBy?: string; updatedAt?: string }>;
  audits?: Array<{
    id: string;
    settingKey: string;
    status: "changed" | "rejected";
    changedBy: string;
    changedAt: string;
    previousValue?: unknown;
    newValue?: unknown;
    error?: string;
  }>;
};

const globalCache = globalThis as typeof globalThis & {
  __lodestaSiteAuthoringModelSettings?: { snapshot: SiteAuthoringModelSettingsSnapshot; fetchedAt: number };
  __lodestaOperatorSettingsLocalFileForTests?: string;
};

export class StaleOperatorSettingsError extends Error {
  constructor() {
    super("Settings changed since this page loaded. Reload and apply your changes again.");
    this.name = "StaleOperatorSettingsError";
  }
}

export function defaultSiteAuthoringModelSettings(): SiteAuthoringModelSettings {
  return { ...SITE_AUTHORING_MODEL_DEFAULTS };
}

export function resetSiteAuthoringModelSettingsCacheForTests() {
  delete globalCache.__lodestaSiteAuthoringModelSettings;
}

export function setOperatorSettingsLocalFileForTests(filePath: string | undefined) {
  if (filePath) globalCache.__lodestaOperatorSettingsLocalFileForTests = filePath;
  else delete globalCache.__lodestaOperatorSettingsLocalFileForTests;
  resetSiteAuthoringModelSettingsCacheForTests();
}

export function validateSiteAuthoringModelSettingsUpdate(input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, issues: parsed.error.issues.map((issue) => issue.message) };
  const { version, ...settings } = parsed.data;
  return { ok: true as const, settings, version };
}

export async function getSiteAuthoringModelSettings(options: { bypassCache?: boolean } = {}): Promise<SiteAuthoringModelSettingsSnapshot> {
  const now = Date.now();
  const cached = globalCache.__lodestaSiteAuthoringModelSettings;
  if (!options.bypassCache && cached && now - cached.fetchedAt <= cacheTtlMs) {
    return { ...cached.snapshot, source: "cache" };
  }
  try {
    return cacheSnapshot(await readStoredSetting());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cached && now - cached.fetchedAt <= lkgMaxAgeMs) {
      return { ...cached.snapshot, source: "lkg", warning: `Model settings read failed; using last-known-good settings. ${message}` };
    }
    return { settings: defaultSiteAuthoringModelSettings(), version: 0, source: "default", warning: `Model settings read failed; using code defaults. ${message}` };
  }
}

export async function saveSiteAuthoringModelSettings(input: {
  settings: SiteAuthoringModelSettings;
  expectedVersion: number;
  changedBy: string;
}) {
  const current = await readStoredSetting();
  if (current.version !== input.expectedVersion) {
    await recordAudit({ status: "rejected", changedBy: input.changedBy, previousValue: current.value, newValue: input.settings, error: "stale_settings" });
    throw new StaleOperatorSettingsError();
  }
  const row = await writeStoredSetting(input);
  await recordAudit({ status: "changed", changedBy: input.changedBy, previousValue: current.value, newValue: input.settings });
  return cacheSnapshot(row);
}

export async function auditSiteAuthoringModelSettingsRejection(input: { changedBy: string; attemptedValue?: unknown; error: string }) {
  await recordAudit({ status: "rejected", changedBy: input.changedBy, newValue: input.attemptedValue, error: input.error });
}

function cacheSnapshot(row: StoredSetting): SiteAuthoringModelSettingsSnapshot {
  const snapshot: SiteAuthoringModelSettingsSnapshot = {
    settings: row.value,
    version: row.version,
    source: row.source,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt
  };
  globalCache.__lodestaSiteAuthoringModelSettings = { snapshot, fetchedAt: Date.now() };
  return snapshot;
}

function parseValue(value: unknown) {
  const parsed = settingsSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Stored site-authoring model settings are invalid: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`);
  return parsed.data;
}

function useSupabase() {
  if (globalCache.__lodestaOperatorSettingsLocalFileForTests || process.env.LODESTA_REPOSITORY === "local") return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function readStoredSetting(): Promise<StoredSetting> {
  if (!useSupabase()) {
    const file = await readLocalFile();
    const row = file.settings?.[SITE_AUTHORING_MODEL_SETTING_KEY];
    return row
      ? { value: parseValue(row.value), version: row.version, updatedBy: row.updatedBy, updatedAt: row.updatedAt, source: "file" }
      : { value: defaultSiteAuthoringModelSettings(), version: 0, source: "default" };
  }
  const { data, error } = await getSupabaseAdminClient()
    .from("operator_settings")
    .select("value,version,updated_by,updated_at")
    .eq("key", SITE_AUTHORING_MODEL_SETTING_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { value: defaultSiteAuthoringModelSettings(), version: 0, source: "default" };
  return mapSupabaseRow(data);
}

async function writeStoredSetting(input: { settings: SiteAuthoringModelSettings; expectedVersion: number; changedBy: string }): Promise<StoredSetting> {
  if (!useSupabase()) {
    const file = await readLocalFile();
    const currentVersion = file.settings?.[SITE_AUTHORING_MODEL_SETTING_KEY]?.version ?? 0;
    if (currentVersion !== input.expectedVersion) throw new StaleOperatorSettingsError();
    const updatedAt = new Date().toISOString();
    const version = input.expectedVersion + 1;
    file.settings = { ...(file.settings ?? {}), [SITE_AUTHORING_MODEL_SETTING_KEY]: { value: input.settings, version, updatedBy: input.changedBy, updatedAt } };
    await writeLocalFile(file);
    return { value: input.settings, version, updatedBy: input.changedBy, updatedAt, source: "file" };
  }
  if (input.expectedVersion === 0) {
    const updatedAt = new Date().toISOString();
    const { data, error } = await getSupabaseAdminClient().from("operator_settings").insert({
      key: SITE_AUTHORING_MODEL_SETTING_KEY,
      value: input.settings,
      version: 1,
      updated_by: input.changedBy,
      updated_at: updatedAt
    }).select("value,version,updated_by,updated_at").single();
    if (error?.code === "23505") throw new StaleOperatorSettingsError();
    if (error) throw new Error(error.message);
    return mapSupabaseRow(data);
  }
  const { data, error } = await getSupabaseAdminClient().from("operator_settings").update({
    value: input.settings,
    version: input.expectedVersion + 1,
    updated_by: input.changedBy,
    updated_at: new Date().toISOString()
  }).eq("key", SITE_AUTHORING_MODEL_SETTING_KEY).eq("version", input.expectedVersion)
    .select("value,version,updated_by,updated_at").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new StaleOperatorSettingsError();
  return mapSupabaseRow(data);
}

function mapSupabaseRow(data: unknown): StoredSetting {
  const row = data as { value: unknown; version: number; updated_by?: string | null; updated_at?: string | null };
  return { value: parseValue(row.value), version: row.version, updatedBy: row.updated_by ?? undefined, updatedAt: row.updated_at ?? undefined, source: "db" };
}

async function recordAudit(input: { status: "changed" | "rejected"; changedBy: string; previousValue?: unknown; newValue?: unknown; error?: string }) {
  const changedAt = new Date().toISOString();
  if (useSupabase()) {
    const { error } = await getSupabaseAdminClient().from("operator_setting_audits").insert({
      id: `operator_setting_audit_${crypto.randomUUID()}`,
      setting_key: SITE_AUTHORING_MODEL_SETTING_KEY,
      status: input.status,
      changed_by: input.changedBy,
      changed_at: changedAt,
      previous_value: input.previousValue,
      new_value: input.newValue,
      error: input.error
    });
    if (error) throw new Error(error.message);
    return;
  }
  const file = await readLocalFile();
  file.audits = [{ id: `operator_setting_audit_${crypto.randomUUID()}`, settingKey: SITE_AUTHORING_MODEL_SETTING_KEY, changedAt, ...input }, ...(file.audits ?? [])].slice(0, 500);
  await writeLocalFile(file);
}

async function readLocalFile(): Promise<LocalSettingsFile> {
  try {
    return JSON.parse(await readFile(globalCache.__lodestaOperatorSettingsLocalFileForTests ?? localSettingsFile, "utf8")) as LocalSettingsFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeLocalFile(file: LocalSettingsFile) {
  const path = globalCache.__lodestaOperatorSettingsLocalFileForTests ?? localSettingsFile;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
}
