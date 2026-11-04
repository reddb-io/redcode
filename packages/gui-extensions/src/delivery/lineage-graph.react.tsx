/** @jsxImportSource react */
import type { SessionInfo } from "@opencode/client/promise"
import { Graph } from "@reddb-io/design-system/data/Graph"

export default function LineageGraph(props: { label: string; sessions: readonly SessionInfo[] }) {
  const ids = new Set(props.sessions.map((session) => session.id))
  const nodes = props.sessions.map((session) => ({ id: session.id, label: session.title || session.id }))
  const edges = props.sessions.flatMap((session) =>
    session.parentID && ids.has(session.parentID) ? [{ source: session.parentID, target: session.id }] : [],
  )

  // The adjacent tree owns selection and keyboard access; this graph is a compact visual overview.
  return (
    <div aria-hidden="true" inert className="mt-2 min-w-0 overflow-hidden rounded-md border border-muted [&_ul]:hidden">
      <Graph
        label={props.label}
        data={{ nodes, edges }}
        renderer="svg"
        searchable={false}
        controls={false}
        width={420}
        height={140}
      />
    </div>
  )
}
