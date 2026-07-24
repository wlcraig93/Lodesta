export default function AnalyticsLoading() {
  return (
    <main className="workspace-page workspace-analytics-page" aria-busy="true">
      <div className="analytics-loading-line is-title" />
      <div className="analytics-loading-line" />
      <div className="analytics-loading-panel" />
      <span className="sr-only">Loading analytics</span>
    </main>
  );
}
