"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type VersionPublishFormProps = {
  siteId: string;
  versionId: string;
  current: boolean;
  disabled?: boolean;
  disabledReason?: string;
};

export function VersionPublishForm({ siteId, versionId, current, disabled = false, disabledReason }: VersionPublishFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function publishVersion() {
    if (disabled) {
      setStatus(disabledReason ?? "Complete checkout before publishing.");
      return;
    }
    if (!confirming) {
      setConfirming(true);
      setStatus("Confirm publish to make this QA-checked version live.");
      return;
    }
    setStatus("Publishing version...");
    const response = await fetch("/api/sites/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, versionId, confirmed: true })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to publish version.");
      return;
    }
    setConfirming(false);
    setStatus("Version is now live.");
    router.refresh();
  }

  async function restoreDraft() {
    setConfirming(false);
    setStatus("Restoring version as a draft...");
    const response = await fetch("/api/sites/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, versionId, action: "restore_draft" })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to restore version.");
      return;
    }
    setStatus(result.qa?.passed ? "Restored draft passed QA." : "Restored draft needs QA review.");
    router.refresh();
  }

  if (current) return <span className="badge severity-pass">Live</span>;

  return (
    <div className="button-row">
      <button className="button secondary" type="button" onClick={() => void restoreDraft()}>
        Restore draft
      </button>
      <button className="button secondary" type="button" onClick={() => void publishVersion()} disabled={disabled}>
        {confirming ? "Confirm publish" : "Make live"}
      </button>
      {disabled && disabledReason ? <p className="form-status">{disabledReason}</p> : null}
      {confirming ? (
        <button className="button secondary" type="button" onClick={() => {
          setConfirming(false);
          setStatus("");
        }}>
          Cancel
        </button>
      ) : null}
      {status ? <p className="form-status">{status}</p> : null}
    </div>
  );
}
