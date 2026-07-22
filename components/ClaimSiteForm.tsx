"use client";

import { useState } from "react";
import { z } from "zod";
import { parseJsonResponse } from "@/lib/client-json";

const claimVerificationResponseSchema = z.object({
  error: z.string().optional(),
  challengeId: z.string().optional(),
  targetLabel: z.string().optional(),
  developmentCode: z.string().optional(),
  verification: z.object({ targetLabel: z.string().optional() }).passthrough().optional()
}).passthrough();
const claimResponseSchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
  checkout: z.object({ url: z.string().url().optional(), message: z.string().optional() }).passthrough().optional()
}).passthrough();

export type ClaimFact = {
  id: string;
  label: string;
  value: string;
  required: boolean;
  verified: boolean;
};

export type ClaimAssetRight = {
  id: string;
  kind: "logo" | "photo";
  url: string;
  alt: string;
};

export type ClaimVerificationTargetOption = {
  channel: "email" | "phone";
  label: string;
};

type ClaimSiteFormProps = {
  siteId: string;
  facts: ClaimFact[];
  assetRights: ClaimAssetRight[];
  verificationTargets: ClaimVerificationTargetOption[];
  outboundContext?: {
    campaignId: string;
    prospectId: string;
    previewToken?: string;
  };
};

export function ClaimSiteForm({ siteId, facts, assetRights, verificationTargets, outboundContext }: ClaimSiteFormProps) {
  const [ownerEmail, setOwnerEmail] = useState("");
  const [verifiedFacts, setVerifiedFacts] = useState<string[]>(facts.map((fact) => fact.id));
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedManagement, setAcceptedManagement] = useState(false);
  const [acceptedAssetRights, setAcceptedAssetRights] = useState(assetRights.length === 0);
  const [selectedChannel, setSelectedChannel] = useState<"email" | "phone">(verificationTargets[0]?.channel ?? "email");
  const [challengeId, setChallengeId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [contactVerified, setContactVerified] = useState(false);
  const [status, setStatus] = useState("");
  const missingRequiredFacts = facts.filter((fact) => fact.required && !verifiedFacts.includes(fact.id));
  const canSubmit = contactVerified && acceptedTerms && acceptedManagement && acceptedAssetRights && missingRequiredFacts.length === 0;

  async function startVerification() {
    setStatus("Sending verification code...");
    setContactVerified(false);
    const response = await fetch("/api/claim/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", siteId, channel: selectedChannel })
    });
    const result = await parseJsonResponse(response, claimVerificationResponseSchema);
    if (!response.ok) {
      setStatus(result.error ?? "Unable to start contact verification.");
      return;
    }
    if (!result.challengeId) {
      setStatus("Unable to start contact verification.");
      return;
    }
    setChallengeId(result.challengeId);
    setStatus(
      result.developmentCode
        ? `Verification code generated for ${result.targetLabel}: ${result.developmentCode}`
        : `Verification code sent to ${result.targetLabel}.`
    );
  }

  async function verifyContactCode() {
    setStatus("Checking verification code...");
    const response = await fetch("/api/claim/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", siteId, challengeId, code: verificationCode })
    });
    const result = await parseJsonResponse(response, claimVerificationResponseSchema);
    if (!response.ok) {
      setContactVerified(false);
      setStatus(result.error ?? "Verification code was not accepted.");
      return;
    }
    setContactVerified(true);
    setStatus(`Business contact verified via ${result.verification?.targetLabel ?? "contact record"}.`);
  }

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
        acceptedManagement,
        verificationChallenge: challengeId && verificationCode ? { challengeId, code: verificationCode } : undefined,
        acceptedAssetRights,
        attestedAssetIds: acceptedAssetRights ? assetRights.map((asset) => asset.id) : [],
        outboundCampaignId: outboundContext?.campaignId,
        outboundProspectId: outboundContext?.prospectId,
        previewToken: outboundContext?.previewToken
      })
    });
    const result = await parseJsonResponse(response, claimResponseSchema);
    if (!response.ok) {
      setStatus(
        result.code === "claim_verification_required"
          ? "Lodesta must verify this claim against the business contact record before checkout."
          : result.error ?? "Unable to create claim."
      );
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
        <label>
          <span>Business contact verification</span>
          {verificationTargets.length ? (
            <select
              value={selectedChannel}
              onChange={(event) => {
                setSelectedChannel(event.target.value as "email" | "phone");
                setChallengeId("");
                setVerificationCode("");
                setContactVerified(false);
              }}
            >
              {verificationTargets.map((target) => (
                <option key={target.channel} value={target.channel}>
                  {target.channel === "email" ? "Email" : "Phone"} {target.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="form-status">No independent business contact is available. Operator verification is required.</span>
          )}
        </label>
        {verificationTargets.length ? (
          <div className="button-row">
            <button className="button secondary" type="button" onClick={() => void startVerification()}>
              Send code
            </button>
            <label>
              <span>Code</span>
              <input value={verificationCode} inputMode="numeric" onChange={(event) => setVerificationCode(event.target.value)} />
            </label>
            <button className="button secondary" type="button" disabled={!challengeId || !verificationCode} onClick={() => void verifyContactCode()}>
              Verify code
            </button>
            {contactVerified ? <span className="badge status-ready">Contact verified</span> : null}
          </div>
        ) : null}
      </div>

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

      {assetRights.length ? (
        <div className="checkbox-list">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={acceptedAssetRights}
              onChange={(event) => setAcceptedAssetRights(event.target.checked)}
              required
            />
            <span>
              <strong>I own or hold rights to use the listed images and logos</strong>
              <small>
                Lodesta can publish these reference assets on the managed site after claim. Replace any asset you cannot
                approve before launch.
              </small>
            </span>
          </label>
          {assetRights.map((asset) => (
            <div key={asset.id} className="checkbox-row">
              <img src={asset.url} alt="" width={56} height={56} />
              <span>
                <strong>{asset.kind === "logo" ? "Logo" : "Photo"}: {asset.alt}</strong>
                <small>{asset.id}</small>
              </span>
            </div>
          ))}
        </div>
      ) : null}

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
      {assetRights.length && !acceptedAssetRights ? (
        <p className="form-status">Confirm photo and logo rights before checkout.</p>
      ) : null}
      {!contactVerified ? <p className="form-status">Verify the listed business contact before checkout.</p> : null}
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}
