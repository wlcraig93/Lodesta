export default function WorkspaceLoading() {
  return (
    <main className="workspace-page workspace-route-loading" aria-busy="true" aria-live="polite">
      <div className="analytics-loading-line is-title" aria-hidden="true" />
      <div className="analytics-loading-line" aria-hidden="true" />
      <div className="analytics-loading-panel" aria-hidden="true" />
      <span className="sr-only">Loading workspace</span>
    </main>
  );
}
