"use client";
import { useAppState, useAppActions } from "../../stores";
import { useState } from "react";
import type { ConnStatus } from "../../types";

function ConnIndicator({ status }: { status: ConnStatus }) {
  const cfg = {
    live: { icon: "🟢", label: "Live", cls: "text-emerald-400" },
    polling: { icon: "🟡", label: "Polling", cls: "text-yellow-400" },
    offline: { icon: "🔴", label: "Offline", cls: "text-red-400" },
  }[status];
  return <span className={`text-xs ${cfg.cls} flex items-center gap-1`}>{cfg.icon} {cfg.label}</span>;
}

const PAGE_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  agents: "Agents",
  tasks: "Tasks",
  sre: "SRE",
  settings: "Settings",
};

export function Header() {
  const { activePage, connStatus, searchQuery, refreshing } = useAppState();
  const [mobileSearch, setMobileSearch] = useState(false);
  const { dispatch, fetchAll } = useAppActions();

  const handleRefresh = async () => {
    dispatch({ type: "SET_REFRESHING", payload: true });
    await fetchAll();
    setTimeout(() => dispatch({ type: "SET_REFRESHING", payload: false }), 500);
  };

  return (
    <>
    <header className="h-16 flex items-center justify-between gap-4 px-4 md:px-6 border-b border-white/[0.06] shrink-0"
      style={{ background: "rgba(10, 15, 30, 0.8)", backdropFilter: "blur(12px)" }}>
      {/* Left: title (mobile) */}
      <div className="flex items-center gap-3 md:hidden">
        <span className="text-xl">🌱</span>
        <h1 className="font-bold text-lg">{PAGE_TITLES[activePage]}</h1>
      </div>
      {/* Left: title (desktop) */}
      <h1 className="hidden md:block font-semibold text-lg">{PAGE_TITLES[activePage]}</h1>

      {/* Right */}
      <div className="flex items-center gap-3">
        {/* Search - Desktop */}
        <div className="relative hidden md:block">
          <input
            type="text"
            value={searchQuery}
            onChange={e => dispatch({ type: "SET_SEARCH", payload: e.target.value })}
            placeholder="Search..."
            className="w-48 lg:w-64 px-3 py-1.5 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40 pl-8"
          />
          <span className="absolute left-2.5 top-2 text-xs text-gray-500">🔍</span>
        </div>
        {/* Search - Mobile toggle */}
        <button onClick={() => setMobileSearch(s => !s)} className="md:hidden p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors">
          <span className="text-base">🔍</span>
        </button>

        <ConnIndicator status={connStatus} />

        <button
          onClick={handleRefresh}
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
        >
          <span className={`text-base ${refreshing ? "animate-spin inline-block" : ""}`}>🔄</span>
        </button>
      </div>
    </header>
      {/* Mobile search bar - slides down */}
      {mobileSearch && (
        <div className="md:hidden px-4 py-2 border-b border-white/[0.06]" style={{ background: "rgba(10, 15, 30, 0.95)" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => dispatch({ type: "SET_SEARCH", payload: e.target.value })}
            placeholder="Search..."
            className="w-full px-3 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40"
            autoFocus
          />
        </div>
      )}
    </>
  );
}
