"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type SocialProofResponse = {
  summary?: string;
  error?: string;
};

export function RunSocialProofButton({
  siteId,
  versionId
}: {
  siteId: string;
  versionId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runAudit() {
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sites/social-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, versionId })
      });
      const payload = (await response.json().catch(() => ({}))) as SocialProofResponse;
      if (!response.ok) {
        setMessage(payload.error ?? "Social proof audit failed.");
        return;
      }
      setMessage(payload.summary ?? "Social proof audit ran.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Social proof audit failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton variant="secondary" type="button" onClick={runAudit} disabled={submitting}>
        {submitting ? "Running..." : "Audit social proof"}
      </AdminButton>
      {message ? <p className="form-status">{message}</p> : null}
    </div>
  );
}
