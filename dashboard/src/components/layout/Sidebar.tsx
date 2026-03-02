"use client";
import { useState, useEffect } from "react";
import { useAppState, useAppActions } from "../../stores";
import { api } from "../../utils/api";
import type { PageId } from "../../types";

const NAV: { id: PageId; icon: string; label: string }[] = [
  { id: "dashboard", icon: "📊", label: "Dashboard" },
  { id: "agents", icon: "🤖", label: "Agents" },
  { id: "tasks", icon: "📋", label: "Tasks" },
  { id: "workflows", icon: "🔀", label: "Workflows" },
  { id: "sre", icon: "🛡️", label: "SRE" },
  { id: "usage", icon: "💰", label: "Usage" },
  { id: "settings", icon: "⚙️", label: "Settings" },
];

export function Sidebar() {
  const { activePage, sidebarCollapsed } = useAppState();
  const { setPage, dispatch } = useAppActions();
  const [pendingCheckpoints, setPendingCheckpoints] = useState(0);

  useEffect(() => {
    const fetchCheckpoints = () => {
      api<any[]>("/checkpoints?status=pending").then(data => {
        setPendingCheckpoints(Array.isArray(data) ? data.length : 0);
      }).catch(() => {});
    };
    fetchCheckpoints();
    const id = setInterval(fetchCheckpoints, 15000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className={`hidden md:flex flex-col fixed left-0 top-0 bottom-0 z-40 border-r border-white/[0.06] transition-all duration-200 ${sidebarCollapsed ? "w-16" : "w-56"}`}
      style={{ background: "rgba(10, 15, 30, 0.95)", backdropFilter: "blur(20px)" }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-white/[0.06] shrink-0">
        <span className="text-2xl">🌱</span>
        {!sidebarCollapsed && <span className="font-bold text-lg text-gradient">Groot</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-1">
        {NAV.map(n => (
          <button
            key={n.id}
            onClick={() => setPage(n.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activePage === n.id
                ? "bg-emerald-500/15 text-emerald-400"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="text-lg relative">
              {n.icon}
              {n.id === "workflows" && pendingCheckpoints > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-amber-500 rounded-full text-[8px] font-bold text-black flex items-center justify-center leading-none">
                  {pendingCheckpoints > 9 ? "9+" : pendingCheckpoints}
                </span>
              )}
            </span>
            {!sidebarCollapsed && (
              <span className="flex-1 flex items-center justify-between">
                {n.label}
                {n.id === "workflows" && pendingCheckpoints > 0 && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">
                    {pendingCheckpoints}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => dispatch({ type: "SET_SIDEBAR", payload: !sidebarCollapsed })}
        className="px-4 py-3 text-gray-500 hover:text-gray-300 text-xs border-t border-white/[0.06]"
      >
        {sidebarCollapsed ? "→" : "← Collapse"}
      </button>
    </aside>
  );
}

export { NAV };
