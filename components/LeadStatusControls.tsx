"use client";

import { useState } from "react";
import { z } from "zod";
import type { Inquiry } from "@/packages/site-capabilities";
import { parseJsonResponse } from "@/lib/client-json";

const inquiryStatusResponseSchema = z.object({
  error: z.string().optional(),
  ok: z.boolean().optional(),
  inquiry: z.object({
    status: z.enum(["new", "needs_reply", "replied", "booked", "won", "spam", "archived"])
  }).passthrough().optional()
}).passthrough();

type LeadStatusControlsProps = {
  siteId: string;
  inquiryId: string;
  initialStatus: Inquiry["status"];
  onStatusChange?: (status: Inquiry["status"]) => void;
};

const ownerStatuses: Array<{ label: string; status: Inquiry["status"] }> = [
  { label: "Needs reply", status: "needs_reply" },
  { label: "Replied", status: "replied" },
  { label: "Booked", status: "booked" },
  { label: "Won", status: "won" },
  { label: "Spam", status: "spam" },
  { label: "Archive", status: "archived" }
];

export function LeadStatusControls({ siteId, inquiryId, initialStatus, onStatusChange }: LeadStatusControlsProps) {
  const [status, setStatus] = useState(initialStatus);
  const [message, setMessage] = useState("");

  async function updateStatus(nextStatus: Inquiry["status"]) {
    setMessage("Saving...");
    const response = await fetch("/api/inquiries/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, inquiryId, status: nextStatus })
    });
    const result = await parseJsonResponse(response, inquiryStatusResponseSchema);
    if (!response.ok || !result.ok || !result.inquiry) {
      setMessage(result.error ?? "Unable to update inquiry.");
      return;
    }
    setStatus(result.inquiry.status);
    onStatusChange?.(result.inquiry.status);
    setMessage("Saved.");
  }

  return (
    <div className="lead-status-controls">
      <span className="badge">{status}</span>
      <div className="button-row">
        {ownerStatuses.map((option) => (
          <button
            className="button secondary"
            disabled={option.status === status}
            key={option.status}
            type="button"
            onClick={() => void updateStatus(option.status)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {message ? <small>{message}</small> : null}
    </div>
  );
}
