import { eyebrow } from "@reddb-io/design-system/contracts/eyebrow"
import { quietControl } from "@reddb-io/design-system/contracts/quiet-control"
import { statusIndicator } from "@reddb-io/design-system/contracts/status-indicator"
import { useI18n } from "@opencode/ui/context/i18n"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { Icon } from "@opencode/ui/icon"
import { getDirectory, getFilename } from "@opencode/util/path"
import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { useData } from "../context"
import { sessionOutputCounts, type SessionOutputs, type SubagentStatus } from "./outputs"

const visibleRows = 5

const statusTone = { running: "info", done: "success", failed: "danger" } as const

const statusLabel = {
  running: "ui.sessionOutputs.running",
  done: "ui.sessionOutputs.done",
  failed: "ui.sessionOutputs.failed",
} as const

/**
 * "3 outputs · 1 subagent · 5 sources ⌄": the session's files and designs, the subagents it started and the pages,
 * searches and files it drew on. Collapsed, only the summary shows; each row opens what it names.
 */
export function SessionOutputsCard(props: {
  outputs: SessionOutputs
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The live status of a child session, when known: it outlasts the call that started it. */
  liveStatus?: (sessionID: string) => SubagentStatus | undefined
  onOpenFile?: (path: string) => void
  onOpenDesign?: (id: string) => void
  onOpenSession?: (sessionID: string) => void
  onOpenUrl?: (url: string) => void
}) {
  const i18n = useI18n()
  const data = useData()
  const counts = createMemo(() => sessionOutputCounts(props.outputs))
  const subagents = createMemo(() =>
    props.outputs.subagents.map((item) => {
      const live = item.sessionID ? props.liveStatus?.(item.sessionID) : undefined
      // A live child outranks its call, and an idle one ends a call that only reported starting in the background;
      // the call keeps its own verdict otherwise.
      if (live === "running" || (live && item.status === "running")) return { ...item, status: live }
      return item
    }),
  )
  const running = () => subagents().filter((item) => item.status === "running").length
  const summary = () =>
    [
      counts().outputs > 0 && i18n.plural("ui.sessionOutputs.summary.outputs", counts().outputs),
      counts().subagents > 0 && i18n.plural("ui.sessionOutputs.summary.subagents", counts().subagents),
      counts().sources > 0 && i18n.plural("ui.sessionOutputs.summary.sources", counts().sources),
    ]
      .filter((part): part is string => !!part)
      .join(" · ")
  const relative = (path: string) => {
    const directory = data.directory
    if (!directory || directory === "/" || !path.startsWith(directory)) return path
    return path.slice(directory.length).replace(/^[\\/]/, "")
  }
  const sources = createMemo(() => [
    ...props.outputs.web.map((source) => ({ type: "web" as const, source })),
    ...(props.outputs.filesRead > 0 ? [{ type: "read" as const, count: props.outputs.filesRead }] : []),
  ])
  const outputs = createMemo(() => [
    ...props.outputs.designs.map((design) => ({ type: "design" as const, design })),
    ...props.outputs.files.map((file) => ({ type: "file" as const, file })),
  ])

  return (
    <section
      data-component="session-outputs"
      aria-label={i18n.t("ui.sessionOutputs.label")}
      class={`pointer-events-auto flex min-h-0 max-w-full flex-col overflow-hidden rounded-lg border border-elevation-raised-border bg-elevation-raised-surface font-sans text-[13px] leading-text-compact text-foreground shadow-elevation-raised ${props.open ? "w-[17rem]" : "w-auto"}`}
    >
      <button
        type="button"
        aria-expanded={props.open}
        title={props.open ? i18n.t("ui.sessionOutputs.collapse") : i18n.t("ui.sessionOutputs.expand")}
        class={quietControl({
          ink: "foreground",
          focus: "inset",
          class: `flex w-full shrink-0 items-center gap-2 text-start ${props.open ? "h-9 px-3" : "h-8 ps-2.5 pe-2"}`,
        })}
        onClick={() => props.onOpenChange(!props.open)}
      >
        <Show
          when={props.open}
          fallback={
            // Collapsed, the card is a compact pill of counts that stays clear of the conversation.
            <span class="flex items-center gap-2.5 tabular-nums text-ink-muted">
              <span class="sr-only">{summary()}</span>
              <Show when={counts().outputs > 0}>
                <span aria-hidden="true" class="flex items-center gap-1">
                  <Icon name="edit" size="small" />
                  {counts().outputs}
                </span>
              </Show>
              <Show when={counts().subagents > 0}>
                <span aria-hidden="true" class="flex items-center gap-1">
                  <Icon name="subagent" size="small" />
                  {counts().subagents}
                </span>
              </Show>
              <Show when={counts().sources > 0}>
                <span aria-hidden="true" class="flex items-center gap-1">
                  <Icon name="globe" size="small" />
                  {counts().sources}
                </span>
              </Show>
            </span>
          }
        >
          <span class="min-w-0 flex-1 truncate tabular-nums text-ink-muted">{summary()}</span>
        </Show>
        <Show when={running() > 0}>
          <span class={statusIndicator({ tone: "info" }).root()}>
            <span class={statusIndicator({ tone: "info" }).mark({ class: "motion-safe:animate-pulse" })} />
            <span class="sr-only">{i18n.t("ui.sessionOutputs.running.count", { count: running() })}</span>
          </span>
        </Show>
        <Icon
          name="chevron-down"
          size="small"
          class={`shrink-0 text-ink-muted transition-transform motion-reduce:transition-none ${props.open ? "rotate-180" : ""}`}
        />
      </button>
      <Show when={props.open}>
        <div class="min-h-0 overflow-y-auto border-t border-muted pb-1">
          <Group
            title={i18n.t("ui.sessionOutputs.outputs")}
            count={String(outputs().length)}
            items={outputs()}
            row={(item) =>
              item.type === "design" ? (
                <Row icon="photo" onClick={props.onOpenDesign && (() => props.onOpenDesign?.(item.design.id))}>
                  <span class="min-w-0 flex-1 truncate" dir="auto">
                    {item.design.title}
                  </span>
                  <span class="shrink-0 text-caption text-ink-muted">{i18n.t("ui.sessionOutputs.design")}</span>
                </Row>
              ) : (
                <Row
                  icon={item.file.status === "added" ? "plus-small" : "edit"}
                  title={relative(item.file.path)}
                  onClick={props.onOpenFile && (() => props.onOpenFile?.(item.file.path))}
                >
                  <span class="min-w-0 flex-1 truncate font-mono" dir="ltr">
                    <span class="text-foreground">{getFilename(item.file.path)}</span>
                    <span class="ms-1.5 text-ink-muted">{directoryOf(relative(item.file.path))}</span>
                  </span>
                  <DiffChanges changes={item.file} class="shrink-0" />
                </Row>
              )
            }
          />
          <Group
            title={i18n.t("ui.sessionOutputs.subagents")}
            count={
              running() > 0
                ? i18n.t("ui.sessionOutputs.running.count", { count: running() })
                : String(subagents().length)
            }
            items={subagents()}
            row={(item) => (
              <Row
                onClick={
                  item.sessionID && props.onOpenSession
                    ? () => props.onOpenSession?.(item.sessionID as string)
                    : undefined
                }
                lead={
                  <span class={statusIndicator({ tone: statusTone[item.status] }).root({ class: "w-4 justify-center" })}>
                    <span
                      class={statusIndicator({ tone: statusTone[item.status] }).mark({
                        class: item.status === "running" ? "motion-safe:animate-pulse" : undefined,
                      })}
                    />
                    <span class="sr-only">{i18n.t(statusLabel[item.status])}</span>
                  </span>
                }
              >
                <span class="min-w-0 flex-1 truncate" dir="auto">
                  {item.title}
                </span>
                <Show when={item.agent}>
                  <span class="max-w-[6rem] shrink-0 truncate text-caption text-ink-muted">{item.agent}</span>
                </Show>
              </Row>
            )}
          />
          <Group
            title={i18n.t("ui.sessionOutputs.sources")}
            count={String(sources().length)}
            items={sources()}
            row={(item) => {
              if (item.type === "read")
                return (
                  <Row icon="file-tree">
                    <span class="min-w-0 flex-1 truncate tabular-nums">
                      {i18n.plural("ui.sessionOutputs.filesRead", item.count)}
                    </span>
                  </Row>
                )
              const source = item.source
              if (source.kind === "search")
                return (
                  <Row icon="magnifying-glass" title={source.query}>
                    <span class="min-w-0 flex-1 truncate" dir="auto">
                      {i18n.t("ui.sessionOutputs.search", { query: source.query })}
                    </span>
                    <span
                      class="shrink-0 text-caption tabular-nums"
                      classList={{
                        "text-ink-muted": !source.failed,
                        "text-feedback-danger-foreground": source.failed,
                      }}
                    >
                      {source.failed
                        ? i18n.t("ui.sessionOutputs.failed")
                        : i18n.plural("ui.sessionOutputs.search.results", source.results)}
                    </span>
                  </Row>
                )
              return (
                <Row
                  icon="globe"
                  title={source.url}
                  onClick={props.onOpenUrl && (() => props.onOpenUrl?.(source.url))}
                >
                  <span class="min-w-0 flex-1 truncate" dir="ltr">
                    <span class="text-foreground">{host(source.url)}</span>
                    <span class="text-ink-muted">{pathOf(source.url)}</span>
                  </span>
                  <Show when={source.failed}>
                    <span class="shrink-0 text-caption text-feedback-danger-foreground">
                      {i18n.t("ui.sessionOutputs.failed")}
                    </span>
                  </Show>
                </Row>
              )
            }}
          />
        </div>
      </Show>
    </section>
  )
}

function Group<T>(props: { title: string; count: string; items: T[]; row: (item: T) => JSX.Element }) {
  const i18n = useI18n()
  const [expanded, setExpanded] = createSignal(false)
  const shown = createMemo(() => (expanded() ? props.items : props.items.slice(0, visibleRows)))
  const hidden = () => props.items.length - visibleRows

  return (
    <Show when={props.items.length > 0}>
      <div class="pt-2">
        <h3 class={eyebrow({ class: "m-0 flex h-6 items-center justify-between px-3" })}>
          <span>{props.title}</span>
          <span class="tabular-nums normal-case tracking-normal">{props.count}</span>
        </h3>
        <ul class="m-0 list-none p-0">
          <For each={shown()}>{(item) => <li>{props.row(item)}</li>}</For>
        </ul>
        <Show when={hidden() > 0}>
          <button
            type="button"
            aria-expanded={expanded()}
            class={quietControl({
              ink: "muted",
              focus: "inset",
              class: "flex h-7 w-full items-center px-3 text-caption",
            })}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded() ? i18n.t("ui.common.showLess") : i18n.plural("ui.sessionTurn.changes.showMore", hidden())}
          </button>
        </Show>
      </div>
    </Show>
  )
}

function Row(props: {
  icon?: "photo" | "edit" | "plus-small" | "globe" | "magnifying-glass" | "file-tree"
  lead?: JSX.Element
  title?: string
  onClick?: () => void
  children: JSX.Element
}) {
  const content = () => (
    <>
      <Show when={props.icon} fallback={props.lead}>
        {(icon) => <Icon name={icon()} size="small" class="shrink-0 text-ink-muted" />}
      </Show>
      {props.children}
    </>
  )
  const layout = "flex h-7 w-full min-w-0 items-center gap-2 px-3 text-start"

  return (
    <Show when={props.onClick} fallback={<div class={layout} title={props.title}>{content()}</div>}>
      {(onClick) => (
        <button
          type="button"
          title={props.title}
          class={quietControl({ ink: "foreground", focus: "inset", class: layout })}
          onClick={() => onClick()()}
        >
          {content()}
        </button>
      )}
    </Show>
  )
}

function directoryOf(path: string) {
  const directory = getDirectory(path)
  if (!directory || directory === "." || directory === "/") return ""
  return directory.replace(/\/$/, "")
}

function host(url: string) {
  return URL.canParse(url) ? new URL(url).host : url
}

function pathOf(url: string) {
  if (!URL.canParse(url)) return ""
  const parsed = new URL(url)
  return parsed.pathname === "/" ? "" : parsed.pathname
}
