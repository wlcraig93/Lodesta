"use client";

import { useState } from "react";

export function IntakeCreateForm() {
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Generating site...");
    const response = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url.trim() || undefined,
        prompt: prompt.trim() || undefined
      })
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error ?? "Unable to generate site.");
      return;
    }
    setStatus("Preview ready.");
    window.location.assign(result.preview?.url ?? `/editor/${result.bundle?.siteModel?.slug ?? ""}`);
  }

  return (
    <form className="editor-form intake-create-form" onSubmit={onSubmit}>
      <label>
        <span>Existing website URL</span>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example-business.com"
          type="url"
        />
      </label>
      <label>
        <span>Build prompt</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Build a call-first site for a family-owned HVAC company in Tulsa."
        />
      </label>
      <button className="button primary" type="submit" disabled={!url.trim() && prompt.trim().length < 3}>
        Generate preview
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}
