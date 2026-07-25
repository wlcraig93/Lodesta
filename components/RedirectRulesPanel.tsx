"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { z } from "zod";
import type { SiteRedirectRule } from "@/packages/platform-operations";
import { parseJsonResponse } from "@/lib/client-json";
import { ProductSelect } from "@/components/ProductUI";

const redirectResponseSchema = z.object({ error: z.string().optional() }).passthrough();

export function RedirectRulesPanel({ siteId, redirects, routes }: {
  siteId: string;
  redirects: SiteRedirectRule[];
  routes: Array<{ path: string; title: string }>;
}) {
  const router = useRouter();
  const [sourcePath, setSourcePath] = useState("");
  const [destinationPath, setDestinationPath] = useState(routes[0]?.path ?? "/");
  const [status, setStatus] = useState("");
  const [sourceError, setSourceError] = useState("");
  const sourceErrorId = useId();
  const sourceRef = useRef<HTMLInputElement>(null);
  const disabled = routes.length === 0;

  async function upsert(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = sourcePath.trim();
    if (!trimmed) {
      setSourceError("Enter the old path you want to redirect.");
      setStatus("");
      sourceRef.current?.focus();
      return;
    }
    if (!trimmed.startsWith("/")) {
      setSourceError("Start the old path with a slash, like /old-service.");
      setStatus("");
      sourceRef.current?.focus();
      return;
    }
    setSourceError("");
    setStatus("Saving redirect...");
    const response = await fetch("/api/redirects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "upsert", siteId, sourcePath, destinationPath })
    });
    const result = await parseJsonResponse(response, redirectResponseSchema);
    if (!response.ok) {
      setStatus(result.error ?? "Unable to save redirect.");
      return;
    }
    setSourcePath("");
    setStatus("Redirect saved.");
    router.refresh();
  }

  async function setRuleStatus(redirect: SiteRedirectRule) {
    const next = redirect.status === "active" ? "inactive" : "active";
    setStatus(`${next === "active" ? "Activating" : "Pausing"} redirect...`);
    const response = await fetch("/api/redirects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set_status", siteId, redirectId: redirect.id, status: next })
    });
    const result = await parseJsonResponse(response, redirectResponseSchema);
    if (!response.ok) {
      setStatus(result.error ?? "Unable to update redirect.");
      return;
    }
    setStatus(next === "active" ? "Redirect activated." : "Redirect paused.");
    router.refresh();
  }

  return (
    <div className="owner-authority-stack">
      <form className="editor-form" onSubmit={upsert} noValidate>
        <label>
          <span>Old path</span>
          <input
            ref={sourceRef}
            value={sourcePath}
            onChange={(event) => {
              setSourcePath(event.target.value);
              if (sourceError) setSourceError("");
            }}
            placeholder="/old-service"
            disabled={disabled}
            required
            aria-invalid={sourceError ? true : undefined}
            aria-describedby={sourceError ? sourceErrorId : undefined}
          />
        </label>
        {sourceError ? <p className="form-error" id={sourceErrorId} role="alert">{sourceError}</p> : null}
        <label>
          <span>Destination</span>
          <ProductSelect value={destinationPath} onChange={(event) => setDestinationPath(event.target.value)} disabled={disabled}>
            {routes.map((route) => <option key={route.path} value={route.path}>{route.title} ({route.path})</option>)}
          </ProductSelect>
        </label>
        <button className="button primary" type="submit" disabled={disabled}>Save redirect</button>
        {disabled ? <p className="form-status">Publish a site version before adding redirects.</p> : null}
        {status ? <p className="form-status">{status}</p> : null}
      </form>
      <div className="finding-list">
        {redirects.map((redirect) => (
          <article className="finding-card" key={redirect.id}>
            <span className="badge">{redirect.status}</span>
            <h3>{redirect.sourcePath}</h3>
            <p>Redirects to {redirect.destinationPath}</p>
            <button className="button secondary" type="button" onClick={() => void setRuleStatus(redirect)}>
              {redirect.status === "active" ? "Pause" : "Activate"}
            </button>
          </article>
        ))}
        {redirects.length === 0 ? <p className="muted">No redirect rules.</p> : null}
      </div>
    </div>
  );
}
