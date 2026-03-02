"use client";
import { AppProvider, useAppState } from "../stores";
import { PageShell } from "../components/layout/PageShell";
import { DashboardPage } from "../views/DashboardPage";
import { AgentsPage } from "../views/AgentsPage";
import { TasksPage } from "../views/TasksPage";
import { SrePage } from "../views/SrePage";
import { SettingsPage } from "../views/SettingsPage";
import { UsagePage } from "../views/UsagePage";
import { WorkflowsPage } from "../views/WorkflowsPage";

function PageRouter() {
  const { activePage } = useAppState();

  switch (activePage) {
    case "dashboard": return <DashboardPage />;
    case "agents": return <AgentsPage />;
    case "tasks": return <TasksPage />;
    case "workflows": return <WorkflowsPage />;
    case "sre": return <SrePage />;
    case "usage": return <UsagePage />;
    case "settings": return <SettingsPage />;
    default: return <DashboardPage />;
  }
}

export default function Home() {
  return (
    <AppProvider>
      <PageShell>
        <PageRouter />
      </PageShell>
    </AppProvider>
  );
}
