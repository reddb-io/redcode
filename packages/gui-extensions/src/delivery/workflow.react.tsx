/** @jsxImportSource react */
import { useState } from "react"
import type { SessionInfo, Todo, TodoAssignment, TodoGraphNode } from "@opencode/client/promise"
import { WorkflowDiagram, type WorkflowData } from "@reddb-io/design-system/data/WorkflowDiagram"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Button } from "@reddb-io/design-system/base/Button"

export default function DeliveryTaskFlow(props: {
  tasks: readonly Todo[]
  nodes: readonly TodoGraphNode[]
  assignments: readonly TodoAssignment[]
  sessions: readonly SessionInfo[]
  current: string
  copy: Record<string, string>
  open(id: string): void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const entries = props.tasks.map((task, index) => ({
    key: task.id === undefined ? `legacy:${index}` : `task:${task.id}`,
    task,
  }))
  const byID = new Map(entries.filter((entry) => entry.task.id).map((entry) => [entry.task.id, entry]))
  const graph = new Map(props.nodes.filter((node) => node.id).map((node) => [node.id, node]))
  const data: WorkflowData = {
    nodes: entries.map((entry) => ({
      id: entry.key,
      label: entry.task.title ?? entry.task.content,
      state: props.copy[entry.task.status === "in_progress" ? "inProgress" : entry.task.status],
      tone:
        entry.task.status === "completed"
          ? "success"
          : entry.task.status === "blocked"
            ? "warning"
            : entry.task.status === "in_progress"
              ? "info"
              : "neutral",
      ports: [
        { id: "in", label: props.copy.inputPort, side: "input" },
        { id: "out", label: props.copy.outputPort, side: "output" },
      ],
    })),
    edges: entries.flatMap((entry) =>
      (graph.get(entry.task.id)?.dependencies ?? entry.task.dependencies ?? []).flatMap((id) => {
        const source = byID.get(id)
        return source
          ? [
              {
                id: `edge:${JSON.stringify([id, entry.task.id])}`,
                label: props.copy.prerequisite,
                source: source.key,
                target: entry.key,
              },
            ]
          : []
      }),
    ),
  }
  const target = data.edges.find((edge) => edge.id === selected)?.target ?? selected
  const task = entries.find((entry) => entry.key === target)?.task
  const node = task?.id ? graph.get(task.id) : undefined
  const dependencies = node?.dependencies ?? task?.dependencies ?? []
  const assignments = task?.id ? props.assignments.filter((item) => item.current && item.taskID === task.id) : []
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="m-0 text-caption text-ink-muted">{props.copy.flowNote}</p>
      <WorkflowDiagram
        label={props.copy.taskFlow}
        data={data}
        direction="down"
        selected={selected}
        interactive
        size="lg"
        onselectedchange={setSelected}
      />
      {task && (
        <section
          aria-label={props.copy.taskDetails}
          className="min-w-0 rounded-lg border border-elevation-raised-border p-3"
        >
          <h4 className="m-0 break-words text-body font-medium">{task.title ?? task.content}</h4>
          {task.criterion && (
            <div className="mt-3">
              <h5 className="m-0 text-eyebrow text-ink-muted">{props.copy.criterion}</h5>
              <p className="mb-0 mt-1 whitespace-pre-wrap break-words text-caption">{task.criterion}</p>
            </div>
          )}
          {task.reason && <p className="mb-0 mt-2 whitespace-pre-wrap break-words text-caption">{task.reason}</p>}
          <h5 className="mb-1 mt-3 text-eyebrow text-ink-muted">{props.copy.prerequisites}</h5>
          {dependencies.length ? (
            <ul aria-label={props.copy.prerequisites} className="m-0 list-none space-y-2 p-0">
              {dependencies.map((id) => {
                const dependency = byID.get(id)
                const waiting = node?.waitingFor.includes(id)
                return (
                  <li key={id} className="flex min-w-0 flex-wrap items-center gap-1 text-caption">
                    {dependency ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-w-0 whitespace-normal text-start"
                        onClick={() => setSelected(dependency.key)}
                      >
                        {dependency.task.title ?? dependency.task.content}
                      </Button>
                    ) : (
                      <span className="break-all">{id}</span>
                    )}
                    <Badge tone={waiting ? "warning" : "neutral"}>
                      {
                        props.copy[
                          !node ? "prerequisiteUnavailable" : waiting ? "waitingForAcceptance" : "prerequisiteSatisfied"
                        ]
                      }
                    </Badge>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="m-0 text-caption text-ink-muted">{props.copy.noPrerequisites}</p>
          )}
          <h5 className="mb-1 mt-3 text-eyebrow text-ink-muted">{props.copy.assignedConversations}</h5>
          {assignments.length ? (
            <ul aria-label={props.copy.assignedConversations} className="m-0 list-none space-y-1 p-0">
              {assignments.map((assignment) => {
                const session = props.sessions.find((session) => session.id === assignment.sessionID)
                return (
                  <li key={assignment.sessionID} className="min-w-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="max-w-full whitespace-normal text-start"
                      disabled={!session || session.id === props.current}
                      onClick={() => props.open(assignment.sessionID)}
                    >
                      {session?.title ?? props.copy.conversationUnavailable}
                    </Button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="m-0 text-caption text-ink-muted">{props.copy.noAssignments}</p>
          )}
        </section>
      )}
    </div>
  )
}
