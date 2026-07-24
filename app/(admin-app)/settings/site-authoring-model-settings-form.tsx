"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminButton, AdminButtonRow } from "@/components/admin/AdminButton";
import styles from "./site-authoring-model-settings-form.module.css";
import { ProductSelect } from "@/components/ProductUI";

type ModelProvider = "openai" | "openrouter";
type SiteAgentModelAvailability = "selectable" | "pricing_unconfigured" | "capabilities_missing";
type ModelOption = {
  id: string;
  name: string;
  ownedBy?: string;
  createdAt?: string;
  contextLength?: number;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  siteAgentAvailability: SiteAgentModelAvailability;
};
type ModelCatalog = {
  provider: ModelProvider;
  models: ModelOption[];
  fetchedAt: string;
};
type CatalogState =
  | { status: "idle" | "loading"; catalog?: ModelCatalog; error?: undefined }
  | { status: "ready"; catalog: ModelCatalog; error?: undefined }
  | { status: "error"; catalog?: ModelCatalog; error: string };
type SettingsSnapshot = {
  settings: { siteAgentProvider: ModelProvider; siteAgentModel: string; ingestionModel: string };
  version: number;
  source: string;
  updatedBy?: string;
  updatedAt?: string;
  warning?: string;
};

const staleMessage = "Settings changed since this page loaded. Reload and apply your changes again.";

export function SiteAuthoringModelSettingsForm({ initialSnapshot }: { initialSnapshot: SettingsSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [form, setForm] = useState(initialSnapshot.settings);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const openAiCatalog = useModelCatalog("openai", true);
  const openRouterCatalog = useModelCatalog("openrouter", form.siteAgentProvider === "openrouter");
  const siteAgentCatalog = form.siteAgentProvider === "openrouter" ? openRouterCatalog : openAiCatalog;

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    const response = await fetch("/api/operator/settings/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, version: snapshot.version })
    });
    const payload = await response.json().catch(() => null) as (Partial<SettingsSnapshot> & { error?: string; issues?: string[] }) | null;
    setSaving(false);
    if (!response.ok) {
      setStatus(response.status === 409 ? staleMessage : payload?.issues?.[0] ?? payload?.error ?? "Unable to save settings.");
      return;
    }
    const next = payload as SettingsSnapshot;
    setSnapshot(next);
    setForm(next.settings);
    setStatus("Settings saved.");
  }

  function selectProvider(provider: ModelProvider) {
    setForm((current) => ({
      ...current,
      siteAgentProvider: provider,
      siteAgentModel: modelIdForProvider(current.siteAgentModel, provider)
    }));
  }

  return (
    <form className="editor-form settings-form" onSubmit={saveSettings}>
      <label htmlFor="site-agent-provider">
        Website manager API provider
      </label>
      <ProductSelect
        id="site-agent-provider"
        value={form.siteAgentProvider}
        onChange={(event) => selectProvider(event.target.value as ModelProvider)}
      >
        <option value="openai">OpenAI (direct)</option>
        <option value="openrouter">OpenRouter</option>
      </ProductSelect>

      <ModelCatalogSelect
        id="site-agent-model"
        label="Website manager model"
        value={form.siteAgentModel}
        onChange={(siteAgentModel) => setForm((current) => ({ ...current, siteAgentModel }))}
        catalogState={siteAgentCatalog.state}
        retry={siteAgentCatalog.retry}
        siteAgentModelsOnly
      />

      <p className="muted">
        All website-manager models use high reasoning and low output verbosity.
        {form.siteAgentProvider === "openrouter"
          ? " OpenRouter automatically routes each tool-calling request among compatible zero-data-retention endpoints; Lodesta does not pin one upstream provider or force cheapest-only routing."
          : ""}
      </p>

      <ModelCatalogSelect
        id="ingestion-model"
        label="Business ingestion"
        value={form.ingestionModel}
        onChange={(ingestionModel) => setForm((current) => ({ ...current, ingestionModel }))}
        catalogState={openAiCatalog.state}
        retry={openAiCatalog.retry}
      />

      <AdminButtonRow>
        <AdminButton variant="primary" disabled={saving} type="submit">
          {saving ? "Saving..." : "Save settings"}
        </AdminButton>
      </AdminButtonRow>
      {status ? <p className="muted" role="status">{status}</p> : null}
    </form>
  );
}

function ModelCatalogSelect({
  id,
  label,
  value,
  onChange,
  catalogState,
  retry,
  siteAgentModelsOnly = false
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  catalogState: CatalogState;
  retry: () => void;
  siteAgentModelsOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const models = catalogState.catalog?.models ?? [];
  const selectableModels = useMemo(
    () => siteAgentModelsOnly
      ? models.filter((model) => model.siteAgentAvailability === "selectable")
      : models,
    [models, siteAgentModelsOnly]
  );
  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return selectableModels;
    return selectableModels.filter((model) =>
      model.id.toLocaleLowerCase().includes(normalizedQuery)
      || model.name.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [query, selectableModels]);
  const currentModel = models.find((model) => model.id === value);
  const currentIsVisible = visibleModels.some((model) => model.id === value);
  const currentIsSelectable = !siteAgentModelsOnly || currentModel?.siteAgentAvailability === "selectable";
  const descriptionId = `${id}-description`;
  const selectionDescription = currentIsSelectable
    ? describeModel(currentModel)
    : "The saved model is not approved for the current website-manager route.";

  return (
    <div className={styles.catalogField}>
      <div className={styles.fieldHeading}>
        <label htmlFor={id}>{label}</label>
        {catalogState.status === "ready" ? (
          <span>{modelCountLabel(selectableModels.length)}</span>
        ) : null}
      </div>

      {catalogState.status === "ready" && selectableModels.length > 12 ? (
        <input
          aria-label={`Filter ${label.toLocaleLowerCase()} options`}
          className={styles.catalogSearch}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Filter ${selectableModels.length.toLocaleString()} models`}
        />
      ) : null}

      <ProductSelect
        id={id}
        aria-describedby={descriptionId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={catalogState.status !== "ready"}
      >
        {!currentIsVisible ? (
          <option value={value} hidden>{currentModel ? `Current · ${modelLabel(currentModel)}` : `Current · ${value}`}</option>
        ) : null}
        {visibleModels.map((model) => (
          <option key={model.id} value={model.id}>{modelLabel(model)}</option>
        ))}
      </ProductSelect>

      <div className={styles.catalogDescription} id={descriptionId}>
        {catalogState.status === "loading" || catalogState.status === "idle" ? (
          <small>Loading models available to the configured provider key…</small>
        ) : null}
        {catalogState.status === "error" ? (
          <>
            <small role="alert">{catalogState.error}</small>
            <AdminButton variant="ghost" size="sm" type="button" onClick={retry}>Retry catalog</AdminButton>
          </>
        ) : null}
        {catalogState.status === "ready" ? (
          <small>
            {query ? `${visibleModels.length.toLocaleString()} matching. ` : ""}
            {selectionDescription}
            {siteAgentModelsOnly
              ? " Only models approved for Lodesta website-manager runs are listed."
              : " Catalog supplied by OpenAI for the configured API key."}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function useModelCatalog(provider: ModelProvider, enabled: boolean) {
  const [state, setState] = useState<CatalogState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || state.status === "ready") return;
    const controller = new AbortController();
    setState((current) => ({ status: "loading", catalog: current.catalog }));
    void fetch(`/api/operator/settings/models/catalog?provider=${provider}`, {
      cache: "no-store",
      signal: controller.signal
    }).then(async (response) => {
      const payload = await response.json().catch(() => null) as (ModelCatalog & { error?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.error ?? "Unable to load the model catalog.");
      setState({ status: "ready", catalog: payload });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setState((current) => ({
        status: "error",
        catalog: current.catalog,
        error: error instanceof Error ? error.message : "Unable to load the model catalog."
      }));
    });
    return () => controller.abort();
  }, [attempt, enabled, provider]);

  return {
    state,
    retry: () => {
      setState((current) => ({ status: "idle", catalog: current.catalog }));
      setAttempt((current) => current + 1);
    }
  };
}

function modelIdForProvider(modelId: string, provider: ModelProvider) {
  if (provider === "openrouter" && !modelId.includes("/")) return `openai/${modelId}`;
  if (provider === "openai" && modelId.startsWith("openai/")) return modelId.slice("openai/".length);
  return modelId;
}

function modelLabel(model: ModelOption | undefined) {
  if (!model) return "";
  return model.name === model.id ? model.id : `${model.name} · ${model.id}`;
}

function modelCountLabel(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? "model" : "models"}`;
}

function describeModel(model: ModelOption | undefined) {
  if (!model) return "The saved model is not present in the latest catalog.";
  const details = [
    model.contextLength ? `${compactNumber(model.contextLength)} context` : undefined,
    model.inputUsdPerMillion !== undefined && model.outputUsdPerMillion !== undefined
      ? `$${formatPrice(model.inputUsdPerMillion)} input / $${formatPrice(model.outputUsdPerMillion)} output per 1M tokens`
      : undefined
  ].filter(Boolean);
  return details.length ? `${details.join(" · ")}.` : "Selected from the provider's current catalog.";
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPrice(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 3 : 2 });
}
