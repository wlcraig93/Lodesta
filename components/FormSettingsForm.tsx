"use client";

import { useState } from "react";
import type { FormDefinition, WorkflowDefinition } from "@/lib/models";

type FormSettingsFormProps = {
  siteId: string;
  form: FormDefinition;
  workflows: WorkflowDefinition[];
};

type EditableField = FormDefinition["fields"][number] & { optionsText?: string };

type FormSettingsResponse = {
  ok?: boolean;
  error?: string;
};

export function FormSettingsForm({ siteId, form, workflows }: FormSettingsFormProps) {
  const [name, setName] = useState(form.name);
  const [submitLabel, setSubmitLabel] = useState(form.submitLabel);
  const [notificationEmail, setNotificationEmail] = useState(workflowTarget(workflows, "email"));
  const [webhookUrl, setWebhookUrl] = useState(workflowTarget(workflows, "webhook"));
  const [fields, setFields] = useState<EditableField[]>(
    form.fields.map((field) => ({ ...field, optionsText: field.options?.join(", ") ?? "" }))
  );
  const [status, setStatus] = useState("");

  function updateField(index: number, patch: Partial<EditableField>) {
    setFields((current) => current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)));
  }

  function addField() {
    setFields((current) => [
      ...current,
      {
        id: `field_${current.length + 1}`,
        label: "New field",
        type: "text",
        required: false,
        optionsText: ""
      }
    ]);
  }

  function removeField(index: number) {
    setFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index));
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Saving form settings...");
    const response = await fetch("/api/forms/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId,
        formId: form.id,
        name,
        submitLabel,
        notificationEmail,
        webhookUrl,
        fields: fields.map((field) => ({
          id: field.id,
          label: field.label,
          type: field.type,
          required: field.required,
          options: splitOptions(field.optionsText ?? "")
        }))
      })
    });
    const result = (await response.json()) as FormSettingsResponse;
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to save form settings.");
      return;
    }
    setStatus("Form settings saved.");
  }

  return (
    <form className="editor-form form-settings-card" onSubmit={saveSettings}>
      <div className="form-grid-two">
        <label>
          <span>Form name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>Submit button</span>
          <input value={submitLabel} onChange={(event) => setSubmitLabel(event.target.value)} />
        </label>
      </div>

      <div className="form-grid-two">
        <label>
          <span>Email notifications</span>
          <input type="email" value={notificationEmail} onChange={(event) => setNotificationEmail(event.target.value)} />
        </label>
        <label>
          <span>Webhook URL</span>
          <input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/leads" />
        </label>
      </div>

      <div className="form-field-list">
        {fields.map((field, index) => (
          <article className="form-field-row" key={`${field.id}-${index}`}>
            <label>
              <span>Label</span>
              <input value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} />
            </label>
            <label>
              <span>Type</span>
              <select
                value={field.type}
                onChange={(event) => updateField(index, { type: event.target.value as EditableField["type"] })}
              >
                <option value="text">Text</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="textarea">Textarea</option>
                <option value="select">Select</option>
              </select>
            </label>
            <label>
              <span>Options</span>
              <input
                value={field.optionsText ?? ""}
                disabled={field.type !== "select"}
                onChange={(event) => updateField(index, { optionsText: event.target.value })}
              />
            </label>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(event) => updateField(index, { required: event.target.checked })}
              />
              <span>Required</span>
            </label>
            <button className="button secondary" type="button" onClick={() => removeField(index)} disabled={fields.length <= 1}>
              Remove
            </button>
          </article>
        ))}
      </div>

      <div className="button-row">
        <button className="button secondary" type="button" onClick={addField}>
          Add field
        </button>
        <button className="button primary" type="submit">
          Save form settings
        </button>
      </div>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}

function workflowTarget(workflows: WorkflowDefinition[], destination: WorkflowDefinition["destination"]) {
  const workflow = workflows.find((candidate) => candidate.trigger === "form_submission" && candidate.destination === destination);
  const target = workflow?.config.to ?? workflow?.config.url ?? workflow?.config.target;
  return typeof target === "string" ? target : "";
}

function splitOptions(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
