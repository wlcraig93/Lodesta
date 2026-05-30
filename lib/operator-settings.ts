import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { getSupabaseAdminClient } from "./supabase/client";

export const OPENAI_RUNTIME_SETTING_KEY = "openai_runtime";
export const OPENAI_IMAGE_OUTPUT_FORMAT = "jpeg";
export const OPENAI_RUNTIME_DEFAULTS = {
  generationModel: "gpt-5.5",
  visualQaModel: "gpt-5.5",
  imageModel: "gpt-image-2",
  imageSize: "1536x1024",
  imageQuality: "low",
  mockupLimit: 3
} as const;

const CACHE_TTL_MS = 60_000;
const LKG_MAX_AGE_MS = 10 * 60_000;
const LOCAL_SETTINGS_FILE = join(process.cwd(), ".data", "operator-settings.json");
const IMAGE_SIZE_ERROR =
  "Image size must be auto or WIDTHxHEIGHT within the current gpt-image-2 constraints.";

export type OpenAiImageQuality = "low" | "medium" | "high" | "auto";
export type OpenAiRuntimeEditableSettings = {
  generationModel: string;
  visualQaModel: string;
  imageModel: string;
  imageSize: string;
  imageQuality: OpenAiImageQuality;
  mockupLimit: number;
};
export type OpenAiRuntimeSettings = OpenAiRuntimeEditableSettings & {
  imageFormat: typeof OPENAI_IMAGE_OUTPUT_FORMAT;
};
export type OperatorSettingsSource = "db" | "file" | "cache" | "lkg" | "default";
export type OpenAiRuntimeSettingsSnapshot = {
  settings: OpenAiRuntimeSettings;
  version: number;
  source: OperatorSettingsSource;
  updatedBy?: string;
  updatedAt?: string;
  warning?: string;
};

type StoredOperatorSetting = {
  value: OpenAiRuntimeEditableSettings;
  version: number;
  updatedBy?: string;
  updatedAt?: string;
  source: "db" | "file" | "default";
};

type LocalOperatorSettingRow = {
  value: unknown;
  version: number;
  updatedBy?: string;
  updatedAt?: string;
};

type LocalAuditRow = {
  id: string;
  settingKey: string;
  status: "changed" | "rejected";
  changedBy: string;
  changedAt: string;
  previousValue?: unknown;
  newValue?: unknown;
  error?: string;
};

type LocalOperatorSettingsFile = {
  settings?: Record<string, LocalOperatorSettingRow>;
  audits?: LocalAuditRow[];
};

type CachedOpenAiRuntimeSettings = {
  snapshot: OpenAiRuntimeSettingsSnapshot;
  fetchedAt: number;
};

const globalCache = globalThis as typeof globalThis & {
  __lodestaOpenAiRuntimeSettingsCache?: CachedOpenAiRuntimeSettings;
  __lodestaOperatorSettingsLocalFileForTests?: string;
};

const modelSlugSchema = z
  .string()
  .trim()
  .min(1, "Model is required.")
  .regex(/^[A-Za-z0-9._:-]+$/, "Model must be a slug using letters, numbers, '.', '_', '-', or ':'.");

const imageQualitySchema = z.enum(["low", "medium", "high", "auto"]);

const imageSizeSchema = z.string().trim().refine((value) => validateOpenAiImageSize(value).ok, {
  message: IMAGE_SIZE_ERROR
});

const openAiRuntimeSettingsSchema = z.object({
  generationModel: modelSlugSchema,
  visualQaModel: modelSlugSchema,
  imageModel: modelSlugSchema,
  imageSize: imageSizeSchema,
  imageQuality: imageQualitySchema,
  mockupLimit: z.coerce.number().int().min(1).max(3)
});

const openAiRuntimeSettingsUpdateSchema = openAiRuntimeSettingsSchema.extend({
  version: z.coerce.number().int().min(0)
});

export class StaleOperatorSettingsError extends Error {
  constructor() {
    super("Settings changed since this page loaded. Reload and apply your changes again.");
    this.name = "StaleOperatorSettingsError";
  }
}

export function defaultOpenAiRuntimeSettings(): OpenAiRuntimeSettings {
  return withImageFormat({ ...OPENAI_RUNTIME_DEFAULTS });
}

export function defaultOpenAiRuntimeEditableSettings(): OpenAiRuntimeEditableSettings {
  return { ...OPENAI_RUNTIME_DEFAULTS };
}

export function resetOpenAiRuntimeSettingsCacheForTests() {
  delete globalCache.__lodestaOpenAiRuntimeSettingsCache;
}

export function setOperatorSettingsLocalFileForTests(filePath: string | undefined) {
  if (filePath) {
    globalCache.__lodestaOperatorSettingsLocalFileForTests = filePath;
  } else {
    delete globalCache.__lodestaOperatorSettingsLocalFileForTests;
  }
  resetOpenAiRuntimeSettingsCacheForTests();
}

export function validateOpenAiRuntimeSettingsInput(input: unknown) {
  const parsed = openAiRuntimeSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, issues: parsed.error.issues.map((issue) => issue.message) };
  }
  return { ok: true as const, settings: parsed.data };
}

export function validateOpenAiRuntimeSettingsUpdateInput(input: unknown) {
  const parsed = openAiRuntimeSettingsUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, issues: parsed.error.issues.map((issue) => issue.message) };
  }
  const { version, ...settings } = parsed.data;
  return { ok: true as const, settings, version };
}

export function validateOpenAiImageSize(value: string) {
  const trimmed = value.trim();
  if (trimmed === "auto") return { ok: true as const };

  const match = /^(\d+)x(\d+)$/.exec(trimmed);
  if (!match) return { ok: false as const, reason: IMAGE_SIZE_ERROR };

  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const totalPixels = width * height;

  // Keep aligned with OpenAI's gpt-image-2 output constraints:
  // https://developers.openai.com/api/docs/guides/image-generation#customize-image-output
  if (longEdge > 3840) return { ok: false as const, reason: IMAGE_SIZE_ERROR };
  if (width % 16 !== 0 || height % 16 !== 0) return { ok: false as const, reason: IMAGE_SIZE_ERROR };
  if (longEdge / shortEdge > 3) return { ok: false as const, reason: IMAGE_SIZE_ERROR };
  if (totalPixels < 655_360 || totalPixels > 8_294_400) {
    return { ok: false as const, reason: IMAGE_SIZE_ERROR };
  }
  return { ok: true as const };
}

export async function getOpenAiRuntimeSettings(
  options: { bypassCache?: boolean } = {}
): Promise<OpenAiRuntimeSettingsSnapshot> {
  const now = Date.now();
  const cached = globalCache.__lodestaOpenAiRuntimeSettingsCache;
  if (!options.bypassCache && cached && now - cached.fetchedAt <= CACHE_TTL_MS) {
    return { ...cached.snapshot, source: "cache" };
  }

  try {
    const stored = await readStoredOpenAiRuntimeSettings();
    const snapshot: OpenAiRuntimeSettingsSnapshot = {
      settings: withImageFormat(stored.value),
      version: stored.version,
      source: stored.source,
      updatedBy: stored.updatedBy,
      updatedAt: stored.updatedAt
    };
    globalCache.__lodestaOpenAiRuntimeSettingsCache = { snapshot, fetchedAt: now };
    return snapshot;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    if (cached && now - cached.fetchedAt <= LKG_MAX_AGE_MS) {
      return {
        ...cached.snapshot,
        source: "lkg",
        warning: `OpenAI operator settings read failed; using last-known-good settings. ${message}`
      };
    }
    return {
      settings: defaultOpenAiRuntimeSettings(),
      version: 0,
      source: "default",
      warning: `OpenAI operator settings read failed; using code defaults. ${message}`
    };
  }
}

export async function saveOpenAiRuntimeSettings(input: {
  settings: OpenAiRuntimeEditableSettings;
  expectedVersion: number;
  changedBy: string;
}) {
  const current = await readStoredOpenAiRuntimeSettings();
  if (current.version !== input.expectedVersion) {
    await recordOperatorSettingAudit({
      status: "rejected",
      changedBy: input.changedBy,
      previousValue: current.value,
      newValue: input.settings,
      error: "stale_settings"
    });
    throw new StaleOperatorSettingsError();
  }

  const row = await writeStoredOpenAiRuntimeSettings({
    settings: input.settings,
    expectedVersion: input.expectedVersion,
    changedBy: input.changedBy
  });
  await recordOperatorSettingAudit({
    status: "changed",
    changedBy: input.changedBy,
    previousValue: current.value,
    newValue: input.settings
  });
  return cacheSnapshot(row);
}

export async function seedOpenAiRuntimeSettings(input: {
  settings: OpenAiRuntimeEditableSettings;
  changedBy?: string;
}) {
  const current = await readStoredOpenAiRuntimeSettings();
  if (current.version > 0 && settingsEqual(current.value, input.settings)) {
    return { changed: false as const, snapshot: cacheSnapshot(current) };
  }

  const row = await upsertStoredOpenAiRuntimeSettings({
    settings: input.settings,
    changedBy: input.changedBy ?? "seed:openai-settings"
  });
  await recordOperatorSettingAudit({
    status: "changed",
    changedBy: input.changedBy ?? "seed:openai-settings",
    previousValue: current.value,
    newValue: input.settings
  });
  return { changed: true as const, snapshot: cacheSnapshot(row) };
}

export async function auditOpenAiRuntimeSettingsRejection(input: {
  changedBy: string;
  attemptedValue?: unknown;
  error: string;
}) {
  await recordOperatorSettingAudit({
    status: "rejected",
    changedBy: input.changedBy,
    newValue: input.attemptedValue,
    error: input.error
  });
}

function cacheSnapshot(row: StoredOperatorSetting): OpenAiRuntimeSettingsSnapshot {
  const snapshot: OpenAiRuntimeSettingsSnapshot = {
    settings: withImageFormat(row.value),
    version: row.version,
    source: row.source,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt
  };
  globalCache.__lodestaOpenAiRuntimeSettingsCache = { snapshot, fetchedAt: Date.now() };
  return snapshot;
}

function withImageFormat(settings: OpenAiRuntimeEditableSettings): OpenAiRuntimeSettings {
  return { ...settings, imageFormat: OPENAI_IMAGE_OUTPUT_FORMAT };
}

function parseStoredValue(value: unknown): OpenAiRuntimeEditableSettings {
  const parsed = openAiRuntimeSettingsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Stored OpenAI operator settings are invalid: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`);
  }
  return parsed.data;
}

async function readStoredOpenAiRuntimeSettings(): Promise<StoredOperatorSetting> {
  if (useSupabaseSettingsStore()) return readSupabaseOpenAiRuntimeSettings();
  return readLocalOpenAiRuntimeSettings();
}

async function writeStoredOpenAiRuntimeSettings(input: {
  settings: OpenAiRuntimeEditableSettings;
  expectedVersion: number;
  changedBy: string;
}): Promise<StoredOperatorSetting> {
  if (useSupabaseSettingsStore()) return writeSupabaseOpenAiRuntimeSettings(input);
  return writeLocalOpenAiRuntimeSettings(input);
}

async function upsertStoredOpenAiRuntimeSettings(input: {
  settings: OpenAiRuntimeEditableSettings;
  changedBy: string;
}): Promise<StoredOperatorSetting> {
  const current = await readStoredOpenAiRuntimeSettings();
  if (useSupabaseSettingsStore()) {
    if (current.version === 0) {
      return writeSupabaseOpenAiRuntimeSettings({ ...input, expectedVersion: 0 });
    }
    return updateSupabaseOpenAiRuntimeSettings({ ...input, expectedVersion: current.version });
  }
  return writeLocalOpenAiRuntimeSettings({ ...input, expectedVersion: current.version });
}

function useSupabaseSettingsStore() {
  if (process.env.LODESTA_REPOSITORY === "local") return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function readSupabaseOpenAiRuntimeSettings(): Promise<StoredOperatorSetting> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("operator_settings")
    .select("key,value,version,updated_by,updated_at")
    .eq("key", OPENAI_RUNTIME_SETTING_KEY)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    return { value: defaultOpenAiRuntimeEditableSettings(), version: 0, source: "default" };
  }

  const row = data as {
    value: unknown;
    version: number;
    updated_by?: string | null;
    updated_at?: string | null;
  };
  return {
    value: parseStoredValue(row.value),
    version: row.version,
    updatedBy: row.updated_by ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    source: "db"
  };
}

async function writeSupabaseOpenAiRuntimeSettings(input: {
  settings: OpenAiRuntimeEditableSettings;
  expectedVersion: number;
  changedBy: string;
}): Promise<StoredOperatorSetting> {
  if (input.expectedVersion === 0) {
    const now = new Date().toISOString();
    const { data, error } = await getSupabaseAdminClient()
      .from("operator_settings")
      .insert({
        key: OPENAI_RUNTIME_SETTING_KEY,
        value: input.settings,
        version: 1,
        updated_by: input.changedBy,
        updated_at: now
      })
      .select("value,version,updated_by,updated_at")
      .single();

    if (error) {
      if (error.code === "23505") throw new StaleOperatorSettingsError();
      throw new Error(error.message);
    }
    return mapSupabaseSettingsRow(data);
  }

  return updateSupabaseOpenAiRuntimeSettings(input);
}

async function updateSupabaseOpenAiRuntimeSettings(input: {
  settings: OpenAiRuntimeEditableSettings;
  expectedVersion: number;
  changedBy: string;
}): Promise<StoredOperatorSetting> {
  const { data, error } = await getSupabaseAdminClient()
    .from("operator_settings")
    .update({
      value: input.settings,
      version: input.expectedVersion + 1,
      updated_by: input.changedBy,
      updated_at: new Date().toISOString()
    })
    .eq("key", OPENAI_RUNTIME_SETTING_KEY)
    .eq("version", input.expectedVersion)
    .select("value,version,updated_by,updated_at")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new StaleOperatorSettingsError();
  return mapSupabaseSettingsRow(data);
}

function mapSupabaseSettingsRow(data: unknown): StoredOperatorSetting {
  const row = data as {
    value: unknown;
    version: number;
    updated_by?: string | null;
    updated_at?: string | null;
  };
  return {
    value: parseStoredValue(row.value),
    version: row.version,
    updatedBy: row.updated_by ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    source: "db"
  };
}

async function readLocalOpenAiRuntimeSettings(): Promise<StoredOperatorSetting> {
  const file = await readLocalOperatorSettingsFile();
  const row = file.settings?.[OPENAI_RUNTIME_SETTING_KEY];
  if (!row) {
    return { value: defaultOpenAiRuntimeEditableSettings(), version: 0, source: "default" };
  }
  return {
    value: parseStoredValue(row.value),
    version: row.version,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
    source: "file"
  };
}

async function writeLocalOpenAiRuntimeSettings(input: {
  settings: OpenAiRuntimeEditableSettings;
  expectedVersion: number;
  changedBy: string;
}): Promise<StoredOperatorSetting> {
  const file = await readLocalOperatorSettingsFile();
  const current = file.settings?.[OPENAI_RUNTIME_SETTING_KEY];
  const currentVersion = current?.version ?? 0;
  if (currentVersion !== input.expectedVersion) throw new StaleOperatorSettingsError();

  const updatedAt = new Date().toISOString();
  const version = input.expectedVersion + 1;
  file.settings = {
    ...(file.settings ?? {}),
    [OPENAI_RUNTIME_SETTING_KEY]: {
      value: input.settings,
      version,
      updatedBy: input.changedBy,
      updatedAt
    }
  };
  await writeLocalOperatorSettingsFile(file);
  return {
    value: input.settings,
    version,
    updatedBy: input.changedBy,
    updatedAt,
    source: "file"
  };
}

async function recordOperatorSettingAudit(input: {
  status: "changed" | "rejected";
  changedBy: string;
  previousValue?: unknown;
  newValue?: unknown;
  error?: string;
}) {
  if (useSupabaseSettingsStore()) {
    const { error } = await getSupabaseAdminClient().from("operator_setting_audits").insert({
      id: `operator_setting_audit_${crypto.randomUUID()}`,
      setting_key: OPENAI_RUNTIME_SETTING_KEY,
      status: input.status,
      changed_by: input.changedBy,
      changed_at: new Date().toISOString(),
      previous_value: input.previousValue,
      new_value: input.newValue,
      error: input.error
    });
    if (error) throw new Error(error.message);
    return;
  }

  const file = await readLocalOperatorSettingsFile();
  file.audits = [
    {
      id: `operator_setting_audit_${crypto.randomUUID()}`,
      settingKey: OPENAI_RUNTIME_SETTING_KEY,
      status: input.status,
      changedBy: input.changedBy,
      changedAt: new Date().toISOString(),
      previousValue: input.previousValue,
      newValue: input.newValue,
      error: input.error
    },
    ...(file.audits ?? [])
  ].slice(0, 500);
  await writeLocalOperatorSettingsFile(file);
}

async function readLocalOperatorSettingsFile(): Promise<LocalOperatorSettingsFile> {
  try {
    return JSON.parse(await readFile(localSettingsFile(), "utf8")) as LocalOperatorSettingsFile;
  } catch (caught) {
    if (isNodeError(caught) && caught.code === "ENOENT") return {};
    throw caught;
  }
}

async function writeLocalOperatorSettingsFile(file: LocalOperatorSettingsFile) {
  const filePath = localSettingsFile();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`);
}

function localSettingsFile() {
  return globalCache.__lodestaOperatorSettingsLocalFileForTests ?? LOCAL_SETTINGS_FILE;
}

function settingsEqual(left: OpenAiRuntimeEditableSettings, right: OpenAiRuntimeEditableSettings) {
  return (
    left.generationModel === right.generationModel &&
    left.visualQaModel === right.visualQaModel &&
    left.imageModel === right.imageModel &&
    left.imageSize === right.imageSize &&
    left.imageQuality === right.imageQuality &&
    left.mockupLimit === right.mockupLimit
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}
