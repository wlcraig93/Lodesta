"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { ProductDialog } from "@/components/ProductDialog";
import { ProductSelect } from "@/components/ProductUI";
import {
  type SiteCreationModelCatalog,
  type SiteCreationModelOption
} from "@/lib/site-creation-models";

type DuplicateProject = { id: string; name: string; status: string; href: string };
type ModelCatalogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; catalog: SiteCreationModelCatalog };

export function WebsiteOnboardingForm() {
  const router = useRouter();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [duplicateProjects, setDuplicateProjects] = useState<DuplicateProject[]>([]);
  const [duplicateError, setDuplicateError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [initialBuildModelId, setInitialBuildModelId] = useState("");
  const [modelError, setModelError] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [modelCatalogAttempt, setModelCatalogAttempt] = useState(0);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogState>({ status: "loading" });
  const sourceErrorId = useId();
  const modelDescriptionId = useId();
  const modelErrorId = useId();
  const pendingSource = useRef("");
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const duplicateCancelRef = useRef<HTMLButtonElement>(null);
  const catalogModels = modelCatalog.status === "ready" ? modelCatalog.catalog.models : [];
  const selectedModel = catalogModels.find((model) => model.id === initialBuildModelId);
  const visibleModels = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase();
    if (!query) return catalogModels;
    const filtered = catalogModels.filter((model) =>
      model.id.toLocaleLowerCase().includes(query)
      || model.name.toLocaleLowerCase().includes(query)
    );
    if (selectedModel && !filtered.some((model) => model.id === selectedModel.id)) {
      return [selectedModel, ...filtered];
    }
    return filtered;
  }, [catalogModels, modelQuery, selectedModel]);

  useEffect(() => {
    const controller = new AbortController();
    setModelCatalog({ status: "loading" });
    void fetch("/api/website-setups/models", {
      cache: "no-store",
      signal: controller.signal
    }).then(async (response) => {
      const result = await response.json().catch(() => ({})) as Partial<SiteCreationModelCatalog> & { error?: string };
      if (!response.ok || result.provider !== "openrouter" || !Array.isArray(result.models)) {
        throw new Error(result.error ?? "The OpenRouter model catalog could not be loaded.");
      }
      setModelCatalog({
        status: "ready",
        catalog: {
          provider: result.provider,
          models: result.models,
          fetchedAt: typeof result.fetchedAt === "string" ? result.fetchedAt : new Date().toISOString()
        }
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setModelCatalog({
        status: "error",
        message: error instanceof Error ? error.message : "The OpenRouter model catalog could not be loaded."
      });
    });
    return () => controller.abort();
  }, [modelCatalogAttempt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const source = String(form.get("sourceUrl") ?? "").trim();
    if (!source) {
      setSourceError("Paste your website address to get started.");
      setStatus("");
      sourceInputRef.current?.focus();
      return;
    }
    if (!initialBuildModelId) {
      setModelError("Choose the OpenRouter model to use for this initial build.");
      setStatus("");
      document.getElementById("initialBuildModelId")?.focus();
      return;
    }
    setSourceError("");
    setModelError("");
    pendingSource.current = source;
    await create(false);
  }

  async function create(confirmDuplicate: boolean) {
    setSubmitting(true);
    setDuplicateError("");
    setStatus("Checking this website…");
    try {
      const response = await fetch("/api/website-setups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: pendingSource.current,
          initialBuildModelId,
          idempotencyKey: idempotencyKey.current,
          confirmDuplicate,
          reportingTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        })
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        code?: string;
        projects?: DuplicateProject[];
        view?: { setup?: { id?: string } };
      };
      if (response.status === 409 && result.code === "duplicate_source_confirmation_required") {
        setDuplicateProjects(result.projects ?? []);
        setDuplicateError("");
        setStatus("");
        setSubmitting(false);
        return;
      }
      if (!response.ok || !result.view?.setup?.id) {
        showCreateError(result.error ?? "This website could not be started. Try again.", confirmDuplicate);
        setSubmitting(false);
        return;
      }
      router.push(`/account/onboarding/${result.view.setup.id}`);
      router.refresh();
    } catch {
      showCreateError("This website could not be started. Check your connection and try again.", confirmDuplicate);
      setSubmitting(false);
    }
  }

  function showCreateError(message: string, confirmDuplicate: boolean) {
    if (confirmDuplicate && duplicateProjects.length) {
      setDuplicateError(message);
      setStatus("");
    } else {
      setStatus(message);
    }
  }

  function closeDuplicateDialog() {
    if (submitting) return;
    setDuplicateProjects([]);
    setDuplicateError("");
  }

  return (
    <form className="onboarding-url-form" onSubmit={submit} noValidate>
      <label className="product-visually-hidden" htmlFor="sourceUrl">Website URL</label>
      <div className="onboarding-url-composer">
        <input
          ref={sourceInputRef}
          id="sourceUrl"
          name="sourceUrl"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="Paste a website URL"
          required
          maxLength={2048}
          aria-invalid={sourceError ? true : undefined}
          aria-describedby={sourceError ? sourceErrorId : undefined}
          onChange={() => { if (sourceError) setSourceError(""); }}
        />
        <button className="button primary" type="submit" disabled={submitting || modelCatalog.status !== "ready"}>{submitting ? "Creating…" : "Create website"}</button>
      </div>
      <div className="onboarding-model-field">
        <div className="onboarding-model-field-heading">
          <label htmlFor="initialBuildModelId">Initial build model</label>
          <span>
            {modelCatalog.status === "ready"
              ? `OpenRouter · ${catalogModels.length.toLocaleString()} compatible models`
              : "OpenRouter"}
          </span>
        </div>
        {modelCatalog.status === "ready" ? (
          <input
            className="onboarding-model-search"
            type="search"
            value={modelQuery}
            placeholder="Filter by model or provider"
            aria-label="Filter OpenRouter models"
            disabled={submitting}
            onChange={(event) => setModelQuery(event.target.value)}
          />
        ) : null}
        <ProductSelect
          id="initialBuildModelId"
          name="initialBuildModelId"
          value={initialBuildModelId}
          disabled={submitting || modelCatalog.status !== "ready"}
          aria-invalid={modelError ? true : undefined}
          aria-describedby={`${modelDescriptionId}${modelError ? ` ${modelErrorId}` : ""}`}
          onChange={(event) => {
            setInitialBuildModelId(event.target.value);
            if (modelError) setModelError("");
          }}
        >
          <option value="">
            {modelCatalog.status === "loading" ? "Loading OpenRouter models…" : "Choose an OpenRouter model"}
          </option>
          {visibleModels.map((option) => (
            <option key={option.id} value={option.id}>{modelOptionLabel(option)}</option>
          ))}
        </ProductSelect>
        {modelCatalog.status === "ready" && modelQuery.trim() && !visibleModels.length ? (
          <p className="onboarding-model-status">No compatible models match “{modelQuery.trim()}”.</p>
        ) : null}
        {modelCatalog.status === "error" ? (
          <div className="onboarding-model-load-error" role="alert">
            <span>{modelCatalog.message}</span>
            <button type="button" disabled={submitting} onClick={() => setModelCatalogAttempt((attempt) => attempt + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {selectedModel ? (
          <div className="onboarding-model-selection" aria-live="polite">
            <strong>{selectedModel.id}</strong>
            <span>{modelDetails(selectedModel)}</span>
          </div>
        ) : null}
        <small id={modelDescriptionId}>
          Only models compatible with Lodesta’s authoring tools are shown. This choice applies to the first build; fact gathering stays fixed and later edits use the active system model.
        </small>
        {modelError ? <p className="form-error" id={modelErrorId} role="alert">{modelError}</p> : null}
      </div>
      {sourceError ? <p className="form-error" id={sourceErrorId} role="alert">{sourceError}</p> : null}
      <p className="form-status" role="status" aria-live="polite">{status}</p>
      <ProductDialog
        open={Boolean(duplicateProjects.length)}
        title="Create another website?"
        description="It looks like you already have a project based on this source URL. Create another?"
        size="md"
        busy={submitting}
        dismissible={!submitting}
        className="onboarding-duplicate-dialog"
        initialFocusRef={duplicateCancelRef}
        returnFocusRef={sourceInputRef}
        onClose={closeDuplicateDialog}
        footer={
          <>
            <button ref={duplicateCancelRef} className="button secondary" type="button" disabled={submitting} onClick={closeDuplicateDialog}>
              Cancel
            </button>
            <button className="button primary" type="button" disabled={submitting} aria-busy={submitting} onClick={() => void create(true)}>
              {submitting ? "Creating…" : "Create another"}
            </button>
          </>
        }
      >
        <ul>
          {duplicateProjects.map((project) => (
            <li key={project.id}>
              <Link href={project.href}>{project.name}</Link>
              <span>{project.status.replaceAll("_", " ")}</span>
            </li>
          ))}
        </ul>
        {duplicateError ? <p className="product-dialog-error" role="alert">{duplicateError}</p> : null}
      </ProductDialog>
    </form>
  );
}

function modelOptionLabel(model: SiteCreationModelOption) {
  return model.name === model.id ? model.id : `${model.name} — ${model.id}`;
}

function modelDetails(model: SiteCreationModelOption) {
  const details: string[] = [];
  if (model.contextLength) details.push(`${compactNumber(model.contextLength)} context`);
  if (model.inputUsdPerMillion !== undefined) {
    details.push(`${formatPrice(model.inputUsdPerMillion)} input / 1M`);
  }
  if (model.outputUsdPerMillion !== undefined) {
    details.push(`${formatPrice(model.outputUsdPerMillion)} output / 1M`);
  }
  return details.join(" · ") || "OpenRouter pricing and context metadata unavailable";
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 2 : 0,
    maximumFractionDigits: value < 1 ? 4 : 2
  }).format(value);
}
