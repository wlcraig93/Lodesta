export const webVitalThresholds = {
  LCP: 2500,
  CLS: 0.1,
  INP: 200,
  TTFB: 800
} as const;

export type WebVitalMetric = keyof typeof webVitalThresholds;

export function normalizeWebVitalMetric(value: unknown): WebVitalMetric | undefined {
  const metric = String(value ?? "").toUpperCase();
  return metric in webVitalThresholds ? (metric as WebVitalMetric) : undefined;
}

export function webVitalWithinThreshold(metric: WebVitalMetric, value: number) {
  return value <= webVitalThresholds[metric];
}

export function formatWebVitalValue(metric: WebVitalMetric, value: number) {
  if (metric === "CLS") return String(value);
  return `${Math.round(value)}ms`;
}

