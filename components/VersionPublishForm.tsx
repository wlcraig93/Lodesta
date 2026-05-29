"use client";

import { useState } from "react";

type VersionPublishFormProps = {
  siteId: string;
  versionId: string;
  current: boolean;
};

export function VersionPublishForm({ siteId, versionId, current }: VersionPublishFormProps) {
  const [status, setStatus] = useState("");

  async function publishVersion() {
    setStatus("Publishing version...");
    const response = await fetch("/api/sites/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, versionId })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to publish version.");
      return;
    }
    setStatus("Version is now live.");
  }

  if (current) return <span className="badge severity-pass">Live</span>;

  return (
    <div className="button-row">
      <button className="button secondary" type="button" onClick={() => void publishVersion()}>
        Make live
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </div>
  );
}
