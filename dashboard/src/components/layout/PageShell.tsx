"use client";
import { useAppState, useAppActions } from "../../stores";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { Header } from "./Header";
import { LoginScreen } from "../LoginScreen";
import React, { useState } from "react";

function TaskFAB({ activePage }: { activePage: string }) {
  const [hidden, setHidden] = useState(false);
  
  React.useEffect(() => {
    const show = () => setHidden(false);
    const hide = () => setHidden(true);
    window.addEventListener("groot:modal-open", hide);
    window.addEventListener("groot:modal-close", show);
    return () => { window.removeEventListener("groot:modal-open", hide); window.removeEventListener("groot:modal-close", show); };
  }, []);
  
  if (activePage !== "tasks" || hidden) return null;
  
  const handleClick = () => {
    window.dispatchEvent(new CustomEvent("groot:create-task"));
  };
  
  return (
    <button
      onClick={handleClick}
      aria-label="Create Task"
      className="md:hidden"
      style={{
        position: "fixed",
        bottom: "100px",
        right: "16px",
        width: "56px",
        height: "56px",
        borderRadius: "50%",
        backgroundColor: "#10b981",
        color: "white",
        fontSize: "28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 10px 25px rgba(16,185,129,0.3)",
        border: "none",
        cursor: "pointer",
        zIndex: 45,
      }}
    >+</button>
  );
}
import { PullToRefresh } from "../ui/PullToRefresh";

export function PageShell({ children }: { children: React.ReactNode }) {
  const { authed, sidebarCollapsed, activePage } = useAppState();
  const { login, fetchAll } = useAppActions();

  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-3xl animate-pulse">🌱</span>
      </div>
    );
  }

  if (authed === false) {
    return <LoginScreen onLogin={login} />;
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className={`flex-1 flex flex-col min-h-screen min-w-0 transition-all duration-200 ${sidebarCollapsed ? "md:ml-16" : "md:ml-56"}`}>
        <Header />
        <PullToRefresh onRefresh={fetchAll}>
          <main className="flex-1 p-3 sm:p-4 md:p-6 pb-24 md:pb-6 overflow-x-hidden w-full max-w-full">
            <div className="max-w-7xl mx-auto page-enter min-w-0">
              {children}
            </div>
          </main>
        </PullToRefresh>
      </div>
      {/* FAB for Tasks page — at root level to avoid backdrop-filter breaking fixed */}
      {authed && <TaskFAB activePage={activePage} />}
      <BottomNav />
    </div>
  );
}
