function getToken(): string | null {
  if (typeof window === "undefined") return null;
  // Check URL first (handles fresh page load with token)
  try {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      localStorage.setItem("groot-token", urlToken);
      // Clean URL after saving
      try { window.history.replaceState({}, "", window.location.pathname + window.location.hash); } catch {}
      return urlToken;
    }
  } catch {}
  // Check hash params (some mobile browsers put params after hash)
  try {
    const hash = window.location.hash;
    if (hash.includes("token=")) {
      const t = new URLSearchParams(hash.split("?")[1] || "").get("token");
      if (t) { localStorage.setItem("groot-token", t); return t; }
    }
  } catch {}
  return localStorage.getItem("groot-token");
}

export function hasToken(): boolean {
  return !!getToken();
}

export function setToken(token: string) {
  localStorage.setItem("groot-token", token);
}

export function clearToken() {
  localStorage.removeItem("groot-token");
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const t = Date.now();
  const sep = path.includes("?") ? "&" : "?";
  const url = `/api${path}${sep}t=${t}`;
  const headers = { ...authHeaders(), ...(opts.headers || {}) };
  const res = await fetch(url, { ...opts, headers, cache: "no-store" });
  if (res.status === 401) {
    clearToken();
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export function createEventSource(): EventSource | null {
  try {
    const token = getToken();
    const url = token ? `/api/events?token=${token}` : "/api/events";
    return new EventSource(url);
  } catch {
    return null;
  }
}
