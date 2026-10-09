import { Button } from "@opencode/ui/button"
import { disclosure } from "@reddb-io/design-system/contracts/disclosure"
import { quietControl } from "@reddb-io/design-system/contracts/quiet-control"
import { useDialog } from "@opencode/ui/context/dialog"
import { useI18n } from "@opencode/ui/context/i18n"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { Icon } from "@opencode/ui/icon"
import { getDirectory, getFilename } from "@opencode/util/path"
import { For, Show, createMemo, createSignal } from "solid-js"
import { formatElapsed, now } from "../components/clock"
import { useData } from "../context"
import { stepSummary, type FileChange, type LiveActivityKind, type StepCount } from "./turn"

const liveKeys = {
  command: "ui.sessionTurn.live.command",
  edit: "ui.sessionTurn.live.edit",
  read: "ui.sessionTurn.live.read",
  search: "ui.sessionTurn.live.search",
  web: "ui.sessionTurn.live.web",
  agent: "ui.sessionTurn.live.agent",
  skill: "ui.sessionTurn.live.skill",
  other: "ui.sessionTurn.live.other",
  thinking: "ui.sessionTurn.live.thinking",
  writing: "ui.sessionTurn.live.writing",
  working: "ui.sessionTurn.live.working",
} as const satisfies Record<LiveActivityKind, string>

const visibleFiles = 3

/** "Worked for 12m 44s · Ran 3 commands, edited 4 files ⌄": the disclosure over a turn's steps. */
export function TurnHeader(props: {
  open: boolean
  working: boolean
  /** When the prompt was sent, for the running turn's live total. */
  start: number
  /** The finished turn's length; undefined when it never completed. */
  durationMs: number | null | undefined
  counts: StepCount[]
  onToggle: () => void
}) {
  const i18n = useI18n()
  const parts = disclosure()
  const elapsed = () => (props.working ? now() - props.start : (props.durationMs ?? undefined))
  const label = () => {
    const value = elapsed()
    if (value === undefined) return i18n.t(props.open ? "ui.sessionTurn.steps.hide" : "ui.sessionTurn.steps.show")
    return i18n.t(props.working ? "ui.sessionTurn.working" : "ui.sessionTurn.worked", {
      duration: formatElapsed(value, i18n),
    })
  }
  const summary = createMemo(() => (props.counts.length > 0 ? stepSummary(props.counts, i18n) : ""))
  return (
    <button
      type="button"
      data-component="turn-summary"
      aria-expanded={props.open}
      class={quietControl({
        ink: "muted",
        class: parts.trigger({
          class:
            "inline-flex h-7 w-fit max-w-full min-w-0 items-center justify-start gap-2 rounded-md px-2 -ms-2 font-mono text-[13px] leading-text-compact",
        }),
      })}
      onClick={() => props.onToggle()}
    >
      <span data-slot="turn-summary-duration" class="shrink-0 font-medium text-foreground tabular-nums">
        {label()}
      </span>
      <Show when={summary()}>
        <span aria-hidden="true" class="shrink-0 text-ink-muted">
          ·
        </span>
        <span data-slot="turn-summary-steps" class="min-w-0 truncate text-ink-muted">
          {summary()}
        </span>
      </Show>
      <Icon name="chevron-down" size="small" class={parts.indicator({ class: "ml-0 shrink-0" })} />
    </button>
  )
}

/** "Edited 4 files +195 −32": what a finished turn changed, with a way to review or undo it. */
export function TurnChangesCard(props: {
  files: FileChange[]
  onView?: (files: string[]) => void
  onUndo?: () => Promise<void> | void
}) {
  const i18n = useI18n()
  const data = useData()
  const dialog = useDialog()
  const [expanded, setExpanded] = createSignal(false)
  const shown = createMemo(() => (expanded() ? props.files : props.files.slice(0, visibleFiles)))
  const hidden = () => props.files.length - visibleFiles
  const totals = createMemo(() => ({
    additions: props.files.reduce((total, file) => total + file.additions, 0),
    deletions: props.files.reduce((total, file) => total + file.deletions, 0),
  }))
  const relative = (path: string) => {
    const directory = data.directory
    if (!directory || directory === "/" || !path.startsWith(directory)) return path
    return path.slice(directory.length).replace(/^[\\/]/, "")
  }
  const confirmUndo = () =>
    dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={i18n.t("ui.sessionTurn.changes.undoTitle")}
            description={i18n.t("ui.sessionTurn.changes.undoDescription")}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {i18n.t("ui.common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              dialog.close()
              void props.onUndo?.()
            }}
          >
            {i18n.t("ui.sessionTurn.changes.undoConfirm")}
          </Button>
        </DialogFooter>
      </Dialog>
    ))
  return (
    <section
      data-component="turn-changes"
      aria-label={i18n.t("ui.sessionTurn.changes.label")}
      class="mt-3 w-full max-w-[72ch] overflow-hidden rounded-lg border border-muted bg-background font-sans text-[13px]"
    >
      <header class="flex min-h-9 items-center gap-2 border-b border-muted px-3 py-1.5">
        <Icon name="edit" size="small" class="shrink-0 text-ink-muted" />
        <h3 class="min-w-0 truncate text-[13px] font-medium leading-text-compact text-foreground">
          {i18n.plural("ui.sessionTurn.changes.edited", props.files.length)}
        </h3>
        <span
          class="contents"
          aria-label={i18n.t("ui.sessionTurn.changes.lines", {
            additions: totals().additions,
            deletions: totals().deletions,
          })}
        >
          <DiffChanges changes={totals()} />
        </span>
        <div class="ms-auto flex shrink-0 items-center gap-1">
          <Show when={props.onView}>
            {(view) => (
              <Button
                size="small"
                variant="ghost"
                icon="review"
                onClick={() => view()(props.files.map((file) => file.path))}
              >
                {i18n.t("ui.sessionTurn.changes.view")}
              </Button>
            )}
          </Show>
          <Show when={props.onUndo}>
            <Button size="small" variant="ghost" icon="reset" onClick={confirmUndo}>
              {i18n.t("ui.sessionTurn.changes.undo")}
            </Button>
          </Show>
        </div>
      </header>
      <ul class="m-0 list-none p-0 py-1">
        <For each={shown()}>
          {(file) => (
            <li class="flex h-7 min-w-0 items-center gap-2 px-3 font-mono text-[13px] leading-text-compact">
              <span class="min-w-0 flex-1 truncate" dir="ltr" title={relative(file.path)}>
                <span class="text-ink-muted">{directoryPrefix(relative(file.path))}</span>
                <span class="text-foreground">{getFilename(file.path)}</span>
              </span>
              <DiffChanges changes={file} class="shrink-0" />
            </li>
          )}
        </For>
      </ul>
      <Show when={hidden() > 0}>
        <button
          type="button"
          aria-expanded={expanded()}
          class={quietControl({
            ink: "muted",
            focus: "inset",
            class: "flex h-7 w-full items-center border-t border-muted px-3 text-[13px] leading-text-compact",
          })}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded() ? i18n.t("ui.common.showLess") : i18n.plural("ui.sessionTurn.changes.showMore", hidden())}
        </button>
      </Show>
    </section>
  )
}

/** "Running a command · 4m 50s": the running turn's current activity under the timeline. */
export function LiveTurnStatus(props: { kind: LiveActivityKind; since: number }) {
  const i18n = useI18n()
  return (
    <div
      data-component="session-working"
      role="status"
      class="flex min-w-0 items-center gap-2 font-mono text-[13px] leading-text-compact text-ink-muted"
    >
      <span data-slot="session-working-pulse" aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-foreground" />
      <span class="min-w-0 truncate font-medium text-foreground">{i18n.t(liveKeys[props.kind])}</span>
      <span aria-hidden="true" class="shrink-0 tabular-nums">
        {formatElapsed(now() - props.since, i18n)}
      </span>
    </div>
  )
}

function directoryPrefix(path: string) {
  const directory = getDirectory(path)
  if (!directory || directory === "." || directory === "/") return ""
  return directory.endsWith("/") ? directory : `${directory}/`
}
