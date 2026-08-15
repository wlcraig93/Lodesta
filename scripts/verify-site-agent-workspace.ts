import { access, readFile } from "node:fs/promises";
import { siteAgentMessageSchema, siteElementSelectionSchema } from "@/packages/site-contracts";

const component = await readFile("components/SiteAgentWorkspace.tsx", "utf8");
const frame = await readFile("components/WebsiteWorkspaceFrame.tsx", "utf8");
const buildCanvas = await readFile("components/WebsiteBuildCanvas.tsx", "utf8");
const ownerRunView = await readFile("packages/site-platform/owner-run-view.ts", "utf8");
const sessionRoute = await readFile("app/api/site-agent/sessions/route.ts", "utf8");
const runRoute = await readFile("app/api/site-agent/runs/route.ts", "utf8");
const discussRoute = await readFile("app/api/site-agent/discuss/route.ts", "utf8");
const prompts = await readFile("packages/site-agent/prompts.ts", "utf8");
const css = await readFile("app/globals.css", "utf8");
const editorRoute = await readFile("app/(owner-workspace)/workspace/[slug]/editor/page.tsx", "utf8");
const adminShell = await readFile("components/admin/AdminShellClient.tsx", "utf8");
const adminSites = await readFile("app/admin/sites/page.tsx", "utf8");

await access("app/(owner-workspace)/workspace/[slug]/editor/page.tsx");
await assertMissing("app/(workspace)/editor/[slug]/page.tsx");
await assertMissing("app/(owner)/editor/[slug]/page.tsx");
await assertMissing("app/(admin-app)/dashboard/page.tsx");
await assertMissing("app/(owner)/dashboard/[slug]/page.tsx");

assert(component.includes('const [composerMode, setComposerMode] = useState<"edit" | "ask">("edit")'), "Edit is not the default workspace mode");
assert(component.includes('const asking = composerMode === "ask"') && component.includes('asking ? "/api/site-agent/discuss" : "/api/site-agent/runs"'), "Ask and Edit do not use their canonical endpoints");
assert(component.includes("result.discussion.requiresApply && result.discussion.proposedAction"), "Discussion suggestions are not captured from the response");
assert(component.includes("async function cancelRun(run: OwnerSiteAgentRun)")
  && component.includes('method: "DELETE"')
  && component.includes('Stop {activeRun.kind === "initial_build" ? "build" : "update"}')
  && component.includes(">Stop update</button>"), "An owner cannot stop an active or paused website run from the editor.");
assert(runRoute.includes("export async function DELETE")
  && runRoute.includes("cancelRun"), "The owner run cancellation API is missing.");
assert(component.includes('className="site-agent-compose-run-actions"')
  && component.includes('className="button danger-secondary"')
  && css.includes(".site-agent-compose-run-actions"), "The bottom composer does not expose the active-run Stop control.");
assert(component.includes('run.status === "queued" ? `Queued ${elapsed}` : `Active ${elapsed}`')
  && ownerRunView.includes("activeSince: chronologicalEvents[0]?.startedAt"), "Queued time is still presented as active website-design time.");
assert(component.includes("setInstruction(discussionSuggestion.action)"), "Using a suggestion does not place the proposed action in the composer");
assert(component.includes('setComposerMode("edit")'), "Using a suggestion does not return the composer to Edit");
const useSuggestionBody = component.match(/function useSuggestion\(\) \{([\s\S]*?)\n  \}\n\n  function navigatePreview/)?.[1] ?? "";
assert(useSuggestionBody.length > 0 && !useSuggestionBody.includes("submit("), "Using a suggestion auto-submits the Build request");
assert(component.includes("frameWindow.location.assign(target)"), "Page selection does not navigate the mounted preview iframe");
assert(component.includes("setSelectedPagePath(route)"), "Iframe navigation does not synchronize the page picker");
assert(component.includes("selection: selection ?? {") && component.includes("route: selectedPagePath"), "Edits without an element selection do not retain the currently previewed route");
assert(component.includes('message.role === "agent" && message.selection?.route') && component.includes("focusedMessageRef"), "Completed edits do not focus the agent-reported changed route");
assert(component.includes("key={previewIdentity}"), "Preview remount identity is not isolated from the selected page path");
assert(component.includes("event.target instanceof document.defaultView.Element"), "Element selection does not account for the iframe document realm");
assert(frame.includes('data-mobile-pane={mobilePane}'), "Mobile pane state is not exposed to the mounted workspace");
assert(frame.includes("inert={compactViewport && mobilePane"), "The inactive mobile pane is not made inert");
assert(component.includes("<WebsiteWorkspaceFrame"), "The editor does not use the canonical workspace frame");
assert(component.includes("<WebsiteBuildCanvas") && buildCanvas.includes('data-stage={stage}'), "Blank editor states do not use the stage-aware build canvas");
assert(component.includes("previewAvailable ? <>") && component.includes("const showMore = previewAvailable && workspace.versions.length > 0") && component.includes("selectedIsCurrentCandidate"), "Preview controls are not progressively revealed from the selected current candidate state");
assert(component.includes('stage: "attention" as const') && component.includes('stage: "paused" as const'), "Blank-preview failure and paused states are not represented by static build-canvas states");
assert(
  component.includes('className={`site-agent-select-page')
  && component.includes('selectionMode ? "Cancel selection" : "Select an element"')
  && component.includes("{ hoverDelay: 150 }")
  && component.includes("{selectPageTooltip.tooltip}")
  && !component.includes('<span>{selectionMode ? "Cancel selection" : "Select on page"}</span>'),
  "Element selection is not exposed as an icon-only command-dock action with a quick tooltip"
);
assert(component.includes('setMobilePane("preview")') && component.includes('setMobilePane("chat")') && component.includes("composerRef.current?.focus()"), "Mobile selection does not complete the Chat to Preview to Chat flow");
assert(frame.includes("previewInteractionActive") && frame.includes('panelMode === "full-chat"') && frame.includes("restoreSplitPanel()"), "Selection cannot restore the desktop split preview from full-chat mode");
assert(component.includes("selection.label ?? selectionKind ?? \"Page element\"") && component.includes("selectionLabelFor(element)") && component.includes("stale_selection"), "Owner-facing selection labels or stale-selection guidance are incomplete");
assert(component.includes("createPreviewSelectionOverlay(document, \"hover\")") && component.includes('document.addEventListener("mouseover", updateHover, true)'), "Element selection does not preview the normalized target on hover");
assert(component.includes("previewSelectionTargetFor(rawElement, document)") && component.includes("previewSelectionKindFor(element)"), "Element selection does not normalize nested preview targets into meaningful owner-facing elements");
assert(component.includes("createPreviewSelectionOverlay(document, \"selected\")") && !component.includes("selectedElement.style.outline"), "Committed selection does not use a non-destructive preview overlay");
assert(component.includes('window.addEventListener("keydown", cancelSelection)') && component.includes('event.key !== "Escape"'), "Selection mode cannot be cancelled from the owner workspace keyboard context");
assert(component.includes('className="site-agent-selection-chip"') && component.includes("<CloseIcon />") && !component.includes("site-agent-selection-strip"), "Selected preview context is not shown as a compact removable composer token");
assert(css.includes(".site-agent-selection-chip") && css.includes("--product-color-primary-surface"), "The selection token does not use the canonical product active-state treatment");
assert(!component.includes("site-agent-rail"), "The retired pages and capabilities rail remains in the workspace");
assert(component.includes("{isAdmin ? ("), "Workspace diagnostics are not restricted to admins");
assert(component.includes("Admin diagnostics") && component.includes("workspace.site.id"), "Admin site diagnostics do not expose the site ID");
assert(component.includes('href={`/admin/runs/${run.id}`}') && component.includes("copyIdentifier(run.id, run.id)"), "Admin run diagnostics do not expose inspectable, copyable run IDs");
assert(editorRoute.includes("requireOwnerWorkspace") && editorRoute.includes("isAdmin={context.canAccessAdmin}"), "The workspace route does not pass canonical verified admin access to diagnostics");
assert(!component.includes("manageSitesHref") && !component.includes("site-agent-site-menu"), "Workspace retains duplicate global navigation instead of using the owner shell");
assert(!component.includes("Dashboard") && !component.includes("/dashboard"), "Workspace restores the retired dashboard concept");
assert(component.includes("workspace.input?.business.name ?? initialInput.business.name"), "Editor identity does not use the canonical public build input business name");
assert(component.includes("site-agent-command-title-desktop") && component.includes("Editor · "), "Desktop editor header does not identify the active website and task");
assert(component.includes('className="site-agent-preview-primary"') && component.includes('className="site-agent-preview-outcome"'), "Preview toolbar does not separate context/tools from the outcome actions");
assert(component.includes("site-agent-more-popover") && component.includes('aria-haspopup="dialog"') && component.includes('event.key !== "Escape"'), "Preview More menu is not keyboard-operable");
assert(
  component.includes('type PreviewViewport = "desktop" | "tablet" | "mobile"')
  && component.includes('value="tablet" label="Tablet preview"')
  && css.includes(".site-agent-preview-stage.is-tablet iframe")
  && css.includes("width: min(768px, 100%)"),
  "Preview dimensions do not expose the canonical desktop, tablet, and mobile choices"
);
assert(
  component.includes("<option key={page.id} value={page.path}>{page.path}</option>")
  && component.includes('className="site-agent-page-path-select"')
  && css.includes("width: clamp(160px, 28vw, 240px)"),
  "The compact page selector does not present canonical route paths"
);
assert(
  component.includes("const currentPreviewUrl = previewRouteUrl(previewBaseUrl, selectedPageValue)")
  && component.includes("<PreviewOpenLink href={currentPreviewUrl} />")
  && component.includes('target="_blank"')
  && component.includes('aria-label="Open preview in a new tab"'),
  "The selected private preview route cannot be opened in a new tab"
);
for (const label of ["Compare with live", "Version history", "Restore selected", "Open live site", "Admin diagnostics"]) {
  assert(component.includes(label), `Preview More menu is missing ${label}`);
}
assert(!component.includes("site-agent-history-menu") && !component.includes("site-agent-diagnostics-menu") && !component.includes("site-agent-tool-link"), "Retired peer-level preview actions remain in the toolbar");
assert(
  component.includes('className="site-agent-compose-mode"')
  && component.includes('role="menuitemradio"')
  && component.includes("aria-checked={mode.value === value}")
  && component.includes('{ value: "edit", label: "Build"')
  && component.includes('{ value: "ask", label: "Ask"')
  && component.includes('event.key === "ArrowDown" || event.key === "ArrowUp"')
  && component.includes('event.key !== "Escape"')
  && component.includes("triggerRef.current?.focus()"),
  "Composer does not expose the canonical keyboard-operable Build and Ask modes"
);
assert(component.includes("site-agent-starter-prompts") && component.includes("editorStarterPrompts"), "Empty editor does not provide contextual starter prompts");
assert(component.includes("publishDisabledReason") && component.includes("aria-describedby"), "Disabled Publish does not explain its requirement");
assert(frame.includes("site-agent-mobile-back") && component.includes("site-agent-mobile-more") && component.includes("site-agent-publish-mobile"), "Mobile editor topbar controls are incomplete");
assert(adminShell.includes('label: "Manage sites"') && adminShell.includes("<span>Admin</span>"), "Admin navigation and identity are not explicit");
assert(adminSites.includes('title="Manage sites"'), "The admin inventory is not named Manage sites");

assert(frame.includes('type DesktopPanelMode = "split" | "collapsed" | "full-chat"'), "Desktop panel states are not explicit");
assert(frame.includes('data-panel-ready={panelLayoutReady ? "true" : undefined}'), "Panel hydration is not exposed for stable interaction");
assert(frame.includes("const MIN_SPLIT_PANEL_WIDTH = 320"), "Chat panel minimum width changed without updating the workspace contract");
assert(frame.includes("const FULL_CHAT_THRESHOLD = 0.6"), "Full-chat snap threshold changed without updating the workspace contract");
assert(frame.includes("new ResizeObserver"), "Workspace width is not measured from its actual container");
assert(frame.includes("setPointerCapture(event.pointerId)"), "Panel dragging does not use pointer capture");
assert(frame.includes('window.addEventListener("pointerup", finish)'), "Panel dragging does not recover pointer completion across the preview iframe");
assert(frame.includes('role="separator"') && frame.includes('aria-orientation="vertical"'), "Panel resizer is not an accessible separator");
assert(frame.includes('event.key === "Home"') && frame.includes('event.key === "End"'), "Panel keyboard collapse and full-chat controls are missing");
assert(frame.includes("site-agent-resize-shield"), "Panel dragging does not protect against iframe pointer interception");
assert(frame.includes("window.localStorage.getItem(panelStorageKey(storageId))"), "Panel layout is not restored per workspace");
assert(frame.includes("window.localStorage.setItem(panelStorageKey(storageId)"), "Panel layout is not persisted per workspace");
assert(frame.includes("persistPanelLayout(true, persistedWidth)"), "Collapse preferences are not persisted synchronously");
assert(frame.includes('panelMode === "full-chat"') && frame.includes("return;\n    writePanelLayout"), "Full-chat mode is incorrectly persisted");
assert(frame.includes("desktopFullChat ? true : undefined"), "The mounted preview is not made inert in full-chat mode");
assert(frame.includes("mobilePane: MobilePane") && frame.includes("onMobilePaneChange(pane: MobilePane): void"), "The responsive frame does not expose controlled mobile pane state");

assert(!component.includes('message.role === "agent" ? "Lodesta"'), "Visible chat author labels remain");
assert(component.includes("messageAuthorLabel(item.message.role)"), "Chat authors are not exposed accessibly");
assert(component.includes("busy && !workspace.session ? (") && component.includes("Opening workspace"), "Initial workspace loading is not distinct from a genuinely empty conversation");
assert(component.includes('aria-busy={busy && !workspace.session ? true : undefined}'), "Initial workspace loading is not exposed accessibly");
assert(css.includes(".site-agent-loading-message") && css.includes("site-agent-loading-message > .site-agent-send-spinner"), "Initial workspace loading does not use the product loading treatment");
assert(component.includes('className="site-agent-send-button"'), "Composer does not use the compact icon send control");
assert(component.includes("<ArrowUpIcon />"), "Composer send control does not use the up-arrow icon");
assert(component.includes("Math.min(textarea.scrollHeight, 160)") && component.includes('textarea.style.overflowY = textarea.scrollHeight > 160 ? "auto" : "hidden"'), "Composer textarea does not auto-grow to the bounded height");
assert(component.includes("SpeechRecognition") && component.includes("webkitSpeechRecognition") && component.includes('recognition.lang = "en-US"'), "Composer voice input does not use browser-managed US English speech recognition");
assert(component.includes("site-agent-voice-button") && component.includes("aria-pressed={listening}") && component.includes("voiceRecognitionErrorMessage"), "Composer voice input does not expose accessible listening and failure states");
assert(component.includes("if (listening) stopDictation();") && component.includes("recognition.stop()"), "Composer voice input does not stop cleanly on user input and teardown");
assert(component.includes('activeRun?.kind === "initial_build"'), "Initial-build composer lock is not tied to the active initial build");
assert(component.includes('placeholder={initialBuildActive ? "Available when your first draft is ready"') && component.includes("disabled={initialBuildActive}"), "Initial-build composer does not explain and enforce its unavailable state");
assert(component.includes("RunActivityCard") && component.includes("activitySnapshots[item.run.id]")
  && component.includes("ownerTranscriptItems(workspace.messages, workspace.runs)"), "Workspace progress does not use owner-safe run activity snapshots");
assert(component.includes("event.nativeEvent.isComposing") && component.includes("event.shiftKey")
  && component.includes("event.preventDefault()"), "Composer Enter, Shift+Enter, or IME submission semantics are incomplete");
assert(!component.includes('className="site-agent-messages" aria-live=')
  && component.includes('aria-live="polite" aria-atomic="true"'), "High-frequency transcript activity remains in a live region");
assert(!sessionRoute.includes("activeRunActivity"), "Owner session payload still exposes raw run event activity");
for (const label of [
  "Preparing your website",
  "Designing your website",
  "Building your private preview",
  "Preview ready; finishing checks",
  "Reviewing your website",
  "Your answer is needed",
  "Private draft ready",
  "Website needs attention"
]) {
  assert(ownerRunView.includes(label), `Owner run projection is missing ${label}`);
}

assert(css.includes("grid-template-columns: var(--site-agent-panel-width"), "Desktop workspace does not use the resizable panel width");
assert(css.includes('.site-agent-workspace[data-panel-mode="collapsed"]') && css.includes("grid-template-columns: 52px"), "Collapsed chat rail is not implemented");
assert(css.includes('.site-agent-workspace[data-panel-mode="full-chat"]') && css.includes("width: min(100%, 760px)"), "Full-chat composition is not implemented");
assert(css.includes("max-height: 160px") && css.includes("border-radius: var(--product-radius-lg)") && css.includes("resize: none") && css.includes("caret-color: var(--product-color-primary)"), "Composer does not use the canonical content-hugging command-dock treatment");
assert(css.includes(".site-agent-send-button") && css.includes("width: var(--product-control-height-compact)"), "Desktop arrow send control is not compact");
assert(css.includes(".site-agent-select-page") && css.includes("width: var(--product-control-height-compact)") && css.includes("width: var(--product-control-height-touch)"), "The element selector is not a compact icon control with a mobile touch target");
assert(css.includes(".site-agent-voice-button,\n  .site-agent-send-button {\n    width: 44px") && css.includes(".site-agent-compose-mode-trigger") && css.includes(".site-agent-compose-mode-menu button"), "Mobile composer controls do not meet the touch-target contract");
assert(css.includes("background: var(--product-color-primary-surface)"), "Owner messages do not retain the green surface");
assert(css.includes('.site-agent-workspace[data-mobile-pane="chat"] .site-agent-preview-column'), "Mobile Chat mode does not hide the mounted preview pane");
assert(css.includes('.site-agent-workspace[data-mobile-pane="preview"] .site-agent-command'), "Mobile Preview mode does not hide the mounted chat pane");
assert(!css.includes(".site-agent-rail"), "Retired rail CSS remains after the clean workspace cutover");
const previewBarCss = css.match(/\.site-agent-preview-bar \{([\s\S]*?)\n\}/)?.[1] ?? "";
assert(previewBarCss.includes("grid-template-columns: minmax(0, 1fr) auto") && previewBarCss.includes("overflow: visible") && !previewBarCss.includes("overflow-x"), "Preview toolbar can still scroll Publish out of view");
assert(css.includes(".site-agent-preview-outcome") && css.includes(".site-agent-more-popover") && css.includes("right: 0"), "Preview outcome actions and More menu are not pinned to the toolbar edge");
assert(!component.includes("site-agent-more-mobile-tools") && !css.includes("site-agent-more-mobile-tools"), "Mobile retains duplicate preview controls in the More sheet");
assert(css.includes('grid-template-columns: max-content minmax(0, 240px) max-content') && css.includes("top: 126px"), "Mobile preview controls or the repositioned More sheet are incomplete");
assert(css.includes(".website-build-canvas") && css.includes("@keyframes website-build-gather") && css.includes("@keyframes website-build-sweep"), "The build canvas is missing aggregation, assembly, or render motion");
assert(css.includes(".website-build-canvas *") && css.includes("animation: none"), "The build canvas does not provide a static reduced-motion composition");
assert(css.includes('.owner-workspace-shell[data-shell-mode="focused-editor"] > .owner-workspace-mobile-header'), "Focused mobile editor does not hide duplicate global chrome");
const mobileTopbarControlCss = css.match(/\.site-agent-mobile-back,\n  \.site-agent-mobile-more \{([\s\S]*?)\n  \}/)?.[1] ?? "";
assert(mobileTopbarControlCss.includes("width: 44px") && mobileTopbarControlCss.includes("height: 44px"), "Mobile workspace topbar controls do not meet the 44px touch-target contract");

const selectionFixture = siteElementSelectionSchema.parse({
  route: "/",
  selector: "main > section > h1",
  label: "Hero heading",
  workspaceRevisionId: "workspace-revision",
  versionId: "version"
});
const persistedSelection = siteAgentMessageSchema.parse({
  schemaVersion: "site-agent-message",
  id: "message",
  sessionId: "session",
  role: "owner",
  content: "Make this more direct.",
  selection: selectionFixture,
  createdAt: "2026-07-25T00:00:00.000Z"
});
assert(persistedSelection.selection?.label === "Hero heading", "Owner-facing selection labels do not survive persisted agent-message validation");
assert(runRoute.includes("siteElementSelectionSchema.optional()") && discussRoute.includes("siteElementSelectionSchema.optional()"), "Edit and Ask APIs do not share selection-label validation");
assert(prompts.includes("selection: input.selection"), "Authoring prompts do not retain the labeled owner selection");

console.log("Site agent workspace verification passed.");

async function assertMissing(path: string) {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(`Retired route still exists: ${path}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
