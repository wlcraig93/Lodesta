"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type BootstrapResponse = {
  site?: { slug?: string };
  run?: { id?: string };
  error?: string;
};

export function CreateSiteForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/site-agent/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), mode: "draft", ...(slug.trim() ? { slug: slug.trim() } : {}) })
      });
      const payload = await response.json().catch(() => ({})) as BootstrapResponse;
      if (!response.ok || !payload.site?.slug) throw new Error(payload.error ?? "Site creation failed.");
      router.push(`/workspace/${encodeURIComponent(payload.site.slug)}/editor`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  return <form className="editor-form create-site-form" onSubmit={submit}>
    <label htmlFor="source-url">
      Business website
      <input id="source-url" type="url" inputMode="url" placeholder="https://example.com" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} required autoFocus />
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
