"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  PlatformSiteRecord,
  SiteAgentRunV1,
  SiteAgentSessionV1,
  SiteElementSelectionV1,
  SitePublicBuildInputV1,
  SiteVersionV4
} from "@/packages/site-contracts";
import type { SiteAgentMessageV1 } from "@/packages/platform-data";

type WorkspacePayload = {
  site: PlatformSiteRecord;
  session?: SiteAgentSessionV1;
  input?: SitePublicBuildInputV1;
  versions: SiteVersionV4[];
  versionRoutes: Record<string, Array<{ path: string; title: string }>>;
  messages: SiteAgentMessageV1[];
  runs: SiteAgentRunV1[];
};

export function SiteAgentWorkspace({
  initialSite,
  initialInput,
  initialVersions
}: {
  initialSite: PlatformSiteRecord;
  initialInput: SitePublicBuildInputV1;
  initialVersions: SiteVersionV4[];
}) {
  const [workspace, setWorkspace] = useState<WorkspacePayload>({
    site: initialSite, input: initialInput, versions: initialVersions, versionRoutes: {}, messages: [], runs: []
  });
  const [mode, setMode] = useState<"discuss" | "apply">("apply");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string>();
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const [compare, setCompare] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<SiteElementSelectionV1>();
  const endRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const selectionModeRef = useRef(false);

  const latestCandidate = workspace.versions.find((version) => version.status === "candidate");
  const activeRun = workspace.runs.find((run) => run.status === "queued" || run.status === "running");
  const selectedVersion = workspace.versions.find((version) => version.id === selectedVersionId) ?? latestCandidate
    ?? workspace.versions.find((version) => version.status === "published");
  const fastPreview = activeRun?.fastPreviewPath || workspace.runs.find((run) => run.fastPreviewPath)?.fastPreviewPath;
  const previewUrl = selectedVersion
    ? `/api/site-versions/${encodeURIComponent(selectedVersion.id)}/artifact/`
    : fastPreview || "about:blank";
  const published = workspace.versions.find((version) => version.status === "published");
  const publishedPreviewUrl = published ? `/api/site-versions/${encodeURIComponent(published.id)}/artifact/` : undefined;

  const pages = selectedVersion && workspace.versionRoutes[selectedVersion.id]?.length
    ? workspace.versionRoutes[selectedVersion.id].map((route) => ({ id: `${selectedVersion.id}:${route.path}`, title: route.title, path: route.path }))
    : (workspace.input?.intent.pageRequirements ?? []).map((page) => ({ id: page.id, title: page.title, path: page.slug ? `/${page.slug}` : "/" }));
  const facts = workspace.input?.publicFacts ?? [];
  const offerings = workspace.input?.business.offerings ?? [];
  const assets = workspace.input?.business.assets ?? [];

  async function refresh() {
    const response = await fetch(`/api/site-agent/sessions?siteId=${encodeURIComponent(initialSite.id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await responseMessage(response));
    const next = await response.json() as WorkspacePayload;
    setWorkspace(next);
    if (!selectedVersionId && next.versions[0]) setSelectedVersionId(next.versions.find((version) => version.status === "candidate")?.id ?? next.versions[0].id);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/site-agent/sessions", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId: initialSite.id })
        });
        if (!response.ok) throw new Error(await responseMessage(response));
        if (!cancelled) setWorkspace(await response.json() as WorkspacePayload);
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initialSite.id]);

  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(() => { void refresh().catch((error) => setNotice(error.message)); }, 1800);
    return () => window.clearInterval(timer);
  }, [activeRun?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [workspace.messages.length]);
  useEffect(() => { selectionModeRef.current = selectionMode; }, [selectionMode]);

  async function submit() {
    const message = instruction.trim();
    if (!message || !workspace.session || busy) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const endpoint = mode === "discuss" ? "/api/site-agent/discuss" : "/api/site-agent/runs";
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: workspace.session.id, selection, ...(mode === "discuss" ? { message } : { instruction: message, kind: "focused_edit" }) })
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setInstruction("");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function restore(versionId: string) {
    if (busy || activeRun) return;
    setBusy(true); setNotice(undefined);
    try {
      const response = await fetch(`/api/site-versions/${encodeURIComponent(versionId)}/restore`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setCompare(false); setSelection(undefined); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  function bindPreviewSelection() {
    const frame = previewRef.current;
    const document = frame?.contentDocument;
    if (!document) return;
    const click = (event: MouseEvent) => {
      if (!selectionModeRef.current) return;
      const element = event.target instanceof Element ? event.target : undefined;
      if (!element || element === document.documentElement || element === document.body) return;
      event.preventDefault(); event.stopPropagation();
      document.querySelectorAll("[data-lodesta-owner-selected]").forEach((node) => { node.removeAttribute("data-lodesta-owner-selected"); (node as HTMLElement).style.outline = ""; });
      element.setAttribute("data-lodesta-owner-selected", "true");
      (element as HTMLElement).style.outline = "2px solid #c7861f";
      setSelection({
        route: previewRouteFromPath(new URL(frame!.contentWindow!.location.href).pathname),
        selector: selectorFor(element),
        workspaceRevisionId: selectedVersion?.workspaceRevisionId,
        versionId: selectedVersion?.id
      });
      setSelectionMode(false);
    };
    document.addEventListener("click", click, true);
  }

  async function publish() {
    if (!latestCandidate || busy) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/site-versions/${encodeURIComponent(latestCandidate.id)}/publish`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      await refresh();
      setNotice("Published version is live.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="site-agent-workspace">
      <header className="site-agent-toolbar">
        <div className="site-agent-title">
          <span className="site-agent-kicker">Website workspace</span>
          <h1>{workspace.input?.business.name ?? "Website"}</h1>
          <span className={`site-agent-state is-${activeRun ? "working" : latestCandidate ? "review" : workspace.site.status}`}>{activeRun ? stageLabel(activeRun) : latestCandidate ? "Ready to review" : workspace.site.status}</span>
        </div>
        <div className="site-agent-actions">
          <Link className="button secondary" href={`/sites/${workspace.site.slug}`} target="_blank">Open live site</Link>
          <button className="button primary" type="button" disabled={!latestCandidate || busy || Boolean(activeRun)} onClick={() => void publish()}>Publish</button>
        </div>
      </header>

      {notice ? <div className="site-agent-notice" role="status">{notice}</div> : null}

      <div className="site-agent-grid">
        <aside className="site-agent-rail" aria-label="Site structure and evidence">
          <section>
            <h2>Pages</h2>
            <nav className="site-agent-page-list">
              {pages.map((page) => <a key={page.id} href={previewRouteUrl(previewUrl, page.path)} target="site-agent-preview"><span>{page.title}</span><small>{page.path}</small></a>)}
            </nav>
          </section>
          <section>
            <h2>Business data</h2>
            <div className="site-agent-data-counts">
              <span><strong>{facts.length}</strong> verified facts</span>
              <span><strong>{offerings.length}</strong> services</span>
              <span><strong>{assets.length}</strong> assets</span>
            </div>
          </section>
          <section>
            <h2>Capabilities</h2>
            <div className="site-agent-tag-list">{workspace.input?.intent.enabledCapabilities.map((item) => <span key={item}>{item}</span>)}</div>
          </section>
          <section className="site-agent-history">
            <h2>Versions</h2>
            {workspace.versions.map((version) => (
              <button key={version.id} className={version.id === selectedVersion?.id ? "is-selected" : ""} type="button" onClick={() => setSelectedVersionId(version.id)}>
                <span>Version {version.number}</span><small>{version.status}</small>
              </button>
            ))}
            {selectedVersion ? <button type="button" onClick={() => void restore(selectedVersion.id)} disabled={busy || Boolean(activeRun)}><span>Restore selected</span><small>new candidate</small></button> : null}
          </section>
        </aside>

        <section className="site-agent-preview-column">
          <div className="site-agent-preview-bar">
            <div className="site-agent-segmented" aria-label="Preview viewport">
              <button type="button" className={viewport === "desktop" ? "is-active" : ""} onClick={() => setViewport("desktop")}>Desktop</button>
              <button type="button" className={viewport === "mobile" ? "is-active" : ""} onClick={() => setViewport("mobile")}>Mobile</button>
            </div>
            <div className="site-agent-preview-tools"><button type="button" className={selectionMode ? "is-active" : ""} onClick={() => setSelectionMode((value) => !value)}>Select element</button><button type="button" className={compare ? "is-active" : ""} disabled={!publishedPreviewUrl || published?.id === selectedVersion?.id} onClick={() => setCompare((value) => !value)}>Compare live</button></div>
          </div>
          {selection ? <div className="site-agent-selection-strip"><span>Selected: {selection.selector}</span><button type="button" onClick={() => setSelection(undefined)}>Clear</button></div> : null}
          <div className={`site-agent-preview-stage is-${viewport} ${compare ? "is-comparing" : ""}`}>
            {previewUrl === "about:blank" ? <div className="site-agent-empty-preview"><strong>{busy ? "Opening workspace" : "Build in progress"}</strong><span>The first verified preview will appear here.</span></div>
              : <iframe ref={previewRef} key={previewUrl} name="site-agent-preview" title="Website preview" src={previewUrl} onLoad={bindPreviewSelection} />}
            {compare && publishedPreviewUrl ? <iframe title="Published website comparison" src={publishedPreviewUrl} /> : null}
          </div>
        </section>

        <aside className="site-agent-command" aria-label="Website manager">
          <div className="site-agent-command-head">
            <div><span className="site-agent-kicker">Website manager</span><h2>Make a change</h2></div>
            <span className={`site-agent-dot ${activeRun ? "is-active" : ""}`} aria-label={activeRun ? "Agent working" : "Agent ready"} />
          </div>
          <div className="site-agent-messages">
            {workspace.messages.length === 0 ? <div className="site-agent-empty-message">Ask about the site or describe a change. Apply creates a new reviewable version.</div> : null}
            {workspace.messages.map((message) => <article key={message.id} className={`site-agent-message is-${message.role}`}><small>{message.role === "agent" ? "Manager" : "You"}</small><p>{message.content}</p></article>)}
            {activeRun ? <div className="site-agent-runline"><span /><div><strong>{stageLabel(activeRun)}</strong><small>Run {activeRun.id.slice(-8)}</small></div></div> : null}
            <div ref={endRef} />
          </div>
          <div className="site-agent-compose">
            <div className="site-agent-segmented is-command" aria-label="Command mode">
              <button type="button" className={mode === "discuss" ? "is-active" : ""} onClick={() => setMode("discuss")}>Discuss</button>
              <button type="button" className={mode === "apply" ? "is-active" : ""} onClick={() => setMode("apply")}>Apply</button>
            </div>
            <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={mode === "apply" ? "Describe the change to make…" : "Ask about the site…"} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit(); }} />
            <div className="site-agent-compose-footer"><span>{mode === "apply" ? "Creates a candidate" : "No files changed"}</span><button className="button primary" type="button" disabled={!instruction.trim() || busy || Boolean(activeRun)} onClick={() => void submit()}>{busy ? "Working" : mode === "apply" ? "Apply" : "Send"}</button></div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function selectorFor(element: Element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const dataId = element.getAttribute("data-lodesta-fact-id") || element.getAttribute("data-lodesta-form-id");
  if (dataId) return `[${element.hasAttribute("data-lodesta-fact-id") ? "data-lodesta-fact-id" : "data-lodesta-form-id"}="${CSS.escape(dataId)}"]`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.tagName.toLowerCase() !== "body" && parts.length < 4) {
    const siblings = current.parentElement ? [...current.parentElement.children].filter((node) => node.tagName === current!.tagName) : [];
    parts.unshift(`${current.tagName.toLowerCase()}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ""}`);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function previewRouteUrl(base: string, path: string) {
  const suffix = path.replace(/^\/+|\/+$/g, "");
  return suffix ? `${base.replace(/\/$/, "")}/${suffix}` : `${base.replace(/\/$/, "")}/`;
}

function previewRouteFromPath(pathname: string) {
  const marker = pathname.match(/\/(?:artifact|preview)(\/.*)?$/)?.[1] ?? "/";
  return marker.startsWith("/") ? marker : `/${marker}`;
}

function stageLabel(run: SiteAgentRunV1) {
  return ({ queued: "Queued", authoring: "Designing", building: "Building", fast_preview: "Preview ready", verifying: "Running QA", candidate_ready: "Candidate ready", failed: "Needs review" } as const)[run.stage];
}

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `Request failed (${response.status})`;
}
