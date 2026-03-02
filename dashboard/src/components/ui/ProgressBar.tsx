import { usageColor } from "../../utils/formatters";

interface ProgressBarProps {
  value: number;
  label: string;
  sublabel?: string;
  color?: string;
  autoColor?: boolean;
  height?: "sm" | "md";
}

export function ProgressBar({ value, label, sublabel, color, autoColor, height = "sm" }: ProgressBarProps) {
  const barColor = color || (autoColor ? usageColor(value) : "bg-groot-accent");
  const h = height === "md" ? "h-2.5" : "h-2";
  return (
    <div className="space-y-1">
      <div className="flex flex-col sm:flex-row sm:justify-between text-xs gap-0.5">
        <span className="text-gray-400">{label}</span>
        <span className="font-medium text-gray-300">{sublabel ?? `${value}%`}</span>
      </div>
      <div className={`w-full bg-white/5 rounded-full ${h} overflow-hidden`}>
        <div
          className={`${barColor} ${h} rounded-full transition-all duration-700 ease-out relative`}
          style={{ width: `${Math.min(value, 100)}%` }}
        >
          <div className="absolute inset-0 shimmer rounded-full" />
        </div>
      </div>
    </div>
  );
}
