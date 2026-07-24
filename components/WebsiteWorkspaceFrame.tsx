"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

type DesktopPanelMode = "split" | "collapsed" | "full-chat";

type StoredPanelLayout = {
  version: 1;
  width: number;
  collapsed: boolean;
};

type MobilePane = "chat" | "preview";

const DESKTOP_BREAKPOINT = 900;
const COLLAPSED_PANEL_WIDTH = 52;
const MIN_SPLIT_PANEL_WIDTH = 320;
const FULL_CHAT_THRESHOLD = 0.6;
const PANEL_STORAGE_VERSION = 1;

export function WebsiteWorkspaceFrame({
  storageId,
  backHref,
  backLabel,
  commandTitle,
  previewToolbar,
  mobilePreviewActions,
  mobileOutcomeAction,
  onMobilePaneChange,
  commandLabel = "Website manager",
  previewLabel = "Website preview",
  commandContent,
  previewContent
}: {
  storageId: string;
  backHref: string;
  backLabel: string;
  commandTitle: ReactNode;
  previewToolbar: ReactNode;
  mobilePreviewActions?: ReactNode;
  mobileOutcomeAction?: ReactNode;
  onMobilePaneChange?(pane: MobilePane): void;
  commandLabel?: string;
  previewLabel?: string;
  commandContent: ReactNode;
  previewContent: ReactNode;
}) {
  const [mobilePane, setMobilePane] = useState<MobilePane>("chat");
  const [compactViewport, setCompactViewport] = useState(false);
  const [panelMode, setPanelMode] = useState<DesktopPanelMode>("split");
  const [panelWidth, setPanelWidth] = useState(400);
  const [lastSplitWidth, setLastSplitWidth] = useState(400);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [panelLayoutReady, setPanelLayoutReady] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const activeResizePointerRef = useRef<number | undefined>(undefined);
  const desktopPanelActive = workspaceWidth >= DESKTOP_BREAKPOINT;
  const desktopPanelCollapsed = desktopPanelActive && panelMode === "collapsed";
  const desktopFullChat = desktopPanelActive && panelMode === "full-chat";
  const panelStyle = { "--site-agent-panel-width": `${panelWidth}px` } as CSSProperties;

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
    const stored = readPanelLayout(storageId);
    const restoredWidth = clampSplitWidth(stored?.width ?? fallbackWidth, workspaceWidth);
    setPanelWidth(restoredWidth);
    setLastSplitWidth(restoredWidth);
    setPanelMode(stored?.collapsed ? "collapsed" : "split");
    setPanelLayoutReady(true);
  }, [panelLayoutReady, storageId, workspaceWidth]);

  useEffect(() => {
    if (workspaceWidth < DESKTOP_BREAKPOINT || !panelLayoutReady) return;
    const clampedWidth = clampSplitWidth(lastSplitWidth, workspaceWidth);
    if (clampedWidth === lastSplitWidth) return;
    setLastSplitWidth(clampedWidth);
    if (panelMode === "split") setPanelWidth(clampedWidth);
  }, [lastSplitWidth, panelLayoutReady, panelMode, workspaceWidth]);

  useEffect(() => {
    if (workspaceWidth < DESKTOP_BREAKPOINT || !panelLayoutReady || panelMode === "full-chat") return;
    writePanelLayout(storageId, {
      version: PANEL_STORAGE_VERSION,
      width: clampSplitWidth(lastSplitWidth, workspaceWidth),
      collapsed: panelMode === "collapsed"
    });
  }, [lastSplitWidth, panelLayoutReady, panelMode, storageId, workspaceWidth]);

  useEffect(() => {
    if (!isResizing) return;
    const move = (event: globalThis.PointerEvent) => {
      if (activeResizePointerRef.current === undefined || event.pointerId !== activeResizePointerRef.current) return;
      setPanelWidth(panelWidthAt(event.clientX));
    };
    const finish = (event: globalThis.PointerEvent) => {
      if (activeResizePointerRef.current === undefined || event.pointerId !== activeResizePointerRef.current) return;
      finishPanelResize(panelWidthAt(event.clientX));
    };
    const cancel = (event: globalThis.PointerEvent) => {
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
  }, [isResizing, lastSplitWidth, panelWidth, workspaceWidth]);

  function changeMobilePane(pane: MobilePane) {
    setMobilePane(pane);
    onMobilePaneChange?.(pane);
  }

  function persistPanelLayout(collapsed: boolean, width: number) {
    const measuredWorkspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? workspaceWidth;
    if (measuredWorkspaceWidth < DESKTOP_BREAKPOINT) return;
    writePanelLayout(storageId, {
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

  function handleResizeStart(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || panelMode !== "split") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeResizePointerRef.current = event.pointerId;
    setIsResizing(true);
  }

  function handleResizeMove(event: PointerEvent<HTMLDivElement>) {
    if (!isResizing || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setPanelWidth(panelWidthAt(event.clientX));
  }

  function finishResize(event: PointerEvent<HTMLDivElement>) {
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

  function cancelResize(event: PointerEvent<HTMLDivElement>) {
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

  function handleResizeKey(event: KeyboardEvent<HTMLDivElement>) {
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
          <Link className="site-agent-mobile-back" href={backHref} aria-label={backLabel}>←</Link>
          <button className="site-agent-collapsed-toggle" type="button" aria-label="Expand chat panel" title="Expand chat panel" onClick={restoreSplitPanel}>
            <ChatIcon />
          </button>
          {commandTitle}
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
            <button type="button" className={mobilePane === "chat" ? "is-active" : ""} aria-pressed={mobilePane === "chat"} onClick={() => changeMobilePane("chat")}>Chat</button>
            <button type="button" className={mobilePane === "preview" ? "is-active" : ""} aria-pressed={mobilePane === "preview"} onClick={() => changeMobilePane("preview")}>Preview</button>
          </div>
          {mobilePane === "preview" ? mobilePreviewActions : null}
          {mobileOutcomeAction}
        </div>
        <div className="site-agent-preview-bar">{previewToolbar}</div>
      </header>

      <div className="site-agent-body">
        <aside
          className="site-agent-command"
          aria-label={commandLabel}
          aria-hidden={compactViewport && mobilePane !== "chat" ? true : undefined}
          inert={compactViewport && mobilePane !== "chat" ? true : undefined}
        >
          <div className="site-agent-command-content" aria-hidden={desktopPanelCollapsed ? true : undefined} inert={desktopPanelCollapsed ? true : undefined}>
            {commandContent}
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
          aria-label={previewLabel}
          aria-hidden={(compactViewport && mobilePane !== "preview") || desktopFullChat ? true : undefined}
          inert={(compactViewport && mobilePane !== "preview") || desktopFullChat ? true : undefined}
        >
          {previewContent}
        </section>
      </div>
    </main>
  );
}

function panelStorageKey(storageId: string) {
  return `lodesta:site-agent-panel:v${PANEL_STORAGE_VERSION}:${storageId}`;
}

function readPanelLayout(storageId: string): StoredPanelLayout | undefined {
  try {
    const value = window.localStorage.getItem(panelStorageKey(storageId));
    if (!value) return undefined;
    const parsed = JSON.parse(value) as Partial<StoredPanelLayout>;
    if (parsed.version !== PANEL_STORAGE_VERSION || !Number.isFinite(parsed.width) || typeof parsed.collapsed !== "boolean") return undefined;
    return parsed as StoredPanelLayout;
  } catch {
    return undefined;
  }
}

function writePanelLayout(storageId: string, layout: StoredPanelLayout) {
  try {
    window.localStorage.setItem(panelStorageKey(storageId), JSON.stringify(layout));
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
