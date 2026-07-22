import { access, readFile } from "node:fs/promises";

const component = await readFile("components/SiteAgentWorkspace.tsx", "utf8");
const css = await readFile("app/globals.css", "utf8");
const editorRoute = await readFile("app/(owner-workspace)/workspace/[slug]/website/page.tsx", "utf8");
const adminShell = await readFile("components/admin/AdminShell.tsx", "utf8");
const adminSites = await readFile("app/admin/sites/page.tsx", "utf8");

await access("app/(owner-workspace)/workspace/[slug]/website/page.tsx");
await assertMissing("app/(workspace)/editor/[slug]/page.tsx");
await assertMissing("app/(owner)/editor/[slug]/page.tsx");
await assertMissing("app/(admin-app)/dashboard/page.tsx");
await assertMissing("app/(owner)/dashboard/[slug]/page.tsx");

assert(component.includes('const [planMode, setPlanMode] = useState(false)'), "Build is not the default workspace mode");
assert(component.includes('planMode ? "/api/site-agent/discuss" : "/api/site-agent/runs"'), "Plan and Build do not use their canonical endpoints");
assert(component.includes("result.discussion.requiresApply && result.discussion.proposedAction"), "Plan suggestions are not captured from the discussion response");
assert(component.includes("setInstruction(planSuggestion.action)"), "Use this plan does not place the proposed action in the composer");
const usePlanBody = component.match(/function usePlan\(\) \{([\s\S]*?)\n  \}\n\n  function navigatePreview/)?.[1] ?? "";
assert(usePlanBody.length > 0 && !usePlanBody.includes("submit("), "Use this plan auto-submits the Build request");
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
