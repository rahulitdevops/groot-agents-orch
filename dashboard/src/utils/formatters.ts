export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return "1d ago";
  if (days < 7) return `${days}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
}

export function formatBytes(b: number): string {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Input: "23:49" or "5:09" (H:MM) → Output: "23h 49m" / "5h 09m"
// If input doesn't match, return as-is.
export function formatUptimeHuman(uptime: string): string {
  const s = uptime.trim();
  // "N day(s), H:MM" (macOS uptime output)
  const dayMatch = /^(\d+)\s+days?,\s+(\d+):(\d{2})$/.exec(s);
  if (dayMatch) return `${dayMatch[1]}d ${dayMatch[2]}h ${dayMatch[3]}m`;
  // "H:MM"
  const hmMatch = /^(\d+):(\d{2})$/.exec(s);
  if (hmMatch) return `${hmMatch[1]}h ${hmMatch[2]}m`;
  return s;
}

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" };
  return d.toLocaleDateString("en-CA", opts) === now.toLocaleDateString("en-CA", opts);
}

export function usageColor(pct: number): string {
  if (pct >= 80) return "bg-groot-error";
  if (pct >= 50) return "bg-groot-warning";
  return "bg-groot-accent";
}

export function usageTextColor(pct: number): string {
  if (pct >= 80) return "text-red-400";
  if (pct >= 50) return "text-yellow-400";
  return "text-emerald-400";
}

export function formatIST(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
