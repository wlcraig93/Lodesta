"use client";

import { useState } from "react";

type DomainConnectFormProps = {
  siteId: string;
};

export function DomainConnectForm({ siteId }: DomainConnectFormProps) {
  const [hostname, setHostname] = useState("");
  const [status, setStatus] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Registering hostname...");
    const response = await fetch("/api/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId,
        hostname,
        provider: "cloudflare_for_saas"
      })
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error ?? "Unable to register domain.");
      return;
    }
    setStatus(`${result.verification?.note ?? "Domain registered."} Verification value: ${result.verification?.value ?? "pending"}`);
  }

  return (
    <form className="editor-form" onSubmit={onSubmit}>
      <label>
        <span>Custom domain</span>
        <input
          value={hostname}
          placeholder="www.example.com"
          onChange={(event) => setHostname(event.target.value)}
          required
        />
      </label>
      <button className="button primary" type="submit">
        Connect domain
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}
