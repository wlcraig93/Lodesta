"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

export function WebsiteSetupProgress({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  return null;
}

export function WebsiteSetupAction({ setupId, action, label, tone = "secondary" }: { setupId: string; action: "cancel" | "retry"; label: string; tone?: "primary" | "secondary" }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  async function run() {
    if (action === "cancel" && !window.confirm("Cancel this website setup?")) return;
    setPending(true);
    const response = await fetch(`/api/website-setups/${setupId}/${action}`, { method: "POST" });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setStatus(result.error ?? "That action could not be completed."); setPending(false); return; }
    if (action === "cancel") router.push("/account/onboarding");
    else router.refresh();
  }
  return <><button className={`button ${tone}`} type="button" disabled={pending} onClick={run}>{pending ? "Working…" : label}</button>{status ? <span className="form-status" role="status">{status}</span> : null}</>;
}

export function WebsiteSetupSourceForm({ setupId, sourceUrl }: { setupId: string; sourceUrl: string }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/website-setups/${setupId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceUrl: form.get("sourceUrl") }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setStatus(result.error ?? "The website address could not be changed."); setPending(false); return; }
    setStatus("Website changed. We’ll try again now.");
    router.refresh();
  }
  return (
    <form className="setup-source-form" onSubmit={submit}>
      <label htmlFor="replacementSource">Use a different website</label>
      <div><input id="replacementSource" name="sourceUrl" type="text" inputMode="url" defaultValue={sourceUrl} required maxLength={2048} /><button className="button secondary" type="submit" disabled={pending}>{pending ? "Saving…" : "Change website"}</button></div>
      <p className="form-status" role="status">{status}</p>
    </form>
  );
}
