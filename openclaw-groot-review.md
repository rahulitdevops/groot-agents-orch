# OpenClaw Groot — Architecture Review & Recommendations

**Reviewed by:** Claude
**Date:** March 2, 2026
**Scope:** Full codebase review of the Groot supervisor agent system

---

## Executive Summary

Your project is impressive for a personal agent army — you've built a working multi-agent orchestration system with a dashboard, WebSocket bridge to OpenClaw gateway, task engine, and 6 specialized agents. The infrastructure (Fastify API, SQLite, Redis SSE, PWA dashboard) is solid.

However, **Groot isn't "smart" because it has no brain** — it's a routing table, not a supervisor. The core issue isn't any single bug; it's an architectural gap between what you want (an intelligent supervisor) and what you've built (a keyword-matching task router).

---

## The 7 Critical Issues

### 1. Groot Has No Prompt — It's a Router, Not a Supervisor

**This is the #1 problem.** Every other agent has a `CLAUDE.md` that defines its personality, rules, and behavior. Groot doesn't have one. There's no `agents/groot/CLAUDE.md`.

What Groot actually does today:
- Receives a message via WhatsApp
- Runs `autoAssign()` which does **keyword matching** against a flat list
- Spawns a sub-agent with that agent's CLAUDE.md
- Reports back

What Groot should do:
- Understand the intent behind your message
- Break complex tasks into subtasks
- Decide which agents to involve (sometimes multiple)
- Coordinate handoffs between agents
- Synthesize results before reporting back
- Ask clarifying questions when the task is ambiguous

**The fix:** Create a `agents/groot/CLAUDE.md` with a rich system prompt that defines Groot as a thinking supervisor. This prompt should be injected into the OpenClaw main session (the WhatsApp-connected one), not into sub-agents.

### 2. The Auto-Assignment Is Brittle Keyword Matching

```typescript
// Current approach in task-engine.ts
const ROUTING_RULES = [
  { agent: 'builder', keywords: ['build', 'create', 'implement', 'add', 'fix', ...] },
  { agent: 'researcher', keywords: ['research', 'find', 'compare', ...] },
  ...
];
```

Problems with this:
- **"Fix the login page"** → matches both `builder` (fix, page) AND `debugger` (fix). Builder wins because it has more keyword hits, but Debugger might be the right choice.
- **"Research and then build a new auth system"** → multi-step task that needs Researcher first, then Builder. Current system picks one agent only.
- **"Make the dashboard faster"** → could be Builder (optimize code), SRE (check resources), Debugger (find bottleneck), or Researcher (find best practices). The keyword system can't reason about this.
- **No fallback intelligence** — if no keywords match well, it defaults to Builder regardless.

**The fix:** Replace keyword matching with LLM-based routing. Groot's supervisor prompt should include a "think step" where it reasons about which agent(s) to use and in what order.

### 3. No Multi-Agent Coordination / Task Decomposition

The task engine processes one task → one agent. There's no concept of:
- **Sequential pipelines:** "Research X, then Builder implements based on findings"
- **Parallel execution:** "QA tests while SRE monitors during deploy"
- **Conditional routing:** "If Debugger can't fix it, escalate to Builder for refactor"
- **Result synthesis:** "Combine Researcher's findings with PM's spec into a single deliverable"

Your PM agent writes specs, but there's no mechanism for Builder to automatically pick up a PM spec and implement it. Each task is isolated.

**The fix:** Add a `workflow` or `plan` concept to the task engine. Groot should be able to create a task plan like:
```json
{
  "plan": [
    { "step": 1, "agent": "researcher", "task": "Research auth libraries for Next.js" },
    { "step": 2, "agent": "pm", "task": "Write spec based on research", "dependsOn": 1 },
    { "step": 3, "agent": "builder", "task": "Implement auth per spec", "dependsOn": 2 },
    { "step": 4, "agent": "qa", "task": "Test auth flow", "dependsOn": 3 }
  ]
}
```

### 4. Agents Have No Memory or Context Sharing

Each agent spawn is stateless. When Builder finishes a task and QA needs to test it, QA doesn't know:
- What files Builder changed
- What the expected behavior is
- What the previous state was

The agent CLAUDE.md files reference hardcoded paths (`~/projects/groot/output/pm/`), but there's no structured way to pass context between agents. The task engine sends only the task description string — no attachments, no prior outputs, no conversation history.

**The fix:** Add a shared context/memory system. Options:
- **Task output chaining:** Store agent outputs in the DB and include previous step's output in the next agent's prompt
- **Shared workspace files:** A `context/` directory where agents read/write structured data
- **Task metadata:** Extend the task schema to include `input_context` and `output_context` fields

### 5. No Feedback Loop — Groot Can't Learn From Results

When a task completes or fails, this happens:

```typescript
export function onTaskCompleted(taskId: number, output?: string) {
  if (output) db.prepare('UPDATE tasks SET output = ? WHERE id = ?').run(output, taskId);
  removeFromQueue(taskId);
  processQueue().catch(console.error);
}
```

That's it. The output is stored but never read. Groot doesn't:
- Evaluate if the task was actually done correctly
- Decide if follow-up work is needed
- Report a summary back to you (Das) via WhatsApp
- Learn from patterns (e.g., "Builder keeps failing TypeScript tasks, should route to Debugger first")

**The fix:** After task completion, Groot should:
1. Read the output
2. Evaluate it against the original request
3. Decide: done, needs follow-up, or needs a different agent
4. Send you a concise WhatsApp summary

### 6. Agent Prompts Are Too Generic

The CLAUDE.md files are reasonable starting points, but they're missing critical context that would make agents smarter:

**Builder** doesn't know:
- The current project structure (which files exist, what patterns are used)
- Recent changes and their context
- Your coding preferences beyond stack choices

**QA** has hardcoded test commands but:
- No dynamic test discovery
- No awareness of what actually changed (tests everything every time)
- No concept of test priority based on risk area

**SRE** is the best-defined agent, but:
- The 3-minute health check interval is generating 480+ check files per day (the `output/sre/` folder is massive)
- No intelligent deduplication — every check produces the same "All services UP" report

**The fix:** Each CLAUDE.md should include:
- A "Current State" section that gets dynamically injected (recent git changes, current file structure)
- Clearer decision trees for edge cases
- Examples of good vs. bad outputs
- Cross-agent awareness ("after you finish, QA will test your work")

### 7. No Error Recovery or Escalation Intelligence

When a task fails, the system marks it `failed` and moves on. There's no:
- Automatic retry with a different approach
- Escalation to a more capable agent
- Notification to you with diagnostics
- Pattern detection (same type of failure repeating)

The `isAgentBusy()` check is the only scheduling intelligence — it's purely about capacity, not about capability or task suitability.

---

## Architecture Diagram — Current vs. Recommended

### Current Flow
```
You (WhatsApp) → OpenClaw Gateway → Groot (keyword match) → Single Agent → Done
```

### Recommended Flow
```
You (WhatsApp) → OpenClaw Gateway → Groot (LLM reasoning)
  → Think: What's the intent? What agents needed? What order?
  → Plan: Create multi-step task plan
  → Execute: Step 1 agent → capture output
  → Evaluate: Did step 1 succeed? Feed context to step 2
  → Execute: Step 2 agent → capture output
  → ... repeat ...
  → Synthesize: Combine all outputs
  → Report: Send concise summary back to you
```

---

## Quick Wins (Can Implement Today)

1. **Create `agents/groot/CLAUDE.md`** — Even without changing the task engine, giving Groot a rich system prompt that the WhatsApp session uses will make it dramatically smarter at understanding your requests and communicating results.

2. **Replace `autoAssign()` with LLM routing** — Instead of keyword matching, have the main Groot session decide which agent to use. Since Groot IS the WhatsApp Claude session, it can reason about routing naturally.

3. **Add output-to-input chaining** — When spawning a sub-agent, include the previous agent's output in the task prompt. This is a small change to `executeTask()`.

4. **Reduce SRE noise** — Change from 3-minute checks to 10-minute, and only write a report file when something changes or every hour for a summary.

5. **Add a post-task evaluation step** — After `onTaskCompleted`, have Groot read the output and decide if follow-up is needed.

---

## Longer-Term Improvements

1. **Workflow Engine** — A proper DAG-based task orchestration where Groot creates plans with dependencies, parallel steps, and conditional branches.

2. **Shared Memory Store** — A Redis or SQLite-based memory where agents write structured outputs that other agents can query. Think of it as a team wiki.

3. **Agent Self-Improvement** — Track success/failure rates per agent per task type. Use this data to improve routing and to evolve agent prompts over time. You already have the `agent_skills` table with XP — make it functional.

4. **Human-in-the-Loop Checkpoints** — For critical tasks, Groot should pause and ask you for approval before proceeding (e.g., before deploying, before deleting files).

5. **Observability** — You have activity_log but it's write-only. Build a "what happened while I was away" summary that Groot can generate on demand.

---

## Summary of Priority Actions

| Priority | Action | Impact | Effort |
|----------|--------|--------|--------|
| P0 | Create Groot's CLAUDE.md system prompt | High — gives Groot a brain | Low |
| P0 | Replace keyword autoAssign with LLM routing | High — correct agent selection | Medium |
| P1 | Add task output chaining between agents | High — enables multi-step work | Medium |
| P1 | Add post-completion evaluation | Medium — catches failed tasks | Low |
| P1 | Reduce SRE check frequency | Low — saves cost & disk | Low |
| P2 | Build workflow/plan engine | Very High — enables complex tasks | High |
| P2 | Shared agent memory | High — enables team coordination | Medium |
| P3 | Agent self-improvement from metrics | Medium — gets smarter over time | High |
