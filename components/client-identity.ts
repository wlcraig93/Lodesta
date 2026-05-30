const sessionKey = "lodesta_session_id";
const sessionStartedKey = "lodesta_session_started_at";
const visitorKey = "lodesta_visitor_id";

declare global {
  interface Window {
    __lodestaSessionId?: string;
    __lodestaSessionStartedAt?: number;
    __lodestaVisitorId?: string;
  }
}

export function getSessionId() {
  if (window.__lodestaSessionId) return window.__lodestaSessionId;
  const storage = safeSessionStorage();
  const existing = storage.getItem(sessionKey);
  if (existing) {
    window.__lodestaSessionId = existing;
    return existing;
  }
  const created = crypto.randomUUID();
  storage.setItem(sessionKey, created);
  window.__lodestaSessionId = created;
  return created;
}

export function getSessionStartedAt() {
  if (window.__lodestaSessionStartedAt) return window.__lodestaSessionStartedAt;
  const storage = safeSessionStorage();
  const existing = Number(storage.getItem(sessionStartedKey));
  if (Number.isFinite(existing) && existing > 0) {
    window.__lodestaSessionStartedAt = existing;
    return existing;
  }
  const created = Date.now();
  storage.setItem(sessionStartedKey, String(created));
  window.__lodestaSessionStartedAt = created;
  return created;
}

export function getVisitorId() {
  if (window.__lodestaVisitorId) return window.__lodestaVisitorId;
  const storage = safeLocalStorage();
  if (!storage) return undefined;
  try {
    const existing = storage.getItem(visitorKey);
    if (existing) {
      window.__lodestaVisitorId = existing;
      return existing;
    }
    const created = crypto.randomUUID();
    storage.setItem(visitorKey, created);
    window.__lodestaVisitorId = created;
    return created;
  } catch {
    return undefined;
  }
}

function safeSessionStorage() {
  try {
    if (window.sessionStorage) return window.sessionStorage;
  } catch {
    // Fall through to an in-memory fallback for restricted browser contexts.
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    }
  };
}

function safeLocalStorage() {
  try {
    return window.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}
