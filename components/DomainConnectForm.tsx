"use client";

import { useId, useRef, useState } from "react";
import { z } from "zod";
import { parseJsonResponse } from "@/lib/client-json";

const domainResponseSchema = z.object({
  error: z.string().optional(),
  domain: z.object({
    verificationName: z.string(),
    verificationValue: z.string(),
    routingName: z.string(),
    routingTarget: z.string()
  }).optional()
}).passthrough();

type DomainConnectFormProps = {
  siteId: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function DomainConnectForm({ siteId, disabled = false, disabledReason }: DomainConnectFormProps) {
  const [hostname, setHostname] = useState("");
  const [status, setStatus] = useState("");
  const [hostnameError, setHostnameError] = useState("");
  const hostnameErrorId = useId();
  const hostnameRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) {
      setStatus(disabledReason ?? "Custom domains are unavailable.");
      return;
    }
    const trimmed = hostname.trim();
    if (!trimmed) {
      setHostnameError("Enter the domain you want to connect.");
      setStatus("");
      hostnameRef.current?.focus();
      return;
    }
    if (!trimmed.includes(".") || /\s/.test(trimmed)) {
      setHostnameError("Enter a domain like www.example.com.");
      setStatus("");
      hostnameRef.current?.focus();
      return;
    }
    setHostnameError("");
    setStatus("Preparing DNS instructions...");
    const response = await fetch("/api/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId,
        hostname
      })
    });
    const result = await parseJsonResponse(response, domainResponseSchema);
    if (!response.ok) {
      setStatus(result.error ?? "Unable to register domain.");
      return;
    }
    setStatus("DNS instructions are ready below. Add both records, then check the connection.");
    window.location.reload();
  }

  return (
    <form className="editor-form" onSubmit={onSubmit} noValidate>
      <label>
        <span>Custom domain</span>
        <input
          ref={hostnameRef}
          value={hostname}
          placeholder="www.example.com"
          onChange={(event) => {
            setHostname(event.target.value);
            if (hostnameError) setHostnameError("");
          }}
          disabled={disabled}
          required
          aria-invalid={hostnameError ? true : undefined}
          aria-describedby={hostnameError ? hostnameErrorId : undefined}
        />
      </label>
      {hostnameError ? <p className="form-error" id={hostnameErrorId} role="alert">{hostnameError}</p> : null}
      <button className="button primary" type="submit" disabled={disabled}>
        Get DNS records
      </button>
      {disabled && disabledReason ? <p className="form-status">{disabledReason}</p> : null}
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}
