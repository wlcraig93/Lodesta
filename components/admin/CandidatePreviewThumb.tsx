"use client";

import { useEffect, useRef, useState } from "react";

const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 800;

export function CandidatePreviewThumb({ src, title }: { src: string; title: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setScale(width / FRAME_WIDTH);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="candidate-thumb" aria-hidden="true">
      {scale !== null ? (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          tabIndex={-1}
          style={{
            width: `${FRAME_WIDTH}px`,
            height: `${FRAME_HEIGHT}px`,
            transform: `scale(${scale})`
          }}
        />
      ) : null}
    </div>
  );
}
