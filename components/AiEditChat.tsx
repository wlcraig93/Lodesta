"use client";

import { useState } from "react";

type AiEditChatProps = {
  siteId: string;
  siteSlug: string;
  publishDisabled?: boolean;
  publishDisabledReason?: string;
};

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

type AiEditResponse = {
  message?: string;
  error?: string;
  operations?: Array<{ label: string; type: string }>;
  warnings?: string[];
  issues?: Array<{ title: string; detail: string }>;
  qa?: { passed: boolean; checks: Array<{ severity: string; title: string }> } | null;
  published?: boolean;
  publishConfirmationRequired?: boolean;
};

const starterMessages: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "Ask for structured site changes: rewrite the hero, add an FAQ, make CTAs call-first, add a service, change the theme, or run an audit."
  }
];

export function AiEditChat({ siteId, siteSlug, publishDisabled = false, publishDisabledReason }: AiEditChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"draft" | "qa">("draft");
  const [status, setStatus] = useState("");
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    setMessages((current) => [...current, { role: "user", content: text }]);
    setPrompt("");
    setStatus("Applying structured draft edit...");

    const response = await fetch("/api/ai/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, message: text, mode })
    });
    const result = (await response.json()) as AiEditResponse;

    if (!response.ok) {
      const issues = result.issues?.length
        ? `\n\nGuardrails:\n${result.issues.map((issue) => `- ${issue.title}: ${issue.detail}`).join("\n")}`
        : "";
      setMessages((current) => [
        ...current,
        { role: "assistant", content: `${result.error ?? "I could not apply that edit."}${issues}` }
      ]);
      setStatus("");
      return;
    }

    const qaText = result.qa
      ? result.qa.passed
        ? " QA passed."
        : ` QA needs attention: ${result.qa.checks.filter((check) => check.severity === "fail").length} failing checks.`
      : "";
    const operations = result.operations?.length
      ? `\n\n${result.operations.map((operation) => `- ${operation.label}`).join("\n")}`
      : "";
    const warnings = result.warnings?.length ? `\n\nWarnings:\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}` : "";
    const published = result.publishConfirmationRequired
      ? "\n\nSaved as QA-checked draft. Confirm publish when ready."
      : "\n\nSaved as draft.";

    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        content: `${result.message ?? "Done."}${operations}${warnings}${qaText}${published}`
      }
    ]);
    window.dispatchEvent(new Event("lodesta:preview-refresh"));
    setStatus(result.publishConfirmationRequired ? "Draft ready for publish confirmation." : "Draft saved.");
  }

  async function publishDraft() {
    if (publishDisabled) {
      setStatus(publishDisabledReason ?? "Complete checkout before publishing.");
      return;
    }
    if (!confirmingPublish) {
      setConfirmingPublish(true);
      setStatus("Confirm publish to make the current QA-checked draft live.");
      return;
    }
    setStatus("Publishing draft...");
    const response = await fetch("/api/sites/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, confirmed: true })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? result.reason ?? "Unable to publish draft.");
      return;
    }
    setConfirmingPublish(false);
    window.dispatchEvent(new Event("lodesta:preview-refresh"));
    setStatus("Draft published. Public preview is current.");
  }

  return (
    <div className="ai-chat-dock">
      <div className="ai-chat-header">
        <div>
          <span className="badge">AI edit dock</span>
          <h2>Assistant</h2>
        </div>
        <a className="button secondary" href={`/sites/${siteSlug}`}>
          View site
        </a>
      </div>

      <div className="ai-message-list" aria-live="polite">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`ai-message ${message.role}`}>
            {message.content.split("\n").map((line, lineIndex) => (
              <p key={`${index}-${lineIndex}`}>{line || "\u00a0"}</p>
            ))}
          </div>
        ))}
      </div>

      <form className="ai-chat-form" onSubmit={onSubmit}>
        <label>
          <span>Request</span>
          <textarea
            value={prompt}
            placeholder="Add an FAQ, make the hero more urgent, and use call-first CTAs."
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="segmented-control" aria-label="Apply mode">
          <button
            type="button"
            className={mode === "draft" ? "active" : ""}
            onClick={() => setMode("draft")}
          >
            Draft
          </button>
          <button
            type="button"
            className={mode === "qa" ? "active" : ""}
            onClick={() => setMode("qa")}
          >
            QA Review
          </button>
        </div>
        <div className="button-row">
          <button className="button primary" type="submit">
            Apply edit
          </button>
          <button className="button secondary" type="button" onClick={() => void publishDraft()} disabled={publishDisabled}>
            {confirmingPublish ? "Confirm publish" : "Publish draft"}
          </button>
          {confirmingPublish ? (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setConfirmingPublish(false);
                setStatus("");
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
        {publishDisabled && publishDisabledReason ? <p className="form-status">{publishDisabledReason}</p> : null}
        {status ? <p className="form-status">{status}</p> : null}
      </form>
    </div>
  );
}
