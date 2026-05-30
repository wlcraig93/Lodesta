"use client";

import { useState } from "react";
import type { FormEvent } from "react";

type OpenAiSettings = {
  generationModel: string;
  visualQaModel: string;
  imageModel: string;
  imageSize: string;
  imageQuality: "low" | "medium" | "high" | "auto";
  imageFormat: "jpeg";
  mockupLimit: number;
};

type SettingsSnapshot = {
  settings: OpenAiSettings;
  version: number;
  source: string;
  updatedBy?: string;
  updatedAt?: string;
  warning?: string;
};

type FormState = {
  generationModel: string;
  visualQaModel: string;
  imageModel: string;
  imageSize: string;
  imageQuality: OpenAiSettings["imageQuality"];
  mockupLimit: string;
};

const staleMessage = "Settings changed since this page loaded. Reload and apply your changes again.";

export function OpenAiSettingsForm({ initialSnapshot }: { initialSnapshot: SettingsSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [form, setForm] = useState<FormState>(() => fromSnapshot(initialSnapshot));
  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus("");

    const response = await fetch("/api/operator/settings/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationModel: form.generationModel,
        visualQaModel: form.visualQaModel,
        imageModel: form.imageModel,
        imageSize: form.imageSize,
        imageQuality: form.imageQuality,
        mockupLimit: Number.parseInt(form.mockupLimit, 10),
        version: snapshot.version
      })
    });
    const payload = (await response.json().catch(() => null)) as Partial<SettingsSnapshot> & {
      error?: string;
      issues?: string[];
    } | null;

    setSaving(false);
    if (!response.ok) {
      setStatus(response.status === 409 ? staleMessage : payload?.issues?.[0] ?? payload?.error ?? "Unable to save settings.");
      return;
    }

    const nextSnapshot = payload as SettingsSnapshot;
    setSnapshot(nextSnapshot);
    setForm(fromSnapshot(nextSnapshot));
    setStatus("Settings saved.");
  }

  return (
    <form className="editor-form settings-form" onSubmit={saveSettings}>
      <label>
        Generation model
        <input value={form.generationModel} onChange={(event) => setForm({ ...form, generationModel: event.target.value })} />
      </label>

      <label>
        Visual QA model
        <input value={form.visualQaModel} onChange={(event) => setForm({ ...form, visualQaModel: event.target.value })} />
      </label>

      <label>
        Image model
        <input value={form.imageModel} onChange={(event) => setForm({ ...form, imageModel: event.target.value })} />
      </label>

      <div className="settings-field-row">
        <label>
          Image size
          <input value={form.imageSize} onChange={(event) => setForm({ ...form, imageSize: event.target.value })} />
        </label>
        <label>
          Image quality
          <select value={form.imageQuality} onChange={(event) => setForm({ ...form, imageQuality: event.target.value as OpenAiSettings["imageQuality"] })}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="auto">auto</option>
          </select>
        </label>
      </div>

      <div className="settings-field-row">
        <label>
          Mockup limit
          <input
            min="1"
            max="3"
            type="number"
            value={form.mockupLimit}
            onChange={(event) => setForm({ ...form, mockupLimit: event.target.value })}
          />
        </label>
        <label>
          Image format
          <input value={snapshot.settings.imageFormat} readOnly />
        </label>
      </div>

      <div className="button-row">
        <button className="button primary" disabled={saving} type="submit">
          {saving ? "Saving..." : "Save settings"}
        </button>
      </div>

      {status ? <p className="muted">{status}</p> : null}
    </form>
  );
}

function fromSnapshot(snapshot: SettingsSnapshot): FormState {
  return {
    generationModel: snapshot.settings.generationModel,
    visualQaModel: snapshot.settings.visualQaModel,
    imageModel: snapshot.settings.imageModel,
    imageSize: snapshot.settings.imageSize,
    imageQuality: snapshot.settings.imageQuality,
    mockupLimit: String(snapshot.settings.mockupLimit)
  };
}
