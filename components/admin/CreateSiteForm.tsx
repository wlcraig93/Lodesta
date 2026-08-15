"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

type BootstrapResponse = {
  site?: { slug?: string };
  run?: { id?: string };
  workspacePath?: string;
  error?: string;
};

type CanaryModel = "luna" | "terra" | "sol";

export function CreateSiteForm({ canaryMode = false }: { canaryMode?: boolean }) {
  const router = useRouter();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [url, setUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formData = new FormData(event.currentTarget);
    const submittedModel = canaryMode
      ? String(formData.get("model")) as CanaryModel
      : "luna";
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(canaryMode ? "/api/admin/site-authoring-canaries" : "/api/site-agent/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          idempotencyKey: idempotencyKey.current,
          reportingTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          ...(canaryMode ? { model: submittedModel } : {}),
          ...(slug.trim() ? { slug: slug.trim() } : {})
        })
      });
      const payload = await response.json().catch(() => ({})) as BootstrapResponse;
      if (!response.ok || (canaryMode ? !payload.workspacePath : !payload.site?.slug)) throw new Error(payload.error ?? "Site creation failed.");
      router.push(canaryMode ? payload.workspacePath! : `/workspace/${encodeURIComponent(payload.site!.slug!)}/editor`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  return <form className="editor-form create-site-form" onSubmit={submit}>
    {canaryMode ? <p className="muted">The canary runs the canonical generator from the retained mirror for this exact URL. It does not recrawl the source or publish the result.</p> : null}
    {canaryMode ? <label htmlFor="site-authoring-model">
      Authoring model
      <select id="site-authoring-model" name="model" defaultValue="luna" disabled={busy}>
        <option value="luna">Luna — economical</option>
        <option value="terra">Terra — balanced</option>
        <option value="sol">Sol — strongest</option>
      </select>
    </label> : null}
    <label htmlFor="source-url">
      Business website
      <input id="source-url" type="text" inputMode="url" autoComplete="url" placeholder="example.com" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} required autoFocus />
    </label>
    <label htmlFor="site-slug">
      Site slug <span className="muted">Optional</span>
      <input id="site-slug" type="text" placeholder="Generated from the business name" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} disabled={busy} />
    </label>
    {error ? <p className="error-text" role="alert">{error}</p> : null}
    <div className="button-row">
      <button className="button primary" type="submit" disabled={busy} aria-busy={busy}>{busy ? "Creating site..." : "Create site"}</button>
      <Link className="button secondary" href="/admin/sites">Cancel</Link>
    </div>
  </form>;
}
