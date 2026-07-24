import { access, readFile } from "node:fs/promises";

const component = await readFile("components/SiteAgentWorkspace.tsx", "utf8");
const css = await readFile("app/globals.css", "utf8");
const editorRoute = await readFile("app/(owner-workspace)/workspace/[slug]/editor/page.tsx", "utf8");
const adminShell = await readFile("components/admin/AdminShell.tsx", "utf8");
const adminSites = await readFile("app/admin/sites/page.tsx", "utf8");

await access("app/(owner-workspace)/workspace/[slug]/editor/page.tsx");
await assertMissing("app/(workspace)/editor/[slug]/page.tsx");
await assertMissing("app/(owner)/editor/[slug]/page.tsx");
await assertMissing("app/(admin-app)/dashboard/page.tsx");
await assertMissing("app/(owner)/dashboard/[slug]/page.tsx");

assert(component.includes('const [composerMode, setComposerMode] = useState<"edit" | "ask">("edit")'), "Edit is not the default workspace mode");
assert(component.includes('const asking = composerMode === "ask"') && component.includes('asking ? "/api/site-agent/discuss" : "/api/site-agent/runs"'), "Ask and Edit do not use their canonical endpoints");
assert(component.includes("result.discussion.requiresApply && result.discussion.proposedAction"), "Discussion suggestions are not captured from the response");
assert(component.includes("setInstruction(discussionSuggestion.action)"), "Using a suggestion does not place the proposed action in the composer");
assert(component.includes('setComposerMode("edit")'), "Using a suggestion does not return the composer to Edit");
const useSuggestionBody = component.match(/function useSuggestion\(\) \{([\s\S]*?)\n  \}\n\n  function navigatePreview/)?.[1] ?? "";
assert(useSuggestionBody.length > 0 && !useSuggestionBody.includes("submit("), "Using a suggestion auto-submits the Build request");
assert(component.includes("frameWindow.location.assign(target)"), "Page selection does not navigate the mounted preview iframe");
assert(component.includes("setSelectedPagePath(route)"), "Iframe navigation does not synchronize the page picker");
assert(component.includes("key={previewIdentity}"), "Preview remount identity is not isolated from the selected page path");
assert(component.includes("event.target instanceof document.defaultView.Element"), "Element selection does not account for the iframe document realm");
assert(component.includes('data-mobile-pane={mobilePane}'), "Mobile pane state is not exposed to the mounted workspace");
assert(component.includes("inert={compactViewport && mobilePane"), "The inactive mobile pane is not made inert");
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
for (const label of ["Compare with live", "Version history", "Restore selected", "Open live site", "Admin diagnostics"]) {
  assert(component.includes(label), `Preview More menu is missing ${label}`);
}
assert(!component.includes("site-agent-history-menu") && !component.includes("site-agent-diagnostics-menu") && !component.includes("site-agent-tool-link"), "Retired peer-level preview actions remain in the toolbar");
assert(component.includes('className="site-agent-compose-mode"') && component.includes(">Edit</button>") && component.includes(">Ask</button>"), "Composer does not expose the canonical Edit and Ask modes");
assert(component.includes("site-agent-starter-prompts") && component.includes("editorStarterPrompts"), "Empty editor does not provide contextual starter prompts");
assert(component.includes("publishDisabledReason") && component.includes("aria-describedby"), "Disabled Publish does not explain its requirement");
assert(component.includes("site-agent-mobile-back") && component.includes("site-agent-mobile-more") && component.includes("site-agent-publish-mobile"), "Mobile editor topbar controls are incomplete");
assert(adminShell.includes('label: "Manage sites"') && adminShell.includes("<span>Admin</span>"), "Admin navigation and identity are not explicit");
assert(adminSites.includes('title="Manage sites"'), "The admin inventory is not named Manage sites");

assert(component.includes('type DesktopPanelMode = "split" | "collapsed" | "full-chat"'), "Desktop panel states are not explicit");
assert(component.includes('data-panel-ready={panelLayoutReady ? "true" : undefined}'), "Panel hydration is not exposed for stable interaction");
assert(component.includes("const MIN_SPLIT_PANEL_WIDTH = 320"), "Chat panel minimum width changed without updating the workspace contract");
assert(component.includes("const FULL_CHAT_THRESHOLD = 0.6"), "Full-chat snap threshold changed without updating the workspace contract");
assert(component.includes("new ResizeObserver"), "Workspace width is not measured from its actual container");
assert(component.includes("setPointerCapture(event.pointerId)"), "Panel dragging does not use pointer capture");
assert(component.includes('window.addEventListener("pointerup", finish)'), "Panel dragging does not recover pointer completion across the preview iframe");
assert(component.includes('role="separator"') && component.includes('aria-orientation="vertical"'), "Panel resizer is not an accessible separator");
assert(component.includes('event.key === "Home"') && component.includes('event.key === "End"'), "Panel keyboard collapse and full-chat controls are missing");
assert(component.includes("site-agent-resize-shield"), "Panel dragging does not protect against iframe pointer interception");
assert(component.includes("window.localStorage.getItem(panelStorageKey(siteId))"), "Panel layout is not restored per site");
assert(component.includes("window.localStorage.setItem(panelStorageKey(siteId)"), "Panel layout is not persisted per site");
assert(component.includes("persistPanelLayout(true, persistedWidth)"), "Collapse preferences are not persisted synchronously");
assert(component.includes('panelMode === "full-chat"') && component.includes("return;\n    writePanelLayout"), "Full-chat mode is incorrectly persisted");
assert(component.includes("desktopFullChat ? true : undefined"), "The mounted preview is not made inert in full-chat mode");

assert(!component.includes('message.role === "agent" ? "Lodesta"'), "Visible chat author labels remain");
assert(component.includes("messageAuthorLabel(message.role)"), "Chat authors are not exposed accessibly");
assert(component.includes("busy && !workspace.session ? (") && component.includes("Opening workspace"), "Initial workspace loading is not distinct from a genuinely empty conversation");
assert(component.includes('aria-busy={busy && !workspace.session ? true : undefined}'), "Initial workspace loading is not exposed accessibly");
assert(css.includes(".site-agent-loading-message") && css.includes("site-agent-loading-message > .site-agent-send-spinner"), "Initial workspace loading does not use the product loading treatment");
assert(component.includes('className="site-agent-send-button"'), "Composer does not use the compact icon send control");
assert(component.includes("<ArrowUpIcon />"), "Composer send control does not use the up-arrow icon");
assert(component.includes("Math.min(textarea.scrollHeight, 140)"), "Composer textarea does not auto-grow to the bounded height");

assert(css.includes("grid-template-columns: var(--site-agent-panel-width"), "Desktop workspace does not use the resizable panel width");
assert(css.includes('.site-agent-workspace[data-panel-mode="collapsed"]') && css.includes("grid-template-columns: 52px"), "Collapsed chat rail is not implemented");
assert(css.includes('.site-agent-workspace[data-panel-mode="full-chat"]') && css.includes("width: min(100%, 760px)"), "Full-chat composition is not implemented");
assert(css.includes("min-height: 44px") && css.includes("max-height: 140px") && css.includes("resize: none"), "Composer is not compact and auto-sized");
assert(css.includes(".site-agent-send-button") && css.includes("width: 40px"), "Desktop arrow send control is not compact");
assert(css.includes(".site-agent-send-button {\n    width: 44px"), "Mobile arrow send control does not meet the touch target");
assert(css.includes("background: var(--product-color-primary-surface)"), "Owner messages do not retain the green surface");
assert(css.includes('.site-agent-workspace[data-mobile-pane="chat"] .site-agent-preview-column'), "Mobile Chat mode does not hide the mounted preview pane");
assert(css.includes('.site-agent-workspace[data-mobile-pane="preview"] .site-agent-command'), "Mobile Preview mode does not hide the mounted chat pane");
assert(!css.includes(".site-agent-rail"), "Retired rail CSS remains after the clean workspace cutover");
const previewBarCss = css.match(/\.site-agent-preview-bar \{([\s\S]*?)\n\}/)?.[1] ?? "";
assert(previewBarCss.includes("grid-template-columns: minmax(0, 1fr) auto") && previewBarCss.includes("overflow: visible") && !previewBarCss.includes("overflow-x"), "Preview toolbar can still scroll Publish out of view");
assert(css.includes(".site-agent-preview-outcome") && css.includes(".site-agent-more-popover") && css.includes("right: 0"), "Preview outcome actions and More menu are not pinned to the toolbar edge");
assert(css.includes(".site-agent-more-mobile-tools") && css.includes("position: fixed") && css.includes("top: 66px"), "Mobile Preview tools do not move into the topbar More sheet");
assert(css.includes('.owner-workspace-shell[data-shell-mode="focused-editor"] > .owner-workspace-mobile-header'), "Focused mobile editor does not hide duplicate global chrome");

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
