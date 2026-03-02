export function StatusDot({ active, size = "md" }: { active: boolean; size?: "sm" | "md" }) {
  const s = size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5";
  return (
    <span className={`${s} rounded-full shrink-0 ${active ? "bg-emerald-400 pulse-green" : "bg-gray-500"}`} />
  );
}
