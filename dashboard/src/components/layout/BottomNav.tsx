"use client";
import { useAppState, useAppActions } from "../../stores";
import { NAV } from "./Sidebar";

export function BottomNav() {
  const { activePage } = useAppState();
  const { setPage } = useAppActions();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/[0.06] md:hidden"
      style={{ background: "rgba(10, 15, 30, 0.95)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
    >
      <div className="flex justify-around items-center px-1" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 8px)" }}>
        {NAV.map(n => (
          <button
            key={n.id}
            onClick={() => setPage(n.id)}
            className={`relative flex flex-col items-center gap-0.5 py-2 px-3 min-h-[52px] min-w-[52px] transition-all active:scale-90 ${
              activePage === n.id ? "text-emerald-400" : "text-gray-500"
            }`}
          >
            {activePage === n.id && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-emerald-400 rounded-full" />}
            <span className="text-lg">{n.icon}</span>
            <span className="text-xs font-medium">{n.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
