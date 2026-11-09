import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { nodeBadge, type NodeStatus } from "@reddb-io/design-system/contracts/node-badge"
import { listRow } from "@reddb-io/design-system/contracts/list-row"
import { Icon } from "@opencode/ui/icon"
import { Spinner } from "@opencode/ui/spinner"
import type { ExecutionGraphNode } from "@opencode/client/promise"
import { createKeyed, createLatest, useExtension, type MountedSession } from "../sdk"
import { graphCounts, graphRows, invalidatesExecutionGraph, isLive } from "./model"

function tone(node: ExecutionGraphNode): NodeStatus {
  if (isLive(node)) return node.status === "waiting" || node.status === "suspended" ? "degraded" : "online"
  if (node.status === "failed") return "offline"
  return "unknown"
}

function icon(node: ExecutionGraphNode) {
  if (node.kind === "session") return "subagent" as const
  if (node.kind === "terminal" || node.kind === "shell") return "terminal" as const
  return "status" as const
}

function Stat(props: { label: string; value: number }) {
  return (
    <div class="min-w-0 border-t border-elevation-base-border pt-2">
      <div class="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted">{props.label}</div>
      <div class="mt-0.5 font-mono text-[15px] tabular-nums text-foreground">{props.value}</div>
    </div>
  )
}

export default function ExecutionPanel(props: { session: MountedSession; visible: boolean }) {
  const ctx = useExtension()
  const [revision, setRevision] = createSignal(0)
  // Follow the routed server controller; reconnects and server switches replace this external subscription.
  createKeyed(() => props.session.server.data, (data) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = data.listen(({ details }) => {
      if (!invalidatesExecutionGraph(details) || timer) return
      timer = setTimeout(() => {
        timer = undefined
        setRevision((value) => value + 1)
      }, 250)
    })
    onCleanup(() => {
      stop()
      if (timer) clearTimeout(timer)
    })
  })

  const source = createMemo(
    () =>
      props.visible && props.session.id
        ? { server: props.session.server, sessionID: props.session.id, revision: revision() }
        : undefined,
    undefined,
    {
      equals: (a, b) =>
        a?.server === b?.server && a?.sessionID === b?.sessionID && a?.revision === b?.revision,
    },
  )
  const result = createLatest(source, (input, signal) =>
    input.server.client.session.executionGraph({ sessionID: input.sessionID, shellLimit: 200 }, { signal }),
  )
  const counts = createMemo(() => (result.latest ? graphCounts(result.latest) : undefined))
  const rows = createMemo(() => (result.latest ? graphRows(result.latest) : []))
  const updated = createMemo(() =>
    result.latest
      ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(
          result.latest.generatedAt,
        )
      : "",
  )

  const open = async (node: ExecutionGraphNode) => {
    if (node.kind !== "session" || node.sessionID === props.session.id) return
    const server = props.session.server
    const cached = server.data.session.get(node.sessionID)
    const session = cached ?? (await server.client.session.get({ sessionID: node.sessionID }))
    ctx.sessions.open(server.id, session)
  }

  const label = (node: ExecutionGraphNode) => {
    if (node.kind === "session") return node.title || node.agent || node.sessionID
    if (node.kind === "job") return node.title || node.jobType
    if (node.kind === "terminal") return node.title
    return node.exit === undefined ? ctx.t("kind.shell") : ctx.t("shell.exit", { code: node.exit })
  }

  return (
    <div class="flex size-full min-h-0 flex-col bg-elevation-base-surface">
      <div class="flex items-center justify-between gap-3 border-b border-elevation-base-border px-3 py-2">
        <div class="flex items-center gap-2 text-12-medium text-foreground">
          <span class="relative flex size-2">
            <Show when={counts()?.active}>
              <span class="absolute inline-flex size-full animate-ping rounded-full bg-icon-success-base opacity-40" />
            </Show>
            <span class="relative inline-flex size-2 rounded-full bg-icon-success-base" />
          </span>
          {ctx.t("live")}
        </div>
        <Show when={result.latest}>
          <div class="text-[10px] tabular-nums text-ink-muted">{ctx.t("updated", { time: updated() })}</div>
        </Show>
      </div>

      <Show when={counts()}>
        {(value) => (
          <div class="grid grid-cols-4 gap-2 px-3 pt-3">
            <Stat label={ctx.t("sessions")} value={value().sessions} />
            <Stat label={ctx.t("active")} value={value().active} />
            <Stat label={ctx.t("jobs")} value={value().jobs} />
            <Stat label={ctx.t("terminals")} value={value().terminals} />
          </div>
        )}
      </Show>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <Show
          when={!result.error}
          fallback={
            <div class="mx-1 rounded-lg border border-elevation-base-border bg-elevation-sunken-surface p-3">
              <div class="text-12-medium text-foreground">{ctx.t("unavailable")}</div>
              <div class="mt-1 text-11-regular leading-relaxed text-ink-muted">{ctx.t("unavailable.description")}</div>
            </div>
          }
        >
          <Show
            when={!result.loading || result.latest}
            fallback={
              <div class="flex items-center justify-center gap-2 px-2 py-6 text-12-regular text-ink-muted">
                <Spinner class="size-3.5" />
                {ctx.t("loading")}
              </div>
            }
          >
            <Show
              when={rows().length > 0}
              fallback={<div class="px-2 py-6 text-center text-12-regular text-ink-muted">{ctx.t("empty")}</div>}
            >
              <ul class="flex flex-col">
                <For each={rows()}>
                  {(row) => {
                    const badge = nodeBadge({ status: tone(row.node), labelled: false })
                    const item = listRow({ size: "sm", interactive: row.node.kind === "session" })
                    return (
                      <li>
                        <button
                          type="button"
                          class={item.root({
                            class: "w-full rounded-md border-0 bg-transparent text-left hover:bg-elevation-sunken-surface disabled:cursor-default",
                          })}
                          style={{ "padding-left": `${8 + Math.min(row.depth, 4) * 14}px` }}
                          disabled={row.node.kind !== "session" || row.node.sessionID === props.session.id}
                          onClick={() => void open(row.node)}
                        >
                          <span class={item.leading({ class: "relative size-5 justify-center text-ink-muted" })}>
                            <Icon name={icon(row.node)} size="small" />
                            <span class={badge.dot({ class: "absolute -bottom-0.5 -right-0.5" })} />
                          </span>
                          <span class={item.text()}>
                            <span class={item.title({ class: "truncate text-12-regular" })}>{label(row.node)}</span>
                            <span class={item.description({ class: "truncate text-[10px]" })}>
                              {ctx.t(`kind.${row.node.kind}`)} · {ctx.t(`status.${row.node.status}`)}
                              {row.node.kind === "terminal" ? ` · ${ctx.t("terminal.pid", { pid: row.node.pid })}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  }}
                </For>
              </ul>
            </Show>
          </Show>
          <Show when={result.latest?.truncated.shells}>
            <div class="px-2 pt-2 text-[10px] text-ink-muted">{ctx.t("truncated")}</div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
