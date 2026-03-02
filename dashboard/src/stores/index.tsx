"use client";
import React, { createContext, useContext, useReducer, useCallback, useRef, useEffect } from "react";
import type { Agent, Task, SystemInfo, Usage, HealthInfo, PageId, ConnStatus } from "../types";
import { api, createEventSource, hasToken, setToken, clearToken } from "../utils/api";

/* ─── State ─── */
interface AppState {
  // auth
  authed: boolean | null;
  // agents
  agents: Agent[];
  agentsLoading: boolean;
  // tasks
  tasks: Task[];
  tasksLoading: boolean;
  // system
  system: SystemInfo | null;
  health: HealthInfo | null;
  gateway: string;
  // usage
  usage: Usage | null;
  // ui
  activePage: PageId;
  sidebarCollapsed: boolean;
  searchQuery: string;
  connStatus: ConnStatus;
  error: string | null;
  refreshing: boolean;
  expandedTask: string | null;
}

const initialState: AppState = {
  authed: null,
  agents: [],
  agentsLoading: true,
  tasks: [],
  tasksLoading: true,
  system: null,
  health: null,
  gateway: "checking",
  usage: null,
  activePage: "dashboard",
  sidebarCollapsed: false,
  searchQuery: "",
  connStatus: "offline",
  error: null,
  refreshing: false,
  expandedTask: null,
};

/* ─── Actions ─── */
type Action =
  | { type: "SET_AUTHED"; payload: boolean | null }
  | { type: "SET_AGENTS"; payload: Agent[] }
  | { type: "SET_TASKS"; payload: Task[] }
  | { type: "SET_SYSTEM"; payload: SystemInfo | null }
  | { type: "SET_HEALTH"; payload: HealthInfo | null }
  | { type: "SET_GATEWAY"; payload: string }
  | { type: "SET_USAGE"; payload: Usage | null }
  | { type: "SET_PAGE"; payload: PageId }
  | { type: "SET_SIDEBAR"; payload: boolean }
  | { type: "SET_SEARCH"; payload: string }
  | { type: "SET_CONN"; payload: ConnStatus }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_REFRESHING"; payload: boolean }
  | { type: "SET_EXPANDED_TASK"; payload: string | null }
  | { type: "SET_LOADING_DONE" }
  | { type: "UPDATE_AGENT"; payload: Partial<Agent> & { id: string } };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_AUTHED": return { ...state, authed: action.payload };
    case "SET_AGENTS": return { ...state, agents: action.payload, agentsLoading: false };
    case "SET_TASKS": return { ...state, tasks: action.payload, tasksLoading: false };
    case "SET_SYSTEM": return { ...state, system: action.payload };
    case "SET_HEALTH": return { ...state, health: action.payload };
    case "SET_GATEWAY": return { ...state, gateway: action.payload };
    case "SET_USAGE": return { ...state, usage: action.payload };
    case "SET_PAGE": return { ...state, activePage: action.payload };
    case "SET_SIDEBAR": return { ...state, sidebarCollapsed: action.payload };
    case "SET_SEARCH": return { ...state, searchQuery: action.payload };
    case "SET_CONN": return { ...state, connStatus: action.payload };
    case "SET_ERROR": return { ...state, error: action.payload };
    case "SET_REFRESHING": return { ...state, refreshing: action.payload };
    case "SET_EXPANDED_TASK": return { ...state, expandedTask: action.payload };
    case "SET_LOADING_DONE": return { ...state, agentsLoading: false, tasksLoading: false };
    case "UPDATE_AGENT": return { ...state, agents: state.agents.map(a => a.id === action.payload.id ? { ...a, ...action.payload } : a) };
    default: return state;
  }
}

/* ─── Helpers ─── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAgent(raw: any): Agent {
  return {
    id: raw.id,
    name: raw.name || raw.id,
    emoji: raw.emoji || "🤖",
    model: raw.model || "",
    tier: raw.tier || "",
    status: raw.status || "idle",
    lastTask: raw.last_task || raw.lastTask || null,
    updatedAt: raw.updated_at || raw.updatedAt || undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTask(raw: any, agentsMap: Map<string, Agent>): Task {
  const agentId = raw.agent_id || raw.agentId || "";
  const agent = agentsMap.get(agentId);
  return {
    id: String(raw.id),
    agentId,
    agent: agent ? `${agent.emoji} ${agent.name}` : agentId,
    description: raw.description || "",
    status: ({"completed":"done","running":"in_progress","working":"in_progress","pending":"todo"} as Record<string,string>)[raw.status] || raw.status || "todo",
    output: raw.output || undefined,
    timestamp: raw.created_at || raw.timestamp || undefined,
    completedAt: raw.completed_at || raw.completedAt || undefined,
  };
}

/* ─── Context ─── */
interface AppActions {
  dispatch: React.Dispatch<Action>;
  fetchAll: () => Promise<void>;
  setPage: (page: PageId) => void;
  login: (token: string) => void;
  logout: () => void;
}

const StateCtx = createContext<AppState>(initialState);
const ActionsCtx = createContext<AppActions>({
  dispatch: () => {},
  fetchAll: async () => {},
  setPage: () => {},
  login: () => {},
  logout: () => {},
});

export function useAppState() { return useContext(StateCtx); }
export function useAppActions() { return useContext(ActionsCtx); }

/* ─── Hash routing ─── */
const PAGES: PageId[] = ["dashboard", "agents", "tasks", "workflows", "sre", "usage", "settings"];

function getPageFromHash(): PageId {
  if (typeof window === "undefined") return "dashboard";
  const hash = window.location.hash.replace("#", "");
  return PAGES.includes(hash as PageId) ? (hash as PageId) : "dashboard";
}

/* ─── Provider ─── */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const prevTasksRef = useRef<Task[]>([]);

  const fetchAll = useCallback(async () => {
    try {
      const [agentsRaw, tasksRaw, healthData, usageData, systemData] = await Promise.all([
        api<any[]>("/agents").catch(() => []),
        api<any[]>("/tasks").catch(() => []),
        api<HealthInfo>("/health").catch(() => null),
        api<Usage>("/usage").catch(() => null),
        api<SystemInfo>("/system").catch(() => null),
      ]);

      const agentsList = Array.isArray(agentsRaw) ? agentsRaw : ((agentsRaw as any)?.agents || []);
      const agents = agentsList.map(mapAgent);
      const agentsMap = new Map<string, Agent>(agents.map((a: Agent) => [a.id, a]));

      const tasksList = Array.isArray(tasksRaw) ? tasksRaw : ((tasksRaw as any)?.tasks || []);
      const tasks = tasksList.map((t: any) => mapTask(t, agentsMap));
      tasks.sort((a: Task, b: Task) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tb - ta;
      });

      let gwStatus = "offline";
      try {
        const gw = await api<{ status: string }>("/gateway");
        gwStatus = gw.status === "ok" ? "online" : "offline";
      } catch { gwStatus = "offline"; }

      prevTasksRef.current = tasks;

      dispatch({ type: "SET_AGENTS", payload: agents });
      dispatch({ type: "SET_TASKS", payload: tasks });
      if (healthData) dispatch({ type: "SET_HEALTH", payload: healthData });
      if (usageData && !(usageData as any).error) dispatch({ type: "SET_USAGE", payload: usageData });
      if (systemData) dispatch({ type: "SET_SYSTEM", payload: systemData });
      dispatch({ type: "SET_GATEWAY", payload: gwStatus });
      dispatch({ type: "SET_ERROR", payload: null });
    } catch (e) {
      dispatch({ type: "SET_ERROR", payload: "Failed to fetch data" });
      dispatch({ type: "SET_LOADING_DONE" });
    }
  }, []);

  const setPage = useCallback((page: PageId) => {
    dispatch({ type: "SET_PAGE", payload: page });
    if (typeof window !== "undefined") {
      window.location.hash = page;
    }
  }, []);

  const login = useCallback((token: string) => {
    setToken(token);
    dispatch({ type: "SET_AUTHED", payload: true });
  }, []);

  const logout = useCallback(() => {
    clearToken();
    dispatch({ type: "SET_AUTHED", payload: false });
  }, []);

  // Auth check on mount
  useEffect(() => {
    if (!hasToken()) {
      dispatch({ type: "SET_AUTHED", payload: false });
      return;
    }
    // Token exists — trust it immediately, verify in background
    dispatch({ type: "SET_AUTHED", payload: true });
    // Verify token is valid (if not, will get 401 on first fetch which clears token)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    api("/health", { signal: controller.signal })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
  }, []);

  // Hash routing
  useEffect(() => {
    dispatch({ type: "SET_PAGE", payload: getPageFromHash() });
    const onHash = () => dispatch({ type: "SET_PAGE", payload: getPageFromHash() });
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Data fetching + SSE + polling
  useEffect(() => {
    if (state.authed !== true) return;
    fetchAll();

    let pollId: ReturnType<typeof setInterval> | null = null;
    let es: EventSource | null = null;

    const startPolling = () => {
      if (pollId) return;
      dispatch({ type: "SET_CONN", payload: "polling" });
      pollId = setInterval(fetchAll, 5000);
    };
    const stopPolling = () => { if (pollId) { clearInterval(pollId); pollId = null; } };

    const startSSE = () => {
      es = createEventSource();
      if (!es) { startPolling(); return; }
      es.addEventListener("agent:status", (ev) => {
        try {
          const data = JSON.parse(ev.data);
          dispatch({ type: "UPDATE_AGENT", payload: mapAgent(data) });
        } catch {}
      });
      es.addEventListener("task:update", () => fetchAll());
      es.onmessage = () => fetchAll();
      es.onopen = () => { dispatch({ type: "SET_CONN", payload: "live" }); stopPolling(); };
      es.onerror = () => { es?.close(); es = null; dispatch({ type: "SET_CONN", payload: "polling" }); startPolling(); };
    };

    startPolling();
    startSSE();

    return () => { es?.close(); stopPolling(); };
  }, [state.authed, fetchAll]);

  const actions: AppActions = { dispatch, fetchAll, setPage, login, logout };

  return (
    <StateCtx.Provider value={state}>
      <ActionsCtx.Provider value={actions}>
        {children}
      </ActionsCtx.Provider>
    </StateCtx.Provider>
  );
}
