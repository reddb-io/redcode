export const AGENT_GROUPS = [
  { label: "agents.group.execution", views: ["sessions", "inbox", "harness", "remote"] },
  { label: "agents.group.workspaces", views: ["project-environments", "environments", "worktrees"] },
  { label: "agents.group.infrastructure", views: ["machines", "hosts"] },
] as const
export const AGENT_VIEWS = AGENT_GROUPS.flatMap((group) => [...group.views])
export type AgentView = (typeof AGENT_VIEWS)[number]
export const AGENT_LABELS = {
  sessions: "agents.sessions",
  inbox: "agents.inbox.title",
  harness: "harness.title",
  machines: "agentMachines.title",
  "project-environments": "projectEnvironments.title",
  environments: "environments.title",
  worktrees: "agentWorktrees.title",
  hosts: "agents.hosts.title",
  remote: "remoteWorkers.title",
} as const
