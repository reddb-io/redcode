import type { ExecutionGraphInfo, ExecutionGraphNode, OpenCodeEvent } from "@opencode/client/promise"

export type ExecutionRow = {
  readonly node: ExecutionGraphNode
  readonly depth: number
}

const live = new Set(["pending", "running", "waiting", "suspended"])

export function isLive(node: ExecutionGraphNode) {
  return live.has(node.status)
}

export function graphCounts(graph: ExecutionGraphInfo) {
  return {
    sessions: graph.nodes.filter((node) => node.kind === "session").length,
    active: graph.nodes.filter(isLive).length,
    jobs: graph.nodes.filter((node) => node.kind === "job" || node.kind === "shell").length,
    terminals: graph.nodes.filter((node) => node.kind === "terminal").length,
  }
}

function order(a: ExecutionGraphNode, b: ExecutionGraphNode) {
  const active = Number(isLive(b)) - Number(isLive(a))
  if (active !== 0) return active
  const kind = ["job", "shell", "terminal"].indexOf(a.kind) - ["job", "shell", "terminal"].indexOf(b.kind)
  if (kind !== 0) return kind
  const aTime = "started" in a ? a.started : 0
  const bTime = "started" in b ? b.started : 0
  return bTime - aTime
}

/** A stable, compact projection: work owned by a session, followed by its delegated child sessions. */
export function graphRows(graph: ExecutionGraphInfo): ExecutionRow[] {
  const sessions = new Map(
    graph.nodes.flatMap((node) => (node.kind === "session" ? [[node.sessionID, node] as const] : [])),
  )
  const work = new Map<string, ExecutionGraphNode[]>()
  for (const node of graph.nodes) {
    if (node.kind === "session") continue
    const list = work.get(node.sessionID) ?? []
    list.push(node)
    work.set(node.sessionID, list)
  }
  const children = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (edge.relation !== "delegates") continue
    const parent = graph.nodes.find((node) => node.id === edge.from)
    const child = graph.nodes.find((node) => node.id === edge.to)
    if (parent?.kind !== "session" || child?.kind !== "session") continue
    const list = children.get(parent.sessionID) ?? []
    list.push(child.sessionID)
    children.set(parent.sessionID, list)
  }

  const rows: ExecutionRow[] = []
  const seen = new Set<string>()
  const visit = (sessionID: string, depth: number) => {
    if (seen.has(sessionID)) return
    seen.add(sessionID)
    const session = sessions.get(sessionID)
    if (session) rows.push({ node: session, depth })
    for (const node of (work.get(sessionID) ?? []).toSorted(order)) rows.push({ node, depth: depth + 1 })
    for (const child of children.get(sessionID) ?? []) visit(child, depth + 1)
  }
  visit(graph.rootSessionID, 0)
  for (const sessionID of sessions.keys()) visit(sessionID, 0)
  return rows
}

/** Events that can change the server-side execution projection. */
export function invalidatesExecutionGraph(event: OpenCodeEvent) {
  return (
    event.type.startsWith("session.") ||
    event.type.startsWith("message.") ||
    event.type.startsWith("part.") ||
    event.type.startsWith("persistent-pty.")
  )
}
