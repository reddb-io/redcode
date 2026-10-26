/** @jsxImportSource react */
import { useState, type ComponentProps } from "react"
import type { SessionInfo, SessionGoalInfo, Todo, TodoAssignment } from "@opencode/client/promise"
import { SidebarPanel } from "@reddb-io/design-system/app/SidebarPanel"
import { TaskList } from "@reddb-io/design-system/app/TaskList"
import { Button } from "@reddb-io/design-system/base/Button"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { RadialProgress } from "@reddb-io/design-system/base/RadialProgress"
import { RadialContent } from "@reddb-io/design-system/base/RadialContent"
import { Tabs } from "@reddb-io/design-system/base/Tabs"
import TreeView, { type TreeNode } from "@reddb-io/design-system/data/TreeView"
import { LinkedResources, DeliverySkills } from "./resources.react"
import type { DeliveryResources } from "./resources"
import type { DeliverySection } from "./resources-model"

type View = {
  key: string
  root: string
  current: string
  connected: boolean
  project?: string
  directory: string
  server: string
  copy: Record<string, string>
  goal?: SessionGoalInfo | null
  tasks: readonly Todo[]
  assignments: readonly TodoAssignment[]
  sessions: readonly (SessionInfo & { state: "running" | "waiting" | "idle" | NonNullable<SessionInfo["outcome"]> })[]
  loading: boolean
  unavailable: boolean
  refreshing: boolean
}

export function DeliveryView(props: {
  view: View
  resources: ReturnType<DeliveryResources["snapshot"]>
  resourceActions: DeliveryResources["actions"]
  section(value: DeliverySection): void
  refresh(): void
  open(id: string): void
  review?: () => void
}) {
  return <DeliveryContent key={props.view.key} {...props} />
}

function DeliveryContent(props: Parameters<typeof DeliveryView>[0]) {
  const view = props.view
  const copy = view.copy
  const [selected, setSelected] = useState<string | null>(view.current)
  const [expanded, setExpanded] = useState<readonly string[]>([view.root])
  const agent = view.sessions.find((item) => item.id === selected)
  const completed = view.tasks.filter((item) => item.status === "completed").length
  const tasks: ComponentProps<typeof TaskList>["items"] = view.tasks.map((task, index) => ({
    id: task.id ?? `legacy-${index}`,
    title: task.title ?? task.content,
    description: task.criterion,
    state:
      task.status === "in_progress"
        ? "running"
        : task.status === "completed"
          ? "succeeded"
          : task.status === "pending"
            ? "queued"
            : task.status === "blocked"
              ? "blocked"
              : task.status === "cancelled"
                ? "cancelled"
                : "paused",
    stateLabel: copy[task.status === "in_progress" ? "inProgress" : task.status] ?? task.status,
    reason: task.reason,
    worker:
      view.assignments
        .filter((item) => item.current && item.taskID === task.id)
        .map((item) => view.sessions.find((session) => session.id === item.sessionID)?.title ?? item.sessionID)
        .join(", ") || undefined,
  }))
  const goalStatus = {
    active: "goalActive",
    waiting: "goalWaiting",
    paused: "goalPaused",
    blocked: "goalBlocked",
    done: "goalDone",
  } as const
  const nodes = (parent: string | undefined): TreeNode[] =>
    view.sessions
      .filter((item) => (parent ? item.parentID === parent : item.id === view.root))
      .map((item) => ({ id: item.id, label: item.title ?? item.id, children: nodes(item.id) }))
  return (
    <SidebarPanel
      title={copy.title}
      className="h-full min-h-0 border-0 bg-transparent shadow-none"
      actions={
        <Button
          size="sm"
          variant="ghost"
          disabled={
            !view.connected || (props.resources.section === "overview" ? view.refreshing : props.resources.refreshing)
          }
          onClick={props.refresh}
        >
          {
            copy[
              props.resources.section === "overview"
                ? "refresh"
                : props.resources.section === "skills"
                  ? "refreshSkills"
                  : "refreshResources"
            ]
          }
        </Button>
      }
      footer={
        props.review && (
          <Button variant="secondary" onClick={props.review} className="w-full">
            {copy.changes}
          </Button>
        )
      }
    >
      <Tabs
        label={copy.sections}
        value={props.resources.section}
        items={[
          { value: "overview", label: copy.overview },
          { value: "resources", label: copy.resources },
          { value: "skills", label: copy.skills },
        ]}
        onValueChange={(value) => {
          if (value === "overview" || value === "resources" || value === "skills") props.section(value)
        }}
      >
        {(item) =>
          item.value === "overview" ? (
            <div className="flex min-w-0 flex-col gap-[var(--reddb-spatial-layout-gap-md)] text-body">
              <p className="m-0 text-caption text-ink-muted">{copy.description}</p>
              {(!view.connected || view.unavailable) && (
                <p role="alert" className="m-0 text-caption text-feedback-warning-foreground">
                  {view.connected ? copy.unavailable : copy.disconnected}
                </p>
              )}
              {view.loading && view.connected && (
                <p role="status" className="text-caption text-ink-muted">
                  {copy.loading}
                </p>
              )}
              <section
                aria-label={copy.objective}
                className="rounded-lg border border-elevation-raised-border bg-elevation-raised-surface p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="m-0 text-eyebrow text-ink-muted">{copy.objective}</h3>
                  {view.goal && (
                    <Badge tone={view.goal.status === "blocked" ? "warning" : "neutral"}>
                      {copy[goalStatus[view.goal.status]]}
                    </Badge>
                  )}
                </div>
                <p className="m-0 whitespace-pre-wrap break-words text-body font-medium">
                  {view.goal?.objective ?? copy.noObjective}
                </p>
                {view.goal?.reason && <p className="mb-0 mt-2 text-caption text-ink-muted">{view.goal.reason}</p>}
              </section>
              <dl className="m-0 grid min-w-0 gap-2 text-caption">
                {[
                  [copy.project, view.project],
                  [copy.server, view.server],
                  [copy.checkout, view.directory],
                ].map(
                  ([label, value]) =>
                    value && (
                      <div key={label} className="flex min-w-0 gap-3">
                        <dt className="w-16 shrink-0 text-ink-muted">{label}</dt>
                        <dd className="m-0 min-w-0 break-all">{value}</dd>
                      </div>
                    ),
                )}
              </dl>
              <section aria-label={copy.agents}>
                <TreeView
                  label={copy.agents}
                  nodes={nodes(undefined)}
                  selected={selected}
                  onSelectedChange={setSelected}
                  expanded={expanded}
                  onExpandedChange={setExpanded}
                  trailing={(node) => {
                    const item = view.sessions.find((item) => item.id === node.id)
                    return item ? (
                      <Badge tone={item.state === "waiting" ? "warning" : "neutral"}>{copy[item.state]}</Badge>
                    ) : null
                  }}
                />
                {agent && (
                  <div
                    aria-label={copy.agentDetails}
                    className="mt-2 rounded-lg border border-elevation-raised-border p-3"
                  >
                    <div className="text-caption text-ink-muted">{copy.native}</div>
                    <p className="my-1 break-words text-body font-medium">{agent.title ?? agent.id}</p>
                    <p className="mb-2 mt-0 break-all text-caption text-ink-muted">
                      {[agent.agent, agent.model?.id].filter(Boolean).join(" · ")}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={agent.id === view.current}
                      onClick={() => props.open(agent.id)}
                    >
                      {copy.openAgent}
                    </Button>
                  </div>
                )}
              </section>
              <section aria-label={copy.tasks}>
                {!!view.tasks.length && (
                  <div className="mb-3 flex items-center gap-3">
                    <RadialProgress
                      label={copy.progress}
                      value={completed}
                      max={view.tasks.length}
                      diameter={76}
                      thickness={0.12}
                      center={() => <RadialContent value={`${completed} / ${view.tasks.length}`} />}
                    />
                    <p className="m-0 flex-1 text-caption text-ink-muted">{copy.progressNote}</p>
                  </div>
                )}
                <TaskList label={copy.tasks} items={tasks} emptyLabel={copy.noTasks} />
              </section>
              <section aria-label={copy.evidence}>
                <h3 className="mb-2 mt-0 text-eyebrow text-ink-muted">{copy.evidence}</h3>
                {view.goal?.checks.length ? (
                  <ul className="m-0 list-none space-y-2 p-0">
                    {view.goal.checks.map((check, index) => (
                      <li key={`${check.at}-${index}`} className="flex items-start gap-2 text-caption">
                        <Badge tone={check.exitCode === 0 ? "success" : "danger"}>{check.exitCode}</Badge>
                        <code className="min-w-0 break-all">{check.command}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-caption text-ink-muted">{copy.noEvidence}</p>
                )}
              </section>
            </div>
          ) : item.value === "resources" ? (
            <LinkedResources view={props.resources} actions={props.resourceActions} copy={copy} />
          ) : (
            <DeliverySkills view={props.resources} actions={props.resourceActions} copy={copy} />
          )
        }
      </Tabs>
    </SidebarPanel>
  )
}
