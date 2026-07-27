"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProductDialog } from "@/components/ProductDialog";

type DuplicateProject = { id: string; name: string; status: string; href: string };

export function WebsiteOnboardingForm({
  initialSource = "",
  prospectReportId
}: {
  initialSource?: string;
  prospectReportId?: string;
}) {
  const router = useRouter();
  const idempotencyKey = useRef(crypto.randomUUID());
  const sourceErrorId = useId();
  const pendingSource = useRef(initialSource);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const duplicateCancelRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [duplicateProjects, setDuplicateProjects] = useState<DuplicateProject[]>([]);
  const [duplicateError, setDuplicateError] = useState("");
  const [sourceError, setSourceError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const source = String(form.get("sourceUrl") ?? "").trim();
    if (!source) {
      setSourceError("Paste a public website or business source to get started.");
      setStatus("");
      sourceInputRef.current?.focus();
      return;
    }
    setSourceError("");
    pendingSource.current = source;
    await create(false);
  }

  async function create(confirmDuplicate: boolean) {
    setSubmitting(true);
    setDuplicateError("");
    setStatus("Checking this source…");
    try {
      const response = await fetch("/api/website-setups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: pendingSource.current,
          prospectReportId,
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
      <label className="product-visually-hidden" htmlFor="sourceUrl">Public website or business source</label>
      <div className="onboarding-url-composer">
        <input
          ref={sourceInputRef}
          id="sourceUrl"
          name="sourceUrl"
          type="text"
          inputMode="url"
          autoComplete="url"
          defaultValue={initialSource}
          placeholder="Paste a website or public business URL"
          required
          maxLength={2048}
          aria-invalid={sourceError ? true : undefined}
          aria-describedby={sourceError ? sourceErrorId : undefined}
          onChange={() => { if (sourceError) setSourceError(""); }}
        />
        <button className="button primary" type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create website"}
        </button>
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
            <button ref={duplicateCancelRef} className="button secondary" type="button" disabled={submitting} onClick={closeDuplicateDialog}>Cancel</button>
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
