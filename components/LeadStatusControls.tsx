"use client";

import { useState } from "react";
import type { LeadSubmission } from "@/lib/models";

type LeadStatusControlsProps = {
  siteId: string;
  submissionId: string;
  initialStatus: LeadSubmission["status"];
};

export function LeadStatusControls({ siteId, submissionId, initialStatus }: LeadStatusControlsProps) {
  const [status, setStatus] = useState(initialStatus);
  const [message, setMessage] = useState("");

  async function updateStatus(nextStatus: LeadSubmission["status"]) {
    setMessage("Saving...");
    const response = await fetch("/api/leads/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, submissionId, status: nextStatus })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setMessage(result.error ?? "Unable to update lead.");
      return;
    }
    setStatus(result.lead.status);
    setMessage("Saved.");
  }

  return (
    <div className="lead-status-controls">
      <span className="badge">{status}</span>
      <div className="button-row">
        <button className="button secondary" type="button" onClick={() => void updateStatus("reviewed")}>
          Reviewed
        </button>
        <button className="button secondary" type="button" onClick={() => void updateStatus("spam")}>
          Spam
        </button>
      </div>
      {message ? <small>{message}</small> : null}
    </div>
  );
}
