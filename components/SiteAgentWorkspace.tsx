"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import type {
  OperatorQueueItem,
  PlatformSiteRecord,
  SiteAgentRun,
  SiteAgentSession,
  SiteElementSelection,
  SitePublicationReadiness,
  SitePublicBuildInput,
  SiteVersion
} from "@/packages/site-contracts";
import type { SiteAgentMessage } from "@/packages/platform-data";

type WorkspacePayload = {
  site: PlatformSiteRecord;
  session?: SiteAgentSession;
  input?: SitePublicBuildInput;
  versions: SiteVersion[];
  versionRoutes: Record<string, Array<{ path: string; title: string }>>;
  messages: SiteAgentMessage[];
  runs: SiteAgentRun[];
  readiness?: SitePublicationReadiness;
  openFindings?: OperatorQueueItem[];
  activeRunActivity?: string;
};

type DiscussionSuggestion = {
  response: string;
  action: string;
};

type DiscussionResult = {
  discussion: {
    response: string;
    proposedAction?: string;
    requiresApply: boolean;
  };
};

type DesktopPanelMode = "split" | "collapsed" | "full-chat";

type StoredPanelLayout = {
  version: 1;
  width: number;
  collapsed: boolean;
};

const DESKTOP_BREAKPOINT = 900;
const COLLAPSED_PANEL_WIDTH = 52;
const MIN_SPLIT_PANEL_WIDTH = 320;
const FULL_CHAT_THRESHOLD = 0.6;
const PANEL_STORAGE_VERSION = 1;

export function SiteAgentWorkspace({
  initialSite,
  initialInput,
  initialVersions,
  isAdmin = false
}: {
  initialSite: PlatformSiteRecord;
  initialInput: SitePublicBuildInput;
  initialVersions: SiteVersion[];
  isAdmin?: boolean;
}) {
  const [workspace, setWorkspace] = useState<WorkspacePayload>({
    site: initialSite,
    input: initialInput,
    versions: initialVersions,
    versionRoutes: {},
    messages: [],
    runs: []
  });
  const [discussMode, setDiscussMode] = useState(false);
  const [discussionSuggestion, setDiscussionSuggestion] = useState<DiscussionSuggestion>();
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("chat");
  const [compactViewport, setCompactViewport] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string>();
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const [selectedPagePath, setSelectedPagePath] = useState("/");
  const [iframeSrc, setIframeSrc] = useState("about:blank");
  const [compare, setCompare] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<SiteElementSelection>();
  const [clock, setClock] = useState(Date.now());
  const [panelMode, setPanelMode] = useState<DesktopPanelMode>("split");
  const [panelWidth, setPanelWidth] = useState(400);
  const [lastSplitWidth, setLastSplitWidth] = useState(400);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [panelLayoutReady, setPanelLayoutReady] = useState(false);
  const [copiedIdentifier, setCopiedIdentifier] = useState<string>();
  const workspaceRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const previewListenerCleanupRef = useRef<(() => void) | undefined>(undefined);
  const selectionModeRef = useRef(false);
  const selectedPagePathRef = useRef("/");
  const activeResizePointerRef = useRef<number | undefined>(undefined);

  const latestCandidate = workspace.versions.find((version) => version.status === "candidate");
  const activeRun = workspace.runs.find((run) => run.status === "queued" || run.status === "running");
  const waitingRun = !activeRun ? workspace.runs.find((run) => run.status === "needs_input") : undefined;
  const failedRun = !activeRun ? workspace.runs.find((run) => run.status === "failed") : undefined;
  const selectedVersion = workspace.versions.find((version) => version.id === selectedVersionId)
    ?? latestCandidate
    ?? workspace.versions.find((version) => version.status === "published")
    ?? workspace.versions[0];
  const fastPreview = activeRun?.fastPreviewPath;
  const previewBaseUrl = fastPreview
    ?? (selectedVersion ? `/api/site-versions/${encodeURIComponent(selectedVersion.id)}/artifact/` : "about:blank");
  const previewIdentity = fastPreview
    ? `run:${activeRun?.id ?? fastPreview}`
    : selectedVersion
      ? `version:${selectedVersion.id}`
      : "blank";
  const published = workspace.versions.find((version) => version.status === "published");
  const publishedPreviewUrl = published
    ? `/api/site-versions/${encodeURIComponent(published.id)}/artifact/`
    : undefined;
  const pages = selectedVersion && workspace.versionRoutes[selectedVersion.id]?.length
    ? workspace.versionRoutes[selectedVersion.id].map((route) => ({
        id: `${selectedVersion.id}:${route.path}`,
        title: route.title,
        path: normalizePagePath(route.path)
      }))
    : (workspace.input?.intent.pageRequirements ?? []).map((page) => ({
        id: page.id,
        title: page.title,
        path: normalizePagePath(page.slug ? `/${page.slug}` : "/")
      }));
  const selectedPageExists = pages.some((page) => page.path === selectedPagePath);
  const selectedPageValue = selectedPageExists ? selectedPagePath : "/";
  const status = workspaceStatus({ site: workspace.site, activeRun, latestCandidate, readiness: workspace.readiness });
  const diagnosticRuns = workspace.runs.slice(0, 4);
  const desktopPanelActive = workspaceWidth >= DESKTOP_BREAKPOINT;
  const desktopPanelCollapsed = desktopPanelActive && panelMode === "collapsed";
  const desktopFullChat = desktopPanelActive && panelMode === "full-chat";
  const panelStyle = { "--site-agent-panel-width": `${panelWidth}px` } as CSSProperties;

  async function refresh() {
    const response = await fetch(`/api/site-agent/sessions?siteId=${encodeURIComponent(initialSite.id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await responseMessage(response));
    const next = await response.json() as WorkspacePayload;
    setWorkspace(next);
    setSelectedVersionId((current) => {
      if (current && next.versions.some((version) => version.id === current)) return current;
      return next.versions.find((version) => version.status === "candidate")?.id
        ?? next.versions.find((version) => version.status === "published")?.id
        ?? next.versions[0]?.id;
    });
  }

  async function copyIdentifier(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedIdentifier(key);
      window.setTimeout(() => setCopiedIdentifier((current) => current === key ? undefined : current), 1600);
    } catch {
      setNotice(`Could not copy ${value}. Select the identifier and copy it manually.`);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/site-agent/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ siteId: initialSite.id })
        });
        if (!response.ok) throw new Error(await responseMessage(response));
        if (!cancelled) {
          const next = await response.json() as WorkspacePayload;
          setWorkspace(next);
          setSelectedVersionId(next.versions.find((version) => version.status === "candidate")?.id
            ?? next.versions.find((version) => version.status === "published")?.id
            ?? next.versions[0]?.id);
        }
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
    const timer = window.setInterval(() => {
      void refresh().catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [activeRun?.id]);

  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRun?.id]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const update = () => setCompactViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWorkspaceWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (workspaceWidth < DESKTOP_BREAKPOINT || panelLayoutReady) return;
    const fallbackWidth = defaultPanelWidth(workspaceWidth);
    const stored = readPanelLayout(initialSite.id);
    const restoredWidth = clampSplitWidth(stored?.width ?? fallbackWidth, workspaceWidth);
    setPanelWidth(restoredWidth);
    setLastSplitWidth(restoredWidth);
    setPanelMode(stored?.collapsed ? "collapsed" : "split");
    setPanelLayoutReady(true);
  }, [initialSite.id, panelLayoutReady, workspaceWidth]);

  useEffect(() => {
    if (workspaceWidth < DESKTOP_BREAKPOINT || !panelLayoutReady) return;
    const clampedWidth = clampSplitWidth(lastSplitWidth, workspaceWidth);
    if (clampedWidth === lastSplitWidth) return;
    setLastSplitWidth(clampedWidth);
    if (panelMode === "split") setPanelWidth(clampedWidth);
  }, [lastSplitWidth, panelLayoutReady, panelMode, workspaceWidth]);

  useEffect(() => {
    if (workspaceWidth < DESKTOP_BREAKPOINT || !panelLayoutReady || panelMode === "full-chat") return;
    writePanelLayout(initialSite.id, {
      version: PANEL_STORAGE_VERSION,
      width: clampSplitWidth(lastSplitWidth, workspaceWidth),
      collapsed: panelMode === "collapsed"
    });
  }, [initialSite.id, lastSplitWidth, panelLayoutReady, panelMode, workspaceWidth]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  }, [instruction]);

  useEffect(() => {
    if (!isResizing) return;
    const move = (event: PointerEvent) => {
      if (activeResizePointerRef.current === undefined || event.pointerId !== activeResizePointerRef.current) return;
      const nextWidth = panelWidthAt(event.clientX);
      setPanelWidth(nextWidth);
    };
    const finish = (event: PointerEvent) => {
      if (activeResizePointerRef.current === undefined || event.pointerId !== activeResizePointerRef.current) return;
      finishPanelResize(panelWidthAt(event.clientX));
    };
    const cancel = (event: PointerEvent) => {
      if (activeResizePointerRef.current === undefined || event.pointerId !== activeResizePointerRef.current) return;
      cancelPanelResize();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [isResizing, lastSplitWidth, workspaceWidth]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [workspace.messages.length, activeRun?.stage, discussionSuggestion?.action]);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  useEffect(() => {
    selectedPagePathRef.current = selectedPagePath;
  }, [selectedPagePath]);

  useEffect(() => {
    if (selectedPageExists || selectedPagePath === "/") return;
    setSelectedPagePath("/");
    selectedPagePathRef.current = "/";
  }, [selectedPageExists, selectedPagePath]);

  useEffect(() => {
    const requestedPath = pages.some((page) => page.path === selectedPagePathRef.current)
      ? selectedPagePathRef.current
      : "/";
    setIframeSrc(previewRouteUrl(previewBaseUrl, requestedPath));
  }, [previewIdentity, previewBaseUrl]);

  useEffect(() => () => previewListenerCleanupRef.current?.(), []);

  async function submit() {
    const message = instruction.trim();
    if (!message || !workspace.session || busy || activeRun) return;
    setBusy(true);
    setNotice(undefined);
    setDiscussionSuggestion(undefined);
    try {
      const endpoint = discussMode ? "/api/site-agent/discuss" : "/api/site-agent/runs";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: workspace.session.id,
          selection,
          ...(discussMode ? { message } : { instruction: message, resumeRunId: waitingRun?.id })
        })
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      if (discussMode) {
        const result = await response.json() as DiscussionResult;
        if (result.discussion.requiresApply && result.discussion.proposedAction) {
          setDiscussionSuggestion({ response: result.discussion.response, action: result.discussion.proposedAction });
        }
      }
      setInstruction("");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function useSuggestion() {
    if (!discussionSuggestion) return;
    setDiscussMode(false);
    setInstruction(discussionSuggestion.action);
    setDiscussionSuggestion(undefined);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function navigatePreview(path: string) {
    const normalized = normalizePagePath(path);
    setSelectedPagePath(normalized);
    selectedPagePathRef.current = normalized;
    setSelection(undefined);
    const target = previewRouteUrl(previewBaseUrl, normalized);
    const frameWindow = previewRef.current?.contentWindow;
    if (frameWindow && previewBaseUrl !== "about:blank") frameWindow.location.assign(target);
    else setIframeSrc(target);
  }

  function handlePreviewLoad() {
    previewListenerCleanupRef.current?.();
    const frame = previewRef.current;
    const document = frame?.contentDocument;
    if (!frame || !document) return;
    try {
      const route = previewRouteFromPath(new URL(frame.contentWindow!.location.href).pathname);
      setSelectedPagePath(route);
      selectedPagePathRef.current = route;
    } catch {
      // Same-origin previews are expected; a navigated external page simply cannot be selected.
    }

    const click = (event: MouseEvent) => {
      if (!selectionModeRef.current) return;
      const element = document.defaultView && event.target instanceof document.defaultView.Element
        ? event.target
        : undefined;
      if (!element || element === document.documentElement || element === document.body) return;
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll("[data-lodesta-owner-selected]").forEach((node) => {
        node.removeAttribute("data-lodesta-owner-selected");
        (node as HTMLElement).style.outline = "";
      });
      element.setAttribute("data-lodesta-owner-selected", "true");
      (element as HTMLElement).style.outline = "2px solid #c7861f";
      setSelection({
        route: previewRouteFromPath(new URL(frame.contentWindow!.location.href).pathname),
        selector: selectorFor(element),
        workspaceRevisionId: selectedVersion?.workspaceRevisionId,
        versionId: selectedVersion?.id
      });
      setSelectionMode(false);
    };
    document.addEventListener("click", click, true);
    previewListenerCleanupRef.current = () => document.removeEventListener("click", click, true);
  }

  async function restore(versionId: string) {
    if (busy || activeRun) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/site-versions/${encodeURIComponent(versionId)}/restore`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setCompare(false);
      setSelection(undefined);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
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

  async function retry() {
    if (!failedRun || busy || activeRun) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/site-agent/runs/${encodeURIComponent(failedRun.id)}/retry`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function persistPanelLayout(collapsed: boolean, width: number) {
    const measuredWorkspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? workspaceWidth;
    if (measuredWorkspaceWidth < DESKTOP_BREAKPOINT) return;
    writePanelLayout(initialSite.id, {
      version: PANEL_STORAGE_VERSION,
      width: clampSplitWidth(width, measuredWorkspaceWidth),
      collapsed
    });
  }

  function collapsePanel() {
    const persistedWidth = panelMode === "split" && !isResizing
      ? clampSplitWidth(panelWidth, workspaceWidth)
      : lastSplitWidth;
    if (panelMode === "split" && !isResizing) setLastSplitWidth(persistedWidth);
    persistPanelLayout(true, persistedWidth);
    activeResizePointerRef.current = undefined;
    setIsResizing(false);
    setPanelMode("collapsed");
  }

  function restoreSplitPanel() {
    const restoredWidth = clampSplitWidth(lastSplitWidth || defaultPanelWidth(workspaceWidth), workspaceWidth);
    setPanelWidth(restoredWidth);
    setLastSplitWidth(restoredWidth);
    activeResizePointerRef.current = undefined;
    setIsResizing(false);
    setPanelMode("split");
    persistPanelLayout(false, restoredWidth);
  }

  function openFullChat() {
    if (panelMode === "split" && !isResizing) setLastSplitWidth(clampSplitWidth(panelWidth, workspaceWidth));
    activeResizePointerRef.current = undefined;
    setIsResizing(false);
    setPanelMode("full-chat");
  }

  function panelWidthAt(clientX: number) {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return panelWidth;
    return Math.max(COLLAPSED_PANEL_WIDTH, Math.min(clientX - bounds.left, bounds.width * FULL_CHAT_THRESHOLD));
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || panelMode !== "split") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeResizePointerRef.current = event.pointerId;
    setIsResizing(true);
  }

  function handleResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isResizing || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const nextWidth = panelWidthAt(event.clientX);
    setPanelWidth(nextWidth);
  }

  function finishResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isResizing) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finishPanelResize(panelWidthAt(event.clientX));
  }

  function finishPanelResize(nextWidth: number) {
    activeResizePointerRef.current = undefined;
    setIsResizing(false);
    if (nextWidth <= MIN_SPLIT_PANEL_WIDTH) {
      collapsePanel();
      return;
    }
    if (nextWidth >= workspaceWidth * FULL_CHAT_THRESHOLD) {
      openFullChat();
      return;
    }
    const clampedWidth = clampSplitWidth(nextWidth, workspaceWidth);
    setPanelWidth(clampedWidth);
    setLastSplitWidth(clampedWidth);
    persistPanelLayout(false, clampedWidth);
  }

  function cancelResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isResizing) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    cancelPanelResize();
  }

  function cancelPanelResize() {
    const restoredWidth = clampSplitWidth(lastSplitWidth, workspaceWidth);
    setPanelWidth(restoredWidth);
    activeResizePointerRef.current = undefined;
    setIsResizing(false);
  }

  function handleResizeKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (panelMode !== "split") return;
    if (event.key === "Home") {
      event.preventDefault();
      collapsePanel();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      openFullChat();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const step = event.shiftKey ? 48 : 16;
    const nextWidth = clampSplitWidth(panelWidth + direction * step, workspaceWidth);
    setPanelWidth(nextWidth);
    setLastSplitWidth(nextWidth);
    persistPanelLayout(false, nextWidth);
  }

  return (
    <main
      ref={workspaceRef}
      className="site-agent-workspace"
      data-mobile-pane={mobilePane}
      data-panel-mode={panelMode}
      data-panel-ready={panelLayoutReady ? "true" : undefined}
      data-resizing={isResizing ? "true" : undefined}
      style={panelStyle}
    >
      <header className="site-agent-workspace-header">
        <div className="site-agent-brand-bar">
          <button className="site-agent-collapsed-toggle" type="button" aria-label="Expand chat panel" title="Expand chat panel" onClick={restoreSplitPanel}>
            <ChatIcon />
          </button>
          <div className="site-agent-command-title"><strong>Website manager</strong><small className={`is-${status.tone}`}>{status.label}</small></div>
          <div className="site-agent-panel-controls" aria-label="Chat panel controls">
            {panelMode === "full-chat" ? (
              <button type="button" aria-label="Return to split view" title="Return to split view" onClick={restoreSplitPanel}>
                <RestoreSplitIcon />
              </button>
            ) : (
              <>
                <button type="button" aria-label="Collapse chat panel" title="Collapse chat panel" onClick={collapsePanel}>
                  <CollapsePanelIcon />
                </button>
                <button type="button" aria-label="Open full chat" title="Open full chat" onClick={openFullChat}>
                  <FullChatIcon />
                </button>
              </>
            )}
          </div>
          <div className="site-agent-mobile-switch" aria-label="Workspace pane">
            <button type="button" className={mobilePane === "chat" ? "is-active" : ""} onClick={() => setMobilePane("chat")}>Chat</button>
            <button type="button" className={mobilePane === "preview" ? "is-active" : ""} onClick={() => setMobilePane("preview")}>Preview</button>
          </div>
        </div>

        <div className="site-agent-preview-bar">
          <span className="site-agent-preview-tab" aria-current="page">Preview</span>
          <label className="site-agent-page-picker">
            <span className="site-agent-visually-hidden">Website page</span>
            <select value={selectedPageValue} onChange={(event) => navigatePreview(event.target.value)} disabled={!pages.length || previewBaseUrl === "about:blank"}>
              {pages.length ? pages.map((page) => <option key={page.id} value={page.path}>{page.title}</option>) : <option value="/">Homepage</option>}
            </select>
          </label>
          <div className="site-agent-preview-controls" aria-label="Preview viewport">
            <button type="button" className={viewport === "desktop" ? "is-active" : ""} aria-pressed={viewport === "desktop"} onClick={() => setViewport("desktop")}>Desktop</button>
            <button type="button" className={viewport === "mobile" ? "is-active" : ""} aria-pressed={viewport === "mobile"} onClick={() => setViewport("mobile")}>Mobile</button>
          </div>
          <button className={`site-agent-tool-button ${selectionMode ? "is-active" : ""}`} type="button" aria-pressed={selectionMode} onClick={() => setSelectionMode((value) => !value)}>Select</button>
          <button className={`site-agent-tool-button ${compare ? "is-active" : ""}`} type="button" aria-pressed={compare} disabled={!publishedPreviewUrl || (!fastPreview && published?.id === selectedVersion?.id)} onClick={() => setCompare((value) => !value)}>Compare</button>
          <details className="site-agent-history-menu">
            <summary>History</summary>
            <div>
              {workspace.versions.map((version) => (
                <button key={version.id} className={version.id === selectedVersion?.id ? "is-selected" : ""} type="button" onClick={() => {
                  setSelectedVersionId(version.id);
                  setCompare(false);
                  setSelection(undefined);
                }}>
                  <span>Version {version.number}</span>
                  <small>{version.status}</small>
                </button>
              ))}
              {selectedVersion ? <button type="button" disabled={busy || Boolean(activeRun)} onClick={() => void restore(selectedVersion.id)}><span>Restore selected</span><small>New candidate</small></button> : null}
            </div>
          </details>
          {isAdmin ? (
            <details className="site-agent-diagnostics-menu">
              <summary aria-label="Open admin diagnostics" title="Admin diagnostics">Admin</summary>
              <section className="site-agent-diagnostics" aria-labelledby="site-agent-diagnostics-title">
                <div className="site-agent-diagnostics-heading"><span id="site-agent-diagnostics-title">Admin diagnostics</span><Link href={`/admin/sites/${workspace.site.slug}`}>Manage site</Link></div>
                <div className="site-agent-identifier-row"><div><span>Site ID</span><code title={workspace.site.id}>{workspace.site.id}</code></div><button type="button" onClick={() => void copyIdentifier(workspace.site.id, "site")}>{copiedIdentifier === "site" ? "Copied" : "Copy"}</button></div>
                <div className="site-agent-diagnostic-runs"><span className="site-agent-diagnostic-label">Recent runs</span>{diagnosticRuns.map((run) => <div className="site-agent-run-identifier" key={run.id}><div><Link href={`/admin/runs/${run.id}`}>{run.kind.replaceAll("_", " ")}</Link><code title={run.id}>{run.id}</code><small>{run.status} · {run.stage}</small></div><button type="button" onClick={() => void copyIdentifier(run.id, run.id)}>{copiedIdentifier === run.id ? "Copied" : "Copy"}</button></div>)}{!diagnosticRuns.length ? <small className="site-agent-no-runs">No runs in this workspace yet.</small> : null}</div>
                <Link className="site-agent-all-activity" href={`/admin/runs?siteId=${encodeURIComponent(workspace.site.id)}`}>View all activity</Link>
              </section>
            </details>
          ) : null}
          {workspace.site.publishedVersionId ? <Link className="site-agent-tool-link" href={`/sites/${workspace.site.slug}`} target="_blank">Open live</Link> : null}
          <button className="button primary site-agent-publish" type="button" disabled={!latestCandidate || workspace.readiness?.status !== "ready" || busy || Boolean(activeRun)} onClick={() => void publish()}>Publish</button>
        </div>
      </header>

      <div className="site-agent-body">
        <aside
          className="site-agent-command"
          aria-label="Website manager"
          aria-hidden={compactViewport && mobilePane !== "chat" ? true : undefined}
          inert={compactViewport && mobilePane !== "chat" ? true : undefined}
        >
          <div className="site-agent-command-content" aria-hidden={desktopPanelCollapsed ? true : undefined} inert={desktopPanelCollapsed ? true : undefined}>
          <div className="site-agent-messages" aria-live="polite" aria-busy={busy && !workspace.session ? true : undefined}>
            {busy && !workspace.session ? (
              <div className="site-agent-loading-message" role="status">
                <span className="site-agent-send-spinner" aria-hidden="true" />
                <div>
                  <strong>Opening workspace</strong>
                  <span>Loading conversation and site context.</span>
                </div>
              </div>
            ) : workspace.messages.length === 0 ? (
              <div className="site-agent-empty-message">
                <strong>What should we work on?</strong>
                <span>Describe a change to the site, or switch to Discuss when you only want advice.</span>
              </div>
            ) : null}
            {workspace.messages.map((message) => (
              <article key={message.id} className={`site-agent-message is-${message.role}`} aria-label={messageAuthorLabel(message.role)}>
                <p>{message.content}</p>
              </article>
            ))}
            {discussionSuggestion ? (
              <article className="site-agent-discussion-suggestion">
                <strong>Suggested change ready</strong>
                <div>
                  <button className="button primary" type="button" onClick={useSuggestion}>Use this suggestion</button>
                  <button className="button secondary" type="button" onClick={() => setDiscussionSuggestion(undefined)}>Dismiss</button>
                </div>
              </article>
            ) : null}
            {activeRun ? (
              <div className="site-agent-runline">
                <span />
                <div><strong>{stageLabel(activeRun)}</strong><small>{elapsedLabel(clock - Date.parse(activeRun.startedAt))} · {workspace.activeRunActivity ?? "starting"}</small></div>
              </div>
            ) : null}
            {waitingRun ? (
              <div className="site-agent-runline">
                <span />
                <div><strong>Your answer is needed</strong><small>{waitingRun.inputQuestion ?? "Answer the latest Lodesta question to continue this edit."}</small></div>
              </div>
            ) : null}
            {failedRun ? (
              <div className="site-agent-runline is-error">
                <span />
                <div><strong>Change needs attention</strong><small>{failedRun.failureReason ?? "The run did not complete."}</small><button className="button secondary" type="button" disabled={busy} onClick={() => void retry()}>Retry change</button></div>
              </div>
            ) : null}
            {notice ? <div className="site-agent-inline-notice" role="status">{notice}</div> : null}
            <div ref={endRef} />
          </div>

          <div className="site-agent-compose">
            {selection ? <div className="site-agent-selection-strip"><span>Selected: {selection.selector}</span><button type="button" onClick={() => setSelection(undefined)}>Clear</button></div> : null}
            <textarea
              ref={composerRef}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={discussMode ? "Ask about a possible change..." : waitingRun ? "Answer the question above..." : "Describe what you want to change..."}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
              }}
              rows={1}
            />
            <div className="site-agent-compose-footer">
              <label className={`site-agent-discuss-toggle ${discussMode ? "is-active" : ""}`}>
                <input type="checkbox" checked={discussMode} onChange={(event) => setDiscussMode(event.target.checked)} />
                <span aria-hidden="true" />
                Discuss
              </label>
              <button
                className="site-agent-send-button"
                type="button"
                aria-label={busy ? "Working" : discussMode ? "Send discussion message" : "Build requested change"}
                title={busy ? "Working" : discussMode ? "Send discussion message" : "Build requested change"}
                aria-busy={busy ? true : undefined}
                disabled={!instruction.trim() || busy || Boolean(activeRun)}
                onClick={() => void submit()}
              >
                {busy ? <span className="site-agent-send-spinner" aria-hidden="true" /> : <ArrowUpIcon />}
              </button>
            </div>
          </div>
          </div>
        </aside>

        <div
          className="site-agent-panel-resizer"
          role="separator"
          aria-label="Resize chat panel"
          aria-orientation="vertical"
          aria-valuemin={COLLAPSED_PANEL_WIDTH}
          aria-valuemax={Math.max(MIN_SPLIT_PANEL_WIDTH, Math.round(workspaceWidth * FULL_CHAT_THRESHOLD))}
          aria-valuenow={Math.round(panelWidth)}
          tabIndex={0}
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={finishResize}
          onPointerCancel={cancelResize}
          onKeyDown={handleResizeKey}
        >
          <span aria-hidden="true" />
        </div>
        {isResizing ? <div className="site-agent-resize-shield" aria-hidden="true" /> : null}

        <section
          className="site-agent-preview-column"
          aria-label="Website preview"
          aria-hidden={(compactViewport && mobilePane !== "preview") || desktopFullChat ? true : undefined}
          inert={(compactViewport && mobilePane !== "preview") || desktopFullChat ? true : undefined}
        >
          {latestCandidate && workspace.readiness?.status === "blocked" ? (
            <details className="site-agent-blockers">
              <summary>{workspace.readiness.blockers.length} publication blocker{workspace.readiness.blockers.length === 1 ? "" : "s"}</summary>
              <ul>{workspace.readiness.blockers.map((blocker) => <li key={`${blocker.code}:${blocker.referenceId ?? "site"}`}>{blocker.message}</li>)}</ul>
            </details>
          ) : null}
          <div className={`site-agent-preview-stage is-${viewport} ${compare ? "is-comparing" : ""}`}>
            {previewBaseUrl === "about:blank" ? (
              <div className="site-agent-empty-preview"><strong>{busy ? "Opening workspace" : "No preview yet"}</strong><span>The first verified preview will appear here.</span></div>
            ) : (
              <iframe ref={previewRef} key={previewIdentity} name="site-agent-preview" title="Website preview" src={iframeSrc} onLoad={handlePreviewLoad} />
            )}
            {compare && publishedPreviewUrl ? <iframe title="Published website comparison" src={previewRouteUrl(publishedPreviewUrl, selectedPagePath)} /> : null}
          </div>
        </section>
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
    const siblings = current.parentElement
      ? [...current.parentElement.children].filter((node) => node.tagName === current!.tagName)
      : [];
    parts.unshift(`${current.tagName.toLowerCase()}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ""}`);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function normalizePagePath(path: string) {
  const suffix = path.trim().replace(/^\/+|\/+$/g, "");
  return suffix ? `/${suffix}` : "/";
}

function panelStorageKey(siteId: string) {
  return `lodesta:site-agent-panel:v${PANEL_STORAGE_VERSION}:${siteId}`;
}

function readPanelLayout(siteId: string): StoredPanelLayout | undefined {
  try {
    const value = window.localStorage.getItem(panelStorageKey(siteId));
    if (!value) return undefined;
    const parsed = JSON.parse(value) as Partial<StoredPanelLayout>;
    if (parsed.version !== PANEL_STORAGE_VERSION || !Number.isFinite(parsed.width) || typeof parsed.collapsed !== "boolean") return undefined;
    return parsed as StoredPanelLayout;
  } catch {
    return undefined;
  }
}

function writePanelLayout(siteId: string, layout: StoredPanelLayout) {
  try {
    window.localStorage.setItem(panelStorageKey(siteId), JSON.stringify(layout));
  } catch {
    // Private browsing and storage policies may make local persistence unavailable.
  }
}

function defaultPanelWidth(workspaceWidth: number) {
  return Math.min(430, Math.max(360, workspaceWidth * 0.3));
}

function clampSplitWidth(width: number, workspaceWidth: number) {
  const maximum = Math.max(MIN_SPLIT_PANEL_WIDTH, workspaceWidth * FULL_CHAT_THRESHOLD - 1);
  return Math.round(Math.min(maximum, Math.max(MIN_SPLIT_PANEL_WIDTH, Number.isFinite(width) ? width : defaultPanelWidth(workspaceWidth))));
}

function messageAuthorLabel(role: SiteAgentMessage["role"]) {
  if (role === "agent") return "Lodesta message";
  if (role === "owner") return "Your message";
  if (role === "operator") return "Operator message";
  return `${role} message`;
}

function ArrowUpIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4m0 0L5.5 8.5M10 4l4.5 4.5" /></svg>;
}

function ChatIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12v8H9l-4 3v-3H4z" /></svg>;
}

function CollapsePanelIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4h13v12h-13zM7 4v12m5.5-8.5L10 10l2.5 2.5" /></svg>;
}

function FullChatIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 3.5h-4v4m9-4h4v4m-9 9h-4v-4m13 0v4h-4M7 7l-3.5-3.5M13 7l3.5-3.5M7 13l-3.5 3.5m9.5-3.5 3.5 3.5" /></svg>;
}

function RestoreSplitIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4h13v12h-13zM8 4v12m4-8.5L9.5 10l2.5 2.5" /></svg>;
}

function previewRouteUrl(base: string, path: string) {
  if (base === "about:blank") return base;
  const suffix = normalizePagePath(path).replace(/^\//, "");
  return suffix ? `${base.replace(/\/$/, "")}/${suffix}` : `${base.replace(/\/$/, "")}/`;
}

function previewRouteFromPath(pathname: string) {
  const marker = pathname.match(/\/(?:artifact|preview)(\/.*)?$/)?.[1] ?? "/";
  return normalizePagePath(marker);
}

function workspaceStatus({
  site,
  activeRun,
  latestCandidate,
  readiness
}: {
  site: PlatformSiteRecord;
  activeRun?: SiteAgentRun;
  latestCandidate?: SiteVersion;
  readiness?: SitePublicationReadiness;
}) {
  if (activeRun) return { label: stageLabel(activeRun), tone: "working" };
  if (latestCandidate && readiness?.status === "ready") return { label: "Ready to publish", tone: "ready" };
  if (latestCandidate) return { label: "Review required", tone: "review" };
  return { label: site.status.replaceAll("_", " "), tone: site.status };
}

function stageLabel(run: SiteAgentRun) {
  return ({
    queued: "Queued",
    authoring: "Designing",
    building: "Building",
    fast_preview: "Preview ready",
    verifying: "Running QA",
    needs_input: "Waiting for your answer",
    candidate_ready: "Candidate ready",
    failed: "Needs review"
  } as const)[run.stage];
}

function elapsedLabel(durationMs: number) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string; question?: string; message?: string } | null;
  return body?.question ?? body?.message ?? body?.error ?? `Request failed (${response.status})`;
}
