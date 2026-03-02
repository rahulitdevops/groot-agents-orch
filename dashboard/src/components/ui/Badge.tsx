const STATUS: Record<string, { dot: string; bg: string; text: string }> = {
  idle: { dot: "bg-emerald-400", bg: "bg-emerald-500/15", text: "text-emerald-400" },
  todo: { dot: "bg-gray-400", bg: "bg-gray-500/15", text: "text-gray-400" },
  in_progress: { dot: "bg-blue-400 animate-pulse", bg: "bg-blue-500/15", text: "text-blue-400" },
  done: { dot: "bg-emerald-400", bg: "bg-emerald-500/15", text: "text-emerald-400" },
  scheduled: { dot: "bg-amber-400", bg: "bg-amber-500/15", text: "text-amber-400" },
  failed: { dot: "bg-red-400", bg: "bg-red-500/15", text: "text-red-400" },
  // legacy compat
  running: { dot: "bg-blue-400 animate-pulse", bg: "bg-blue-500/15", text: "text-blue-400" },
  working: { dot: "bg-blue-400 animate-pulse", bg: "bg-blue-500/15", text: "text-blue-400" },
  completed: { dot: "bg-emerald-400", bg: "bg-emerald-500/15", text: "text-emerald-400" },
  pending: { dot: "bg-gray-400", bg: "bg-gray-500/15", text: "text-gray-400" },
  pass: { dot: "bg-emerald-400", bg: "bg-emerald-500/15", text: "text-emerald-400" },
  fail: { dot: "bg-red-400", bg: "bg-red-500/15", text: "text-red-400" },
  warn: { dot: "bg-yellow-400", bg: "bg-yellow-500/15", text: "text-yellow-400" },
};

const LABELS: Record<string, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
  scheduled: "Scheduled",
  failed: "Failed",
};

export function Badge({ status, size = "sm" }: { status: string; size?: "sm" | "xs" }) {
  const cfg = STATUS[status] || STATUS.idle;
  const label = LABELS[status] || status;
  const cls = size === "xs" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2.5 py-1";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${cfg.bg} ${cfg.text} ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {label}
    </span>
  );
}

export function ModelBadge({ model }: { model: string }) {
  const short = model.includes("/") ? model.split("/").pop()! : model;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400 font-mono">
      {short}
    </span>
  );
}
