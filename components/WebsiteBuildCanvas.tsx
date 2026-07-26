export type WebsiteBuildCanvasStage =
  | "queued"
  | "gathering"
  | "composing"
  | "building"
  | "paused"
  | "attention";

export function WebsiteBuildCanvas({
  stage,
  title,
  detail,
  sourceLabel
}: {
  stage: WebsiteBuildCanvasStage;
  title: string;
  detail: string;
  sourceLabel?: string;
}) {
  return (
    <div className="website-build-canvas" data-stage={stage}>
      <div className="website-build-visual" aria-hidden="true">
        <div className="website-build-source is-one"><span /></div>
        <div className="website-build-source is-two"><span /></div>
        <div className="website-build-source is-three"><span /></div>
        <div className="website-build-page">
          <div className="website-build-page-bar"><i /><i /><i /></div>
          <span className="website-build-block is-nav" />
          <span className="website-build-block is-hero" />
          <span className="website-build-block is-copy" />
          <span className="website-build-block is-copy-short" />
          <div className="website-build-block-row"><span /><span /><span /></div>
          <span className="website-build-render-sweep" />
        </div>
      </div>
      <div className="website-build-copy">
        {sourceLabel ? <small>{sourceLabel}</small> : null}
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}
