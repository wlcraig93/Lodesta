"use client";

import { useState } from "react";

export type ClaimFact = {
  id: string;
  label: string;
  value: string;
  required: boolean;
  verified: boolean;
};

type ClaimSiteFormProps = {
  siteId: string;
  facts: ClaimFact[];
};

export function ClaimSiteForm({ siteId, facts }: ClaimSiteFormProps) {
  const [ownerEmail, setOwnerEmail] = useState("");
  const [verifiedFacts, setVerifiedFacts] = useState<string[]>(facts.map((fact) => fact.id));
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedManagement, setAcceptedManagement] = useState(false);
  const [status, setStatus] = useState("");
  const missingRequiredFacts = facts.filter((fact) => fact.required && !verifiedFacts.includes(fact.id));
  const canSubmit = acceptedTerms && acceptedManagement && missingRequiredFacts.length === 0;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Creating claim...");
    const response = await fetch("/api/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId,
        ownerEmail: ownerEmail || undefined,
        verifiedFacts,
        acceptedTerms,
        acceptedManagement
      })
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error ?? "Unable to create claim.");
      return;
    }
    if (result.checkout?.url) {
      window.location.href = result.checkout.url;
      return;
    }
    setStatus(result.checkout?.message ?? "Claim created. Checkout is ready to be connected.");
  }

  function toggleFact(factId: string) {
    setVerifiedFacts((current) =>
      current.includes(factId) ? current.filter((candidate) => candidate !== factId) : [...current, factId]
    );
  }

  return (
    <form className="editor-form" onSubmit={onSubmit}>
      <label>
        <span>Owner email</span>
        <input
          type="email"
          value={ownerEmail}
          placeholder="owner@example.com"
          required
          onChange={(event) => setOwnerEmail(event.target.value)}
        />
      </label>

      <div className="checkbox-list">
        {facts.map((fact) => (
          <label key={fact.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={verifiedFacts.includes(fact.id)}
              onChange={() => toggleFact(fact.id)}
            />
            <span>
              <strong>
                {fact.label}
                {fact.required ? <em className="inline-status">Required</em> : null}
                {fact.verified ? <em className="inline-status">Verified</em> : <em className="inline-status pending">Needs review</em>}
              </strong>
              <small>{fact.value}</small>
            </span>
          </label>
        ))}
      </div>

      <div className="checkbox-list">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            required
          />
          <span>
            <strong>I can authorize this site and its content</strong>
            <small>
              I represent this business or have permission to claim it, and any content I provide can be hosted and
              managed for the site.
            </small>
          </span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={acceptedManagement}
            onChange={(event) => setAcceptedManagement(event.target.checked)}
            required
          />
          <span>
            <strong>I accept managed-site guardrails</strong>
            <small>
              The system can manage conversion structure, SEO scaffolding, schema, and technical fixes while owner-truth
              facts remain verified by me.
            </small>
          </span>
        </label>
      </div>

      <button className="button primary" type="submit" disabled={!canSubmit}>
        Claim and continue
      </button>
      {missingRequiredFacts.length ? (
        <p className="form-status">
          Verify required facts: {missingRequiredFacts.map((fact) => fact.label).join(", ")}.
        </p>
      ) : null}
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}
