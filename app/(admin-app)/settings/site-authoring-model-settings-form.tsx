"use client";

import { useState, type FormEvent } from "react";
import { AdminButton, AdminButtonRow } from "@/components/admin/AdminButton";

type SettingsSnapshot = {
  settings: { siteAgentProvider: "openai" | "openrouter"; siteAgentModel: string; ingestionModel: string };
  version: number;
  source: string;
  updatedBy?: string;
  updatedAt?: string;
  warning?: string;
};

const staleMessage = "Settings changed since this page loaded. Reload and apply your changes again.";

export function SiteAuthoringModelSettingsForm({ initialSnapshot }: { initialSnapshot: SettingsSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [form, setForm] = useState(initialSnapshot.settings);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    const response = await fetch("/api/operator/settings/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, version: snapshot.version })
    });
    const payload = await response.json().catch(() => null) as (Partial<SettingsSnapshot> & { error?: string; issues?: string[] }) | null;
    setSaving(false);
    if (!response.ok) {
      setStatus(response.status === 409 ? staleMessage : payload?.issues?.[0] ?? payload?.error ?? "Unable to save settings.");
      return;
    }
    const next = payload as SettingsSnapshot;
    setSnapshot(next);
    setForm(next.settings);
    setStatus("Settings saved.");
  }

  return (
    <form className="editor-form settings-form" onSubmit={saveSettings}>
      <label>
        Website manager API provider
        <select value={form.siteAgentProvider} onChange={(event) => setForm({ ...form, siteAgentProvider: event.target.value as SettingsSnapshot["settings"]["siteAgentProvider"] })}>
          <option value="openai">OpenAI (direct)</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </label>
      <label>
        Website manager model
        <input value={form.siteAgentModel} onChange={(event) => setForm({ ...form, siteAgentModel: event.target.value })} />
        <small className="muted">{form.siteAgentProvider === "openrouter" ? "Use a provider-qualified OpenRouter slug, for example openai/gpt-5." : "Direct OpenAI uses the existing priced model catalog."}</small>
      </label>
      <label>
        Business ingestion
        <input value={form.ingestionModel} onChange={(event) => setForm({ ...form, ingestionModel: event.target.value })} />
      </label>
      <AdminButtonRow>
        <AdminButton variant="primary" disabled={saving} type="submit">
          {saving ? "Saving..." : "Save settings"}
        </AdminButton>
      </AdminButtonRow>
      {status ? <p className="muted">{status}</p> : null}
    </form>
  );
}
