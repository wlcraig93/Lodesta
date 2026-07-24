"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AnalyticsTimezoneForm({ siteId, initialTimezone }: { siteId: string; initialTimezone: string }) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(initialTimezone);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportingTimezone: timezone })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save timezone.");
      setStatus("Reporting timezone saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save timezone.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="analytics-timezone-form" onSubmit={save}>
      <label><span>IANA timezone</span><input name="reportingTimezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Chicago" autoComplete="off" /></label>
      <button className="button secondary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save timezone"}</button>
      {status ? <p className="form-status" role="status">{status}</p> : null}
    </form>
  );
}
