export type DomainResolutionCacheValue =
  | {
      resolved: true;
      slug: string;
      siteId?: string;
      domainStatus?: string;
    }
  | {
      resolved: false;
    };

const positiveTtlMs = 300_000;
const negativeTtlMs = 30_000;

const cache = new Map<
  string,
  {
    expiresAt: number;
    value: DomainResolutionCacheValue;
  }
>();

export function getCachedDomainResolution(hostname: string, now = Date.now()) {
  const entry = cache.get(hostname);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(hostname);
    return undefined;
  }
  return entry.value;
}

export function rememberDomainResolution(hostname: string, value: DomainResolutionCacheValue, now = Date.now()) {
  cache.set(hostname, {
    value,
    expiresAt: now + (value.resolved ? positiveTtlMs : negativeTtlMs)
  });
  return value;
}

export function invalidateDomainResolution(hostname: string) {
  cache.delete(hostname);
}
