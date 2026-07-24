"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type DuplicateProject = { id: string; name: string; status: string; href: string };

export function WebsiteOnboardingForm() {
  const router = useRouter();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [duplicateProjects, setDuplicateProjects] = useState<DuplicateProject[]>([]);
  const pendingSource = useRef("");
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const duplicateDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!duplicateProjects.length) return;
    const dialog = duplicateDialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    focusable()[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDuplicateProjects([]);
        sourceInputRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [duplicateProjects.length]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    pendingSource.current = String(form.get("sourceUrl") ?? "");
    await create(false);
  }

  async function create(confirmDuplicate: boolean) {
    setSubmitting(true);
    setStatus("Checking this website…");
    const response = await fetch("/api/website-setups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceUrl: pendingSource.current,
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
      setStatus(result.error ?? "This website could not be started. Try again.");
      setSubmitting(false);
      return;
    }
    router.push(`/account/onboarding/${result.view.setup.id}`);
    router.refresh();
  }

  return (
    <form className="onboarding-url-form" onSubmit={submit}>
      <label className="product-visually-hidden" htmlFor="sourceUrl">Website URL</label>
      <div className="onboarding-url-composer">
        <input ref={sourceInputRef} id="sourceUrl" name="sourceUrl" type="text" inputMode="url" autoComplete="url" placeholder="Paste a website URL" required maxLength={2048} />
        <button className="button primary" type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create website"}</button>
      </div>
      <p className="form-status" role="status" aria-live="polite">{status}</p>
      {duplicateProjects.length ? (
        <div ref={duplicateDialogRef} className="onboarding-duplicate-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-source-title">
          <div>
            <h2 id="duplicate-source-title">Create another website?</h2>
            <p>It looks like you already have a project based on this source URL. Create another?</p>
            <ul>{duplicateProjects.map((project) => <li key={project.id}><Link href={project.href}>{project.name}</Link><span>{project.status.replaceAll("_", " ")}</span></li>)}</ul>
            <div className="button-row">
              <button className="button primary" type="button" disabled={submitting} onClick={() => void create(true)}>Create another</button>
              <button className="button secondary" type="button" onClick={() => { setDuplicateProjects([]); sourceInputRef.current?.focus(); }}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
