"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type DesignSectionAuditsResponse = {
  summary?: string;
  error?: string;
};

export function RunDesignSectionAuditsButton({
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
      const response = await fetch("/api/sites/design-section-audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, versionId })
      });
      const payload = (await response.json().catch(() => ({}))) as DesignSectionAuditsResponse;
      if (!response.ok) {
        setMessage(payload.error ?? "Design section audits failed.");
        return;
      }
      setMessage(payload.summary ?? "Design section audits ran.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Design section audits failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton variant="secondary" type="button" onClick={runAudit} disabled={submitting}>
        {submitting ? "Running..." : "Audit design and sections"}
      </AdminButton>
      {message ? <p className="form-status">{message}</p> : null}
    </div>
  );
}
