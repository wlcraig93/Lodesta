"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";

type SeoMetadataResponse = {
  summary?: string;
  error?: string;
};

export function RunSeoMetadataButton({
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
      const response = await fetch("/api/sites/seo-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, versionId })
      });
      const payload = (await response.json().catch(() => ({}))) as SeoMetadataResponse;
      if (!response.ok) {
        setMessage(payload.error ?? "SEO metadata audit failed.");
        return;
      }
      setMessage(payload.summary ?? "SEO metadata audit ran.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "SEO metadata audit failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AdminButton variant="secondary" type="button" onClick={runAudit} disabled={submitting}>
        {submitting ? "Running..." : "Audit SEO metadata"}
      </AdminButton>
      {message ? <p className="form-status">{message}</p> : null}
    </div>
  );
}
