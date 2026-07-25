"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  OperatorQueueItem,
  PlatformSiteRecord,
  SiteAgentSession,
  SiteElementSelection,
  SitePublicationReadiness,
  SitePublicBuildInput,
  SiteVersion
} from "@/packages/site-contracts";
import type {
  OwnerActivityGroup,
  OwnerActivitySnapshot,
  OwnerSiteAgentRun
} from "@/packages/site-platform/owner-run-view";
import type { SiteAgentMessage } from "@/packages/platform-data";
import { deriveOwnerSiteLifecycle } from "@/lib/owner-site-lifecycle";
import { ProductEmptyState, ProductSelect } from "@/components/ProductUI";
import { WebsiteWorkspaceFrame } from "@/components/WebsiteWorkspaceFrame";

type WorkspacePayload = {
  site: PlatformSiteRecord;
  session?: SiteAgentSession;
  input?: SitePublicBuildInput;
  versions: SiteVersion[];
  versionRoutes: Record<string, Array<{ path: string; title: string }>>;
  messages: SiteAgentMessage[];
  runs: OwnerSiteAgentRun[];
  readiness?: SitePublicationReadiness;
  openFindings?: OperatorQueueItem[];
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

type VoiceSupport = "checking" | "supported" | "unsupported";
type ActivityLoadState = "idle" | "loading" | "loaded" | "error";

type SpeechRecognitionResultLike = {
  0?: { transcript?: string };
  isFinal: boolean;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

type DictationContext = {
  prefix: string;
  suffix: string;
  finalTranscript: string;
};

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
  const [composerMode, setComposerMode] = useState<"edit" | "ask">("edit");
  const [discussionSuggestion, setDiscussionSuggestion] = useState<DiscussionSuggestion>();
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
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
  const [copiedIdentifier, setCopiedIdentifier] = useState<string>();
  const [previewMoreOpen, setPreviewMoreOpen] = useState(false);
  const [publishHintOpen, setPublishHintOpen] = useState(false);
  const [voiceSupport, setVoiceSupport] = useState<VoiceSupport>("checking");
  const [listening, setListening] = useState(false);
  const [activitySnapshots, setActivitySnapshots] = useState<Record<string, OwnerActivitySnapshot>>({});
  const [activityLoads, setActivityLoads] = useState<Record<string, ActivityLoadState>>({});
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [newActivity, setNewActivity] = useState(false);
  const previewMoreId = useId();
  const publishReasonId = useId();
  const composerUnavailableId = useId();
  const voiceStatusId = useId();
  const endRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const previewMoreRef = useRef<HTMLDivElement>(null);
  const previewMoreTriggerRef = useRef<HTMLButtonElement>(null);
  const previewMoreMobileTriggerRef = useRef<HTMLButtonElement>(null);
  const previewListenerCleanupRef = useRef<(() => void) | undefined>(undefined);
  const selectionModeRef = useRef(false);
  const selectedPagePathRef = useRef("/");
  const recognitionRef = useRef<SpeechRecognitionLike | undefined>(undefined);
  const dictationContextRef = useRef<DictationContext | undefined>(undefined);
  const activityRequestsRef = useRef(new Map<string, AbortController>());
  const announcedRunsRef = useRef(new Map<string, OwnerSiteAgentRun>());
  const followsLatestRef = useRef(true);
  const transcriptVersionRef = useRef("");

  const latestCandidate = workspace.versions.find((version) => version.status === "candidate");
  const activeRun = workspace.runs.find((run) => run.status === "queued" || run.status === "running");
  const initialBuildActive = activeRun?.kind === "initial_build";
  const waitingRun = !activeRun ? workspace.runs.find((run) => run.status === "needs_input") : undefined;
  const latestCompletedRun = workspace.runs.find((run) =>
    run.status === "succeeded" || run.status === "failed" || run.status === "cancelled"
  );
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
  const status = deriveOwnerSiteLifecycle({
    slug: workspace.site.slug,
    site: workspace.site,
    versions: workspace.versions,
    runs: workspace.runs,
    readiness: workspace.readiness,
    attention: { operatorItems: workspace.openFindings?.length }
  });
  const diagnosticRuns = workspace.runs.slice(0, 4);
  const businessName = workspace.input?.business.name ?? initialInput.business.name;
  const compareDisabled = !publishedPreviewUrl || (!fastPreview && published?.id === selectedVersion?.id);
  const starterPrompts = editorStarterPrompts(workspace.input ?? initialInput);
  const publishDisabledReason = activeRun
    ? "Finish the current website update before publishing."
    : busy
      ? "Wait for the workspace to finish loading."
      : !latestCandidate
        ? "Create a verified website update before publishing."
        : workspace.readiness?.status !== "ready"
          ? `${workspace.readiness?.blockers.length ?? 1} publishing requirement${(workspace.readiness?.blockers.length ?? 1) === 1 ? "" : "s"} must be resolved first.`
          : undefined;
  const publishBlocked = Boolean(publishDisabledReason);
  const voiceStatus = initialBuildActive
    ? "Voice input is available when your first draft is ready."
    : voiceSupport === "checking"
      ? "Checking voice input availability."
      : voiceSupport === "unsupported"
        ? "Voice input is not supported in this browser."
        : listening
          ? "Listening. Speak now."
          : "Voice input is ready.";
  const voiceDisabled = initialBuildActive || busy || voiceSupport !== "supported";
  const voiceDescriptionId = initialBuildActive
    ? composerUnavailableId
    : voiceSupport !== "supported" || listening
      ? voiceStatusId
      : undefined;

  const stopDictation = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = undefined;
    dictationContextRef.current = undefined;
    setListening(false);
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // Recognition may already have ended between the user's action and cleanup.
    }
  }, []);

  const refresh = useCallback(async () => {
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
  }, [initialSite.id]);

  const loadRunActivity = useCallback(async (runId: string, force = false) => {
    if (!force) {
      const cached = readOwnerActivityCache(runId);
      if (cached) {
        setActivitySnapshots((current) => ({ ...current, [runId]: cached }));
        setActivityLoads((current) => ({ ...current, [runId]: "loaded" }));
        return cached;
      }
    }
    if (activityRequestsRef.current.has(runId)) return undefined;
    const controller = new AbortController();
    activityRequestsRef.current.set(runId, controller);
    setActivityLoads((current) => ({ ...current, [runId]: "loading" }));
    try {
      const snapshot = await requestOwnerActivity(runId, controller.signal);
      setActivitySnapshots((current) => ({ ...current, [runId]: snapshot }));
      setActivityLoads((current) => ({ ...current, [runId]: "loaded" }));
      if (isSettledOwnerRun(snapshot.run)) writeOwnerActivityCache(snapshot);
      return snapshot;
    } catch (error) {
      if (!controller.signal.aborted) setActivityLoads((current) => ({ ...current, [runId]: "error" }));
      throw error;
    } finally {
      activityRequestsRef.current.delete(runId);
    }
  }, []);

  async function copyIdentifier(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedIdentifier(key);
      window.setTimeout(() => setCopiedIdentifier((current) => current === key ? undefined : current), 1600);
    } catch {
      setNotice(`Could not copy ${value}. Select the identifier and copy it manually.`);
    }
  }

  function toggleDictation() {
    if (listening) {
      stopDictation();
      return;
    }
    if (voiceDisabled) return;

    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceSupport("unsupported");
      return;
    }

    const textarea = composerRef.current;
    const selectionStart = textarea?.selectionStart ?? instruction.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const context: DictationContext = {
      prefix: instruction.slice(0, selectionStart),
      suffix: instruction.slice(selectionEnd),
      finalTranscript: ""
    };
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (recognitionRef.current !== recognition) return;
      setNotice(undefined);
      setListening(true);
    };
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition || dictationContextRef.current !== context) return;
      let finalDelta = "";
      let interimTranscript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalDelta = joinTranscript(finalDelta, transcript);
        else interimTranscript = joinTranscript(interimTranscript, transcript);
      }
      if (finalDelta) context.finalTranscript = joinTranscript(context.finalTranscript, finalDelta);
      const dictated = dictationValue(context, interimTranscript);
      if (!dictated) return;
      setInstruction(dictated.value);
      window.requestAnimationFrame(() => composerRef.current?.setSelectionRange(dictated.caret, dictated.caret));
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted") setNotice(voiceRecognitionErrorMessage(event.error));
      recognitionRef.current = undefined;
      dictationContextRef.current = undefined;
      setListening(false);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = undefined;
      if (dictationContextRef.current === context) dictationContextRef.current = undefined;
      setListening(false);
    };
    recognitionRef.current = recognition;
    dictationContextRef.current = context;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = undefined;
      dictationContextRef.current = undefined;
      setListening(false);
      setNotice("Voice input could not start. Try again.");
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
    const runId = activeRun.id;
    let stopped = false;
    let inFlight = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    if (!announcedRunsRef.current.has(runId)) announcedRunsRef.current.set(runId, activeRun);

    const schedule = (delay: number) => {
      if (stopped || document.hidden) return;
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const snapshot = await requestOwnerActivity(runId, controller.signal);
        if (stopped) return;
        const previous = announcedRunsRef.current.get(runId);
        const announcement = ownerRunAnnouncement(previous, snapshot.run);
        announcedRunsRef.current.set(runId, snapshot.run);
        if (announcement) setLiveAnnouncement(announcement);
        setActivitySnapshots((current) => ({ ...current, [runId]: snapshot }));
        setActivityLoads((current) => ({ ...current, [runId]: "loaded" }));
        setWorkspace((current) => ({
          ...current,
          runs: current.runs.map((run) => run.id === runId ? snapshot.run : run)
        }));
        if (isSettledOwnerRun(snapshot.run)) {
          writeOwnerActivityCache(snapshot);
          await refresh();
          return;
        }
        schedule(1000);
      } catch {
        if (!stopped && !controller.signal.aborted) {
          setActivityLoads((current) => ({ ...current, [runId]: "error" }));
          schedule(3000);
        }
      } finally {
        inFlight = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (timer !== undefined) window.clearTimeout(timer);
        controller?.abort();
        return;
      }
      void refresh()
        .catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
        .finally(() => schedule(0));
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activeRun?.id, refresh]);

  useEffect(() => {
    const autoLoadIds = [waitingRun?.id, latestCompletedRun?.id]
      .filter((runId): runId is string => Boolean(runId && runId !== activeRun?.id));
    for (const runId of new Set(autoLoadIds)) {
      if (activitySnapshots[runId] || activityLoads[runId] === "loading" || activityLoads[runId] === "loaded") continue;
      void loadRunActivity(runId).catch(() => undefined);
    }
  }, [
    activeRun?.id,
    waitingRun?.id,
    latestCompletedRun?.id,
    activitySnapshots,
    activityLoads,
    loadRunActivity
  ]);

  useEffect(() => () => {
    for (const controller of activityRequestsRef.current.values()) controller.abort();
    activityRequestsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!publishBlocked) setPublishHintOpen(false);
  }, [publishBlocked]);

  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRun?.id]);

  useEffect(() => {
    if (!previewMoreOpen) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (previewMoreRef.current?.contains(target) || previewMoreTriggerRef.current?.contains(target) || previewMoreMobileTriggerRef.current?.contains(target)) return;
      setPreviewMoreOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPreviewMoreOpen(false);
      (previewMoreMobileTriggerRef.current ?? previewMoreTriggerRef.current)?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [previewMoreOpen]);

  useEffect(() => {
    const speechWindow = window as SpeechRecognitionWindow;
    setVoiceSupport(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition ? "supported" : "unsupported");
    return () => {
      const recognition = recognitionRef.current;
      recognitionRef.current = undefined;
      dictationContextRef.current = undefined;
      if (!recognition) return;
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // Recognition may already have ended during unmount.
      }
    };
  }, []);

  useEffect(() => {
    if (initialBuildActive) stopDictation();
  }, [initialBuildActive, stopDictation]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 160 ? "auto" : "hidden";
  }, [instruction]);

  const transcriptVersion = ownerTranscriptVersion(workspace.messages, workspace.runs, activitySnapshots, discussionSuggestion);

  useEffect(() => {
    if (transcriptVersionRef.current === transcriptVersion) return;
    const hadContent = Boolean(transcriptVersionRef.current);
    transcriptVersionRef.current = transcriptVersion;
    if (followsLatestRef.current) {
      endRef.current?.scrollIntoView({ block: "nearest" });
      setNewActivity(false);
    } else if (hadContent) {
      setNewActivity(true);
    }
  }, [transcriptVersion]);

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
    stopDictation();
    setBusy(true);
    setNotice(undefined);
    setDiscussionSuggestion(undefined);
    try {
      const asking = composerMode === "ask";
      const endpoint = asking ? "/api/site-agent/discuss" : "/api/site-agent/runs";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: workspace.session.id,
          selection,
          ...(asking ? { message } : { instruction: message, resumeRunId: waitingRun?.id })
        })
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      if (asking) {
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
    setComposerMode("edit");
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

  async function retry(runId: string) {
    const failed = workspace.runs.find((run) => run.id === runId && run.status === "failed");
    if (!failed || busy || activeRun) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/site-agent/runs/${encodeURIComponent(failed.id)}/retry`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function handleTranscriptScroll() {
    const element = messagesRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    followsLatestRef.current = nearBottom;
    if (nearBottom) setNewActivity(false);
  }

  function showLatestActivity() {
    followsLatestRef.current = true;
    setNewActivity(false);
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const autoActivityRunIds = new Set([
    activeRun?.id,
    waitingRun?.id,
    latestCompletedRun?.id
  ].filter((runId): runId is string => Boolean(runId)));
  const transcriptItems = ownerTranscriptItems(workspace.messages, workspace.runs);

  return (
    <WebsiteWorkspaceFrame
      storageId={initialSite.id}
      backHref={`/workspace/${workspace.site.slug}`}
      backLabel="Back to website overview"
      onMobilePaneChange={() => setPreviewMoreOpen(false)}
      commandTitle={
          <div className="site-agent-command-title">
            <strong>{businessName}</strong>
            <small className={`is-${status.tone}`}><span className="site-agent-command-title-desktop">Editor · </span>{status.label}</small>
          </div>
      }
      mobilePreviewActions={
        <>
            <button
              ref={previewMoreMobileTriggerRef}
              className="site-agent-mobile-more"
              type="button"
              aria-haspopup="dialog"
              aria-controls={previewMoreId}
              aria-expanded={previewMoreOpen}
              aria-label="Preview options"
              onClick={() => setPreviewMoreOpen((current) => !current)}
            >
              •••
            </button>
        </>
      }
      mobileNotice={publishDisabledReason && publishHintOpen ? publishDisabledReason : undefined}
      mobileOutcomeAction={
        <>
          {publishDisabledReason ? <span className="site-agent-visually-hidden" id={`${publishReasonId}-mobile`}>{publishDisabledReason}</span> : null}
          <button
            className="button primary site-agent-publish site-agent-publish-mobile"
            type="button"
            aria-disabled={publishDisabledReason ? true : undefined}
            aria-describedby={publishDisabledReason ? `${publishReasonId}-mobile` : undefined}
            onClick={() => {
              if (publishDisabledReason) {
                setPublishHintOpen((current) => !current);
                return;
              }
              void publish();
            }}
          >
            Publish
          </button>
        </>
      }
      previewToolbar={
        <>
          <div className="site-agent-preview-primary">
            <label className="site-agent-page-picker">
              <span className="site-agent-visually-hidden">Website page</span>
              <ProductSelect compact value={selectedPageValue} onChange={(event) => navigatePreview(event.target.value)} disabled={!pages.length || previewBaseUrl === "about:blank"}>
                {pages.length ? pages.map((page) => <option key={page.id} value={page.path}>{page.title}</option>) : <option value="/">Homepage</option>}
              </ProductSelect>
            </label>
            <div className="site-agent-preview-controls" aria-label="Preview viewport">
              <button type="button" className={viewport === "desktop" ? "is-active" : ""} aria-pressed={viewport === "desktop"} onClick={() => setViewport("desktop")}>Desktop</button>
              <button type="button" className={viewport === "mobile" ? "is-active" : ""} aria-pressed={viewport === "mobile"} onClick={() => setViewport("mobile")}>Mobile</button>
            </div>
            <button className={`site-agent-tool-button ${selectionMode ? "is-active" : ""}`} type="button" aria-pressed={selectionMode} onClick={() => setSelectionMode((value) => !value)}>Select</button>
          </div>
          <div className="site-agent-preview-outcome">
            <div className="site-agent-more-menu">
              <button
                ref={previewMoreTriggerRef}
                className={`site-agent-tool-button site-agent-more-trigger ${previewMoreOpen || compare ? "is-active" : ""}`}
                type="button"
                aria-haspopup="dialog"
                aria-controls={previewMoreId}
                aria-expanded={previewMoreOpen}
                onClick={() => setPreviewMoreOpen((current) => !current)}
              >
                More
              </button>
              {previewMoreOpen ? (
                <div ref={previewMoreRef} className="site-agent-more-popover" id={previewMoreId} role="dialog" aria-label="More preview actions">
                  <section className="site-agent-more-section site-agent-more-mobile-tools">
                    <span className="site-agent-more-heading">Preview tools</span>
                    <label className="site-agent-page-picker">
                      <span>Page</span>
                      <ProductSelect value={selectedPageValue} onChange={(event) => navigatePreview(event.target.value)} disabled={!pages.length || previewBaseUrl === "about:blank"}>
                        {pages.length ? pages.map((page) => <option key={page.id} value={page.path}>{page.title}</option>) : <option value="/">Homepage</option>}
                      </ProductSelect>
                    </label>
                    <div className="site-agent-preview-controls" aria-label="Preview viewport">
                      <button type="button" className={viewport === "desktop" ? "is-active" : ""} aria-pressed={viewport === "desktop"} onClick={() => setViewport("desktop")}>Desktop</button>
                      <button type="button" className={viewport === "mobile" ? "is-active" : ""} aria-pressed={viewport === "mobile"} onClick={() => setViewport("mobile")}>Mobile</button>
                    </div>
                    <button className={`site-agent-more-action ${selectionMode ? "is-selected" : ""}`} type="button" aria-pressed={selectionMode} onClick={() => setSelectionMode((value) => !value)}>
                      <span><strong>Select an element</strong><small>Choose part of the preview for your next edit</small></span>
                      <small>{selectionMode ? "On" : "Off"}</small>
                    </button>
                  </section>
                  <section className="site-agent-more-section">
                    <span className="site-agent-more-heading">Preview</span>
                    <button
                      className={`site-agent-more-action ${compare ? "is-selected" : ""}`}
                      type="button"
                      aria-pressed={compare}
                      disabled={compareDisabled}
                      onClick={() => setCompare((value) => !value)}
                    >
                      <span><strong>Compare with live</strong><small>{!publishedPreviewUrl ? "Available after the first publish" : compareDisabled ? "Choose a draft version first" : "Show the draft and live site side by side"}</small></span>
                      <small>{compare ? "On" : "Off"}</small>
                    </button>
                    {workspace.site.publishedVersionId ? <Link className="site-agent-more-action" href={`/sites/${workspace.site.slug}`} target="_blank" rel="noreferrer"><span><strong>Open live site</strong><small>View the published website in a new tab</small></span></Link> : null}
                  </section>
                  <section className="site-agent-more-section">
                    <span className="site-agent-more-heading">Version history</span>
                    <div className="site-agent-version-list">
                      {workspace.versions.map((version) => (
                        <button key={version.id} className={version.id === selectedVersion?.id ? "is-selected" : ""} type="button" aria-pressed={version.id === selectedVersion?.id} onClick={() => {
                          setSelectedVersionId(version.id);
                          setCompare(false);
                          setSelection(undefined);
                        }}>
                          <span>Version {version.number}</span>
                          <small>{version.status}</small>
                        </button>
                      ))}
                    </div>
                    {selectedVersion ? <button className="site-agent-restore-action" type="button" disabled={busy || Boolean(activeRun)} onClick={() => void restore(selectedVersion.id)}><span>Restore selected</span><small>Create a new candidate</small></button> : null}
                  </section>
                  {isAdmin ? (
                    <section className="site-agent-diagnostics" aria-labelledby="site-agent-diagnostics-title">
                      <div className="site-agent-diagnostics-heading"><span id="site-agent-diagnostics-title">Admin diagnostics</span><Link href={`/admin/sites/${workspace.site.slug}`}>Manage site</Link></div>
                      <div className="site-agent-identifier-row"><div><span>Site ID</span><code>{workspace.site.id}</code></div><button type="button" onClick={() => void copyIdentifier(workspace.site.id, "site")}>{copiedIdentifier === "site" ? "Copied" : "Copy"}</button></div>
                      <div className="site-agent-diagnostic-runs"><span className="site-agent-diagnostic-label">Recent runs</span>{diagnosticRuns.map((run) => <div className="site-agent-run-identifier" key={run.id}><div><Link href={`/admin/runs/${run.id}`}>{run.kind.replaceAll("_", " ")}</Link><code>{run.id}</code><small>{run.status} · {run.stage}</small></div><button type="button" onClick={() => void copyIdentifier(run.id, run.id)}>{copiedIdentifier === run.id ? "Copied" : "Copy"}</button></div>)}{!diagnosticRuns.length ? <small className="site-agent-no-runs">No runs in this workspace yet.</small> : null}</div>
                      <Link className="site-agent-all-activity" href={`/admin/runs?siteId=${encodeURIComponent(workspace.site.id)}`}>View all activity</Link>
                    </section>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="site-agent-publish-wrap">
              {publishDisabledReason ? <span id={publishReasonId}>{publishDisabledReason}</span> : null}
              <button className="button primary site-agent-publish site-agent-publish-desktop" type="button" disabled={Boolean(publishDisabledReason)} aria-describedby={publishDisabledReason ? publishReasonId : undefined} onClick={() => void publish()}>Publish</button>
            </div>
          </div>
        </>
      }
      commandContent={
        <>
          <div className="site-agent-transcript">
            <div
              ref={messagesRef}
              className="site-agent-messages"
              aria-busy={busy && !workspace.session ? true : undefined}
              onScroll={handleTranscriptScroll}
            >
              {busy && !workspace.session ? (
                <div className="site-agent-loading-message" role="status">
                  <span className="site-agent-send-spinner" aria-hidden="true" />
                  <div>
                    <strong>Opening workspace</strong>
                    <span>Loading conversation and site context.</span>
                  </div>
                </div>
              ) : workspace.messages.length === 0 && workspace.runs.length === 0 ? (
                <ProductEmptyState
                  className="site-agent-empty-message"
                  title="What would you like to improve?"
                  detail="Describe a change, or choose Ask when you want advice without editing the website."
                >
                  <div className="site-agent-starter-prompts">
                    {starterPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => { setComposerMode("edit"); setInstruction(prompt); window.requestAnimationFrame(() => composerRef.current?.focus()); }}>{prompt}</button>)}
                  </div>
                </ProductEmptyState>
              ) : null}
              {transcriptItems.map((item) => item.kind === "message" ? (
                <article key={item.message.id} className={`site-agent-message is-${item.message.role}`} aria-label={messageAuthorLabel(item.message.role)}>
                  <p>{item.message.content}</p>
                  <time dateTime={item.message.createdAt} suppressHydrationWarning>{quietTimestamp(item.message.createdAt)}</time>
                </article>
              ) : (
                <RunActivityCard
                  key={item.run.id}
                  run={item.run}
                  snapshot={activitySnapshots[item.run.id]}
                  loadState={activityLoads[item.run.id] ?? "idle"}
                  autoLoad={autoActivityRunIds.has(item.run.id)}
                  clock={clock}
                  busy={busy || Boolean(activeRun && activeRun.id !== item.run.id)}
                  onShow={() => void loadRunActivity(item.run.id).catch(() => undefined)}
                  onRetryActivity={() => void loadRunActivity(item.run.id, true).catch(() => undefined)}
                  onRetryRun={() => void retry(item.run.id)}
                />
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
              {notice ? <div className="site-agent-inline-notice" role="status">{notice}</div> : null}
              <div ref={endRef} />
            </div>
            {newActivity ? <button className="site-agent-new-activity" type="button" onClick={showLatestActivity}>New activity</button> : null}
          </div>
          <span className="site-agent-visually-hidden" aria-live="polite" aria-atomic="true">{liveAnnouncement}</span>

          <div className={`site-agent-compose ${initialBuildActive ? "is-unavailable" : ""}`}>
            {selection ? <div className="site-agent-selection-strip"><span>Selected: {selection.selector}</span><button type="button" onClick={() => setSelection(undefined)}>Clear</button></div> : null}
            {initialBuildActive ? <span className="site-agent-visually-hidden" id={composerUnavailableId}>Available when your first draft is ready.</span> : null}
            <textarea
              ref={composerRef}
              value={instruction}
              onChange={(event) => {
                if (listening) stopDictation();
                setInstruction(event.target.value);
              }}
              placeholder={initialBuildActive ? "Available when your first draft is ready" : composerMode === "ask" ? "Ask about a possible change..." : waitingRun ? "Answer the question above..." : "Describe what you want to change..."}
              disabled={initialBuildActive}
              aria-describedby={initialBuildActive ? composerUnavailableId : undefined}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                if (event.shiftKey && !event.metaKey && !event.ctrlKey) return;
                event.preventDefault();
                void submit();
              }}
              rows={1}
            />
            <span className="site-agent-visually-hidden" id={voiceStatusId} aria-live="polite">{voiceStatus}</span>
            <div className="site-agent-compose-footer">
              <ComposerModeMenu
                value={composerMode}
                onChange={setComposerMode}
                disabled={initialBuildActive}
                describedBy={initialBuildActive ? composerUnavailableId : undefined}
              />
              <div className="site-agent-compose-actions">
                <button
                  className={`site-agent-voice-button ${listening ? "is-listening" : ""}`}
                  type="button"
                  aria-label={listening ? "Stop voice input" : voiceSupport === "unsupported" ? "Voice input is not supported in this browser" : "Start voice input"}
                  aria-describedby={voiceDescriptionId}
                  aria-pressed={listening}
                  title={listening ? "Stop voice input" : voiceSupport === "unsupported" ? "Voice input is not supported in this browser" : voiceSupport === "checking" ? "Checking voice input availability" : "Start voice input"}
                  disabled={voiceDisabled}
                  onClick={toggleDictation}
                >
                  <MicrophoneIcon />
                </button>
                <button
                  className="site-agent-send-button"
                  type="button"
                  aria-label={initialBuildActive ? "Available when your first draft is ready" : busy ? "Working" : composerMode === "ask" ? "Send question" : "Build requested change"}
                  aria-describedby={initialBuildActive ? composerUnavailableId : undefined}
                  title={initialBuildActive ? "Available when your first draft is ready" : busy ? "Working" : composerMode === "ask" ? "Send question" : "Build requested change"}
                  aria-busy={busy ? true : undefined}
                  disabled={!instruction.trim() || busy || Boolean(activeRun)}
                  onClick={() => void submit()}
                >
                  {busy ? <span className="site-agent-send-spinner" aria-hidden="true" /> : <ArrowUpIcon />}
                </button>
              </div>
            </div>
          </div>
        </>
      }
      previewContent={
        <>
          {latestCandidate && workspace.readiness?.status === "blocked" ? (
            <details className="site-agent-blockers">
              <summary>{workspace.readiness.blockers.length} publication blocker{workspace.readiness.blockers.length === 1 ? "" : "s"}</summary>
              <ul>{workspace.readiness.blockers.map((blocker) => <li key={`${blocker.code}:${blocker.referenceId ?? "site"}`}>{blocker.message}</li>)}</ul>
            </details>
          ) : null}
          <div className={`site-agent-preview-stage is-${viewport} ${compare ? "is-comparing" : ""}`}>
            {previewBaseUrl === "about:blank" ? (
              <div className="site-agent-empty-preview">
                <div className="site-agent-preview-skeleton" aria-hidden="true">
                  <span className="site-agent-preview-skeleton-bar" />
                  <span className="site-agent-preview-skeleton-hero" />
                  <span className="site-agent-preview-skeleton-line" />
                  <span className="site-agent-preview-skeleton-line is-short" />
                  <div className="site-agent-preview-skeleton-row">
                    <span /><span /><span />
                  </div>
                </div>
                <strong>{busy ? "Opening workspace" : "Your preview will appear here"}</strong>
                <span>Ask for a website change, then review the verified result in this pane.</span>
              </div>
            ) : (
              <iframe ref={previewRef} key={previewIdentity} name="site-agent-preview" title="Website preview" src={iframeSrc} onLoad={handlePreviewLoad} />
            )}
            {compare && publishedPreviewUrl ? <iframe title="Published website comparison" src={previewRouteUrl(publishedPreviewUrl, selectedPagePath)} /> : null}
          </div>
        </>
      }
    />
  );
}

function RunActivityCard({
  run,
  snapshot,
  loadState,
  autoLoad,
  clock,
  busy,
  onShow,
  onRetryActivity,
  onRetryRun
}: {
  run: OwnerSiteAgentRun;
  snapshot?: OwnerActivitySnapshot;
  loadState: ActivityLoadState;
  autoLoad: boolean;
  clock: number;
  busy: boolean;
  onShow: () => void;
  onRetryActivity: () => void;
  onRetryRun: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = run.status === "queued" || run.status === "running";
  const timestamp = active
    ? elapsedLabel(clock - Date.parse(run.startedAt))
    : quietDateTime(run.completedAt ?? run.startedAt);

  if (!autoLoad) {
    return (
      <article className={`site-agent-activity-card is-${run.status}`}>
        <details
          open={expanded}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setExpanded(open);
            if (open && loadState === "idle") onShow();
          }}
        >
          <summary className="site-agent-activity-summary">
            <ActivityDot status={run.status === "failed" ? "failed" : "succeeded"} />
            <span>
              <strong>{run.progress.label}</strong>
              <small>{timestamp}</small>
            </span>
            <small>{expanded ? "Hide activity" : "Show activity"}</small>
          </summary>
          <div className="site-agent-activity-expanded">
            <RunActivityBody
              run={run}
              snapshot={snapshot}
              loadState={loadState}
              detailed
              onRetryActivity={onRetryActivity}
            />
            <RunFailureAction run={run} busy={busy} onRetry={onRetryRun} />
          </div>
        </details>
      </article>
    );
  }

  return (
    <article className={`site-agent-activity-card is-${run.status}`}>
      <header className="site-agent-activity-header">
        <ActivityDot status={active ? "running" : run.status === "failed" ? "failed" : "succeeded"} />
        <span>
          <strong>{run.progress.label}</strong>
          <small>{timestamp}</small>
        </span>
      </header>
      <RunActivityBody
        run={run}
        snapshot={snapshot}
        loadState={loadState}
        onRetryActivity={onRetryActivity}
      />
      {snapshot && (snapshot.completed.length > 4 || snapshot.hasEarlierActivity) ? (
        <details className="site-agent-activity-details">
          <summary>Details</summary>
          <div className="site-agent-activity-expanded">
            <ActivityRows groups={snapshot.completed} />
            {snapshot.hasEarlierActivity ? <small>Earlier activity is not shown.</small> : null}
          </div>
        </details>
      ) : null}
      <RunFailureAction run={run} busy={busy} onRetry={onRetryRun} />
    </article>
  );
}

function RunActivityBody({
  run,
  snapshot,
  loadState,
  detailed = false,
  onRetryActivity
}: {
  run: OwnerSiteAgentRun;
  snapshot?: OwnerActivitySnapshot;
  loadState: ActivityLoadState;
  detailed?: boolean;
  onRetryActivity: () => void;
}) {
  const active = run.status === "queued" || run.status === "running";
  if (!snapshot && loadState === "loading") {
    return <div className="site-agent-activity-loading"><span className="site-agent-send-spinner" aria-hidden="true" /><span>Loading activity…</span></div>;
  }
  if (!snapshot && loadState === "error") {
    return (
      <div className="site-agent-activity-unavailable">
        <span>Activity is temporarily unavailable.</span>
        <button type="button" onClick={onRetryActivity}>Retry</button>
      </div>
    );
  }

  const completed = snapshot?.completed ?? [];
  const visibleCompleted = detailed ? completed : completed.slice(-4);
  const hasMappedActivity = Boolean(snapshot?.current || completed.length);
  return (
    <>
      {snapshot?.current ? <ActivityRows groups={[snapshot.current]} /> : active ? (
        <div className="site-agent-activity-fallback"><ActivityDot status="running" /><span>Working on your website.</span></div>
      ) : null}
      {visibleCompleted.length ? <ActivityRows groups={visibleCompleted} /> : null}
      {!active && snapshot && !hasMappedActivity ? <p className="site-agent-activity-empty">No detailed activity was recorded.</p> : null}
      {(run.status === "needs_input" || run.status === "failed") ? <p className="site-agent-activity-guidance">{run.progress.detail}</p> : null}
      {detailed && snapshot?.hasEarlierActivity ? <small>Earlier activity is not shown.</small> : null}
    </>
  );
}

function ActivityRows({ groups }: { groups: OwnerActivityGroup[] }) {
  return (
    <ol className="site-agent-activity-list">
      {groups.map((group) => (
        <li key={group.key} className={`is-${group.status}`}>
          <ActivityDot status={group.status} />
          <span>{activityGroupLabel(group)}</span>
          {group.completedAt ? <time dateTime={group.completedAt} suppressHydrationWarning>{quietTimestamp(group.completedAt)}</time> : null}
        </li>
      ))}
    </ol>
  );
}

function ActivityDot({ status }: { status: "running" | "succeeded" | "failed" }) {
  return <span className={`site-agent-activity-dot is-${status}`} aria-hidden="true" />;
}

function RunFailureAction({
  run,
  busy,
  onRetry
}: {
  run: OwnerSiteAgentRun;
  busy: boolean;
  onRetry: () => void;
}) {
  if (run.status !== "failed" || !run.retryableByOwner) return null;
  return <button className="button secondary site-agent-activity-retry" type="button" disabled={busy} onClick={onRetry}>Retry {run.kind === "initial_build" ? "build" : "change"}</button>;
}

type OwnerTranscriptItem =
  | { kind: "message"; at: number; rank: number; message: SiteAgentMessage }
  | { kind: "run"; at: number; rank: number; run: OwnerSiteAgentRun };

function ownerTranscriptItems(messages: SiteAgentMessage[], runs: OwnerSiteAgentRun[]): OwnerTranscriptItem[] {
  const items: OwnerTranscriptItem[] = messages.map((message, index) => ({
    kind: "message",
    at: Date.parse(message.createdAt),
    rank: index * 2,
    message
  }));
  for (const [index, run] of runs.entries()) {
    const firstMessageIndex = messages.findIndex((message) => message.runId === run.id);
    const firstMessage = firstMessageIndex >= 0 ? messages[firstMessageIndex] : undefined;
    items.push({
      kind: "run",
      at: Date.parse(firstMessage?.createdAt ?? run.startedAt),
      rank: firstMessage ? firstMessageIndex * 2 + 1 : messages.length * 2 + index,
      run
    });
  }
  return items.sort((left, right) => left.at - right.at || left.rank - right.rank);
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

function messageAuthorLabel(role: SiteAgentMessage["role"]) {
  if (role === "agent") return "Lodesta message";
  if (role === "owner") return "Your message";
  if (role === "operator") return "Operator message";
  return `${role} message`;
}

const COMPOSER_MODES = [
  { value: "edit", label: "Build", detail: "Make the change and verify a draft" },
  { value: "ask", label: "Ask", detail: "Discuss without changing the site" }
] as const;

type ComposerMode = (typeof COMPOSER_MODES)[number]["value"];

/* Owner-facing mode choice. A native `select` cannot show each mode's consequence,
   so the dock uses the same popover language as the preview menu. */
function ComposerModeMenu({
  value,
  onChange,
  disabled,
  describedBy
}: {
  value: ComposerMode;
  onChange: (mode: ComposerMode) => void;
  disabled: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(COMPOSER_MODES.findIndex((mode) => mode.value === value), 0);
  const active = COMPOSER_MODES[activeIndex];

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openMenu(index: number) {
    setOpen(true);
    window.requestAnimationFrame(() => itemRefs.current[index]?.focus());
  }

  function select(mode: ComposerMode) {
    onChange(mode);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="site-agent-compose-mode">
      <button
        ref={triggerRef}
        className={`site-agent-compose-mode-trigger ${open ? "is-open" : ""}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Composer mode: ${active.label}`}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(event.key === "ArrowDown" ? 0 : COMPOSER_MODES.length - 1);
          }
        }}
      >
        <span>{active.label}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <div ref={menuRef} className="site-agent-compose-mode-menu" id={menuId} role="menu" aria-label="Composer mode">
          {COMPOSER_MODES.map((mode, index) => (
            <button
              key={mode.value}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              className={mode.value === value ? "is-selected" : ""}
              type="button"
              role="menuitemradio"
              aria-checked={mode.value === value}
              onClick={() => select(mode.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const delta = event.key === "ArrowDown" ? 1 : -1;
                  const next = (index + delta + COMPOSER_MODES.length) % COMPOSER_MODES.length;
                  itemRefs.current[next]?.focus();
                  return;
                }
                if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  itemRefs.current[event.key === "Home" ? 0 : COMPOSER_MODES.length - 1]?.focus();
                  return;
                }
                if (event.key === "Tab") setOpen(false);
              }}
            >
              <span><strong>{mode.label}</strong><small>{mode.detail}</small></span>
              {mode.value === value ? <CheckIcon /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ArrowUpIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4m0 0L5.5 8.5M10 4l4.5 4.5" /></svg>;
}

function CheckIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8" /></svg>;
}

function ChevronDownIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>;
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="7" y="3" width="6" height="10" rx="3" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7.5 17.5h5" />
    </svg>
  );
}

function joinTranscript(current: string, next: string) {
  return [current.trim(), next.trim()].filter(Boolean).join(" ");
}

function dictationValue(context: DictationContext, interimTranscript: string) {
  const spoken = joinTranscript(context.finalTranscript, interimTranscript);
  if (!spoken) return undefined;
  const leadingSpace = context.prefix && !/[\s([{"'/-]$/.test(context.prefix) && !/^[,.;:!?)]/.test(spoken) ? " " : "";
  const trailingSpace = context.suffix && !/^[\s,.;:!?)]/.test(context.suffix) ? " " : "";
  const inserted = `${leadingSpace}${spoken}${trailingSpace}`;
  return {
    value: `${context.prefix}${inserted}${context.suffix}`,
    caret: context.prefix.length + inserted.length
  };
}

function voiceRecognitionErrorMessage(error: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone access was denied. Enable it in your browser settings to use voice input.";
  }
  if (error === "audio-capture") return "No microphone is available for voice input.";
  if (error === "no-speech") return "No speech was detected. Try voice input again.";
  if (error === "network") return "Voice input could not reach the browser speech service. Try again.";
  return "Voice input stopped unexpectedly. Try again.";
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

function editorStarterPrompts(input: SitePublicBuildInput) {
  const offering = input.business.offerings[0]?.name;
  const contactPrompt = input.business.contacts.phone
    ? "Make the phone number easier to find"
    : input.business.contacts.email
      ? "Make the contact option more prominent"
      : "Strengthen the primary call to action";
  return [
    offering ? `Make ${offering} more prominent on the homepage` : "Clarify the homepage headline",
    contactPrompt,
    "Improve the mobile homepage layout"
  ];
}

function ownerTranscriptVersion(
  messages: SiteAgentMessage[],
  runs: OwnerSiteAgentRun[],
  snapshots: Record<string, OwnerActivitySnapshot>,
  suggestion?: DiscussionSuggestion
) {
  const activity = Object.values(snapshots).map((snapshot) => [
    snapshot.run.id,
    snapshot.run.status,
    snapshot.run.stage,
    snapshot.current?.key,
    snapshot.current?.status,
    ...snapshot.completed.flatMap((group) => [group.key, group.status, group.count ?? 1])
  ].join(":")).join("|");
  return [
    messages.map((message) => message.id).join(":"),
    runs.map((run) => `${run.id}:${run.status}:${run.stage}`).join(":"),
    activity,
    suggestion?.action ?? ""
  ].join("::");
}

function activityGroupLabel(group: OwnerActivityGroup) {
  if (!group.count || group.count < 2) return group.label;
  return `${group.label.replace(/\.$/, "")} · ${group.count} steps`;
}

function quietTimestamp(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function quietDateTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return quietTimestamp(value);
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function isSettledOwnerRun(run: OwnerSiteAgentRun) {
  return run.status === "needs_input"
    || run.status === "succeeded"
    || run.status === "failed"
    || run.status === "cancelled";
}

function ownerRunAnnouncement(previous: OwnerSiteAgentRun | undefined, next: OwnerSiteAgentRun) {
  if (!previous) return undefined;
  if (previous.status !== "needs_input" && next.status === "needs_input") return "Lodesta needs your input.";
  if (previous.stage !== "fast_preview" && next.stage === "fast_preview") return "Your private preview is ready.";
  if (previous.status !== "succeeded" && next.status === "succeeded") return "Your website update is complete.";
  if (previous.status !== "failed" && next.status === "failed") return "Your website update failed.";
  return undefined;
}

async function requestOwnerActivity(runId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/site-agent/runs/${encodeURIComponent(runId)}/activity`, {
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  return await response.json() as OwnerActivitySnapshot;
}

function readOwnerActivityCache(runId: string) {
  try {
    const raw = window.sessionStorage.getItem(`lodesta:owner-activity:${runId}`);
    if (!raw) return undefined;
    const snapshot = JSON.parse(raw) as OwnerActivitySnapshot;
    return snapshot?.run?.id === runId && Array.isArray(snapshot.completed) ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

function writeOwnerActivityCache(snapshot: OwnerActivitySnapshot) {
  try {
    window.sessionStorage.setItem(`lodesta:owner-activity:${snapshot.run.id}`, JSON.stringify(snapshot));
  } catch {
    // Activity remains available in component state when session storage is unavailable.
  }
}

function elapsedLabel(durationMs: number) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string; question?: string; message?: string } | null;
  return body?.question ?? body?.message ?? body?.error ?? `Request failed (${response.status})`;
}
