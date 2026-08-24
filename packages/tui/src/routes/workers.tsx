import { TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import open from "open"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useRedskilled } from "../context/redskilled"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useToast } from "../ui/toast"
import {
  age,
  bar,
  clock,
  formatAge,
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  formatRate,
  fraction,
  number,
  progress,
  sparkline,
  truncate,
} from "./workers/format"
import { empty, rate, record, series, type Activity, type Track, type Worker } from "./workers/history"

type Theme = ReturnType<typeof useTheme>["theme"]
type Status = ReturnType<ReturnType<typeof useRedskilled>["status"]>

/** Heartbeat age at which a Worker stops looking healthy. */
const HEARTBEAT = { warn: 30_000, error: 120_000 }

export function Workers(props: { active?: boolean; width: number }) {
  const redskilled = useRedskilled()
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const renderer = useRenderer()

  const [selectedID, setSelectedID] = createSignal<string>()
  const [focused, setFocused] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  const [history, setHistory] = createSignal(empty())

  const status = redskilled.status
  const payload = () => status()?.payload
  const workers = createMemo(() => payload()?.workers ?? [])
  const innerWidth = () => Math.max(12, props.width - 4)

  const selectable = workers
  const selectedIndex = createMemo(() =>
    Math.max(
      0,
      selectable().findIndex((item) => item.worker_id === selectedID()),
    ),
  )
  const worker = createMemo(() => selectable()[selectedIndex()])
  const track = createMemo<Track | undefined>(() => {
    const current = worker()
    return current ? history().live[current.worker_id] : undefined
  })
  const select = (index: number) => {
    const list = selectable()
    if (!list.length) return
    setSelectedID(list[Math.min(list.length - 1, Math.max(0, index))].worker_id)
  }

  const run = (action: () => Promise<unknown>, message: string) =>
    action()
      .then(() => toast.show({ variant: "success", message }))
      .catch(toast.error)

  const startDrain = () => void run(redskilled.startDrain, "Project drain started")

  const stopWorker = async () => {
    const current = worker()
    if (!current) return
    if (!(await DialogConfirm.show(dialog, "Stop Worker", `Stop ${current.worker_id} now?`))) return
    await run(() => redskilled.stopWorker(current.worker_id), `Stopped ${current.worker_id}`)
  }

  const recycleWorker = async () => {
    const current = worker()
    if (!current) return
    if (!(await DialogConfirm.show(dialog, "Recycle Worker", `Recycle ${current.worker_id} and refill its slot?`)))
      return
    await run(() => redskilled.recycleWorker(current.worker_id), `Recycling ${current.worker_id}`)
  }

  const steerWorker = async () => {
    const current = worker()
    if (!current) return
    const text = await DialogPrompt.show(dialog, `Steer ${current.worker_id}`, {
      placeholder: "What should this Worker do next?",
    })
    if (!text?.trim()) return
    await run(() => redskilled.steerWorker(current.worker_id, text.trim()), `Steer queued for ${current.worker_id}`)
  }

  const openIssue = () => {
    const url = issueURL(worker())
    if (!url) return toast.show({ variant: "info", message: "This Worker has not published an issue yet" })
    open(url).catch(() => toast.show({ variant: "error", message: `Could not open ${url}` }))
  }

  const resize = async () => {
    const value = await DialogPrompt.show(dialog, "Resize project", {
      value: String(status()?.activation?.target ?? 1),
      placeholder: "Worker target",
    })
    if (value === null) return
    const target = Number.parseInt(value, 10)
    if (!Number.isInteger(target) || target < 0)
      return toast.show({ variant: "error", message: "Target must be zero or greater" })
    await run(() => redskilled.resize(target), `Project target set to ${target}`)
  }

  const stopProject = async () => {
    if (!(await DialogConfirm.show(dialog, "Stop project", "Set this Project's redskilled drain intent to stopped?")))
      return
    await run(redskilled.stopProject, "Project drain stopped")
  }

  createEffect(() => redskilled.setActive(props.active !== false))
  onCleanup(() => redskilled.setActive(false))

  // Elapsed time, heartbeat age, and rates keep moving between daemon polls.
  const ticker = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(ticker))

  createEffect(() => {
    const current = payload()
    if (!current) return
    setHistory((previous) => record(previous, current, Date.now()))
  })

  // Keep the cursor on the same Worker; fall back to its position when it disappears.
  let lastIndex = 0
  createEffect(() => {
    const list = selectable()
    const found = list.findIndex((item) => item.worker_id === selectedID())
    if (found >= 0) {
      lastIndex = found
      return
    }
    if (!list.length) return
    setSelectedID(list[Math.min(lastIndex, list.length - 1)].worker_id)
  })

  useBindings(() => ({
    enabled: () => props.active !== false && renderer.currentFocusedEditor === null,
    bindings: [
      { key: "j", desc: "Next Worker", group: "Workers", cmd: () => select(selectedIndex() + 1) },
      { key: "down", desc: "Next Worker", group: "Workers", cmd: () => select(selectedIndex() + 1) },
      { key: "k", desc: "Previous Worker", group: "Workers", cmd: () => select(selectedIndex() - 1) },
      { key: "up", desc: "Previous Worker", group: "Workers", cmd: () => select(selectedIndex() - 1) },
      { key: "g", desc: "First Worker", group: "Workers", cmd: () => select(0) },
      { key: "G", desc: "Last Worker", group: "Workers", cmd: () => select(selectable().length - 1) },
      {
        key: "return",
        desc: "Focus Worker",
        group: "Workers",
        cmd: () => setFocused((value) => !value && !!worker()),
      },
      { key: "s", desc: "Stop Worker", group: "Workers", cmd: () => void stopWorker() },
      { key: "r", desc: "Recycle Worker", group: "Workers", cmd: () => void recycleWorker() },
      { key: "e", desc: "Steer Worker", group: "Workers", cmd: () => void steerWorker() },
      { key: "o", desc: "Open issue", group: "Workers", cmd: openIssue },
      { key: "z", desc: "Resize project", group: "Workers", cmd: () => void resize() },
      { key: "p", desc: "Stop project", group: "Workers", cmd: () => void stopProject() },
      { key: "R", desc: "Refresh now", group: "Workers", cmd: () => void redskilled.refresh() },
    ],
  }))

  return (
      <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
        <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
          <text fg={tone(status()?.lifecycle, theme)} attributes={TextAttributes.BOLD}>
            {mark(status()?.lifecycle)} {status()?.lifecycle ?? "connecting"}
          </text>
          <text fg={workers().some((item) => item.display?.failed) ? theme.error : theme.textMuted}>
            {workers().length} worker{workers().length === 1 ? "" : "s"}
          </text>
        </box>

        <Show when={status()?.activation}>
          {(activation) => (
            <box flexShrink={0}>
              <text fg={theme.text}>{truncate(activation().project, props.width)}</text>
              <text fg={theme.textMuted}>
                {truncate(
                  `${activation().runner} × ${activation().target}${activation().standing ? " standing" : ""}`,
                  props.width,
                )}
              </text>
            </box>
          )}
        </Show>

        <Show when={status()?.error}>
          {(error) => <text fg={theme.warning}>{truncate(error(), props.width)}</text>}
        </Show>

        <Show
          when={workers().length > 0}
          fallback={
            <box flexGrow={1} minHeight={0} border borderColor={theme.border} paddingLeft={1} paddingRight={1}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                No live Workers
              </text>
              <text fg={theme.textMuted}>{truncate(compactIdleReason(status()), innerWidth())}</text>
              <Show when={status()?.lifecycle !== "unavailable" && status()?.lifecycle !== "ineligible"}>
                <box flexDirection="row" gap={1} paddingTop={1}>
                  <text fg={theme.success} onMouseUp={startDrain}>
                    [start]
                  </text>
                  <text fg={theme.info} onMouseUp={() => void resize()}>
                    [z resize]
                  </text>
                </box>
              </Show>
            </box>
          }
        >
          <Show
            when={!focused()}
            fallback={
              <Show when={worker()}>
                {(current) => (
                  <CompactDetail
                    theme={theme}
                    worker={current()}
                    track={track()}
                    now={now()}
                    width={props.width}
                    onBack={() => setFocused(false)}
                    onStop={() => void stopWorker()}
                    onRecycle={() => void recycleWorker()}
                    onSteer={() => void steerWorker()}
                    onOpen={openIssue}
                  />
                )}
              </Show>
            }
          >
            <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ visible: false }}>
              <For each={selectable()}>
                {(row) => (
                  <CompactWorkerRow
                    theme={theme}
                    worker={row}
                    now={now()}
                    width={props.width}
                    selected={row.worker_id === worker()?.worker_id}
                    onSelect={() => {
                      renderer.currentFocusedEditor?.blur()
                      setSelectedID(row.worker_id)
                    }}
                  />
                )}
              </For>
              <Show when={history().departed.length > 0}>
                <text fg={theme.textMuted}>recently ended</text>
                <For each={history().departed}>
                  {(item) => <text fg={theme.textMuted}>{truncate(ended(item, now()), props.width)}</text>}
                </For>
              </Show>
            </scrollbox>
          </Show>
        </Show>

        <text fg={theme.textMuted}>{truncate(compactHints(focused(), workers().length > 0), props.width)}</text>
      </box>
  )
}

function CompactWorkerRow(props: {
  theme: Theme
  worker: Worker
  now: number
  width: number
  selected: boolean
  onSelect: () => void
}) {
  const display = () => props.worker.display
  const heartbeat = () => age(display()?.heartbeat, props.now)
  const inner = () => Math.max(12, props.width - 4)
  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.selected ? props.theme.backgroundElement : undefined}
      onMouseDown={props.onSelect}
    >
      <text fg={display()?.failed ? props.theme.error : props.selected ? props.theme.primary : props.theme.text}>
        {props.selected ? "▶ " : "  "}
        <span style={{ attributes: props.selected ? TextAttributes.BOLD : undefined }}>
          {truncate(props.worker.worker_id, 8)}
        </span>{" "}
        <span style={{ fg: props.theme.textMuted }}>{issue(props.worker)}</span>
      </text>
      <text fg={display()?.failed ? props.theme.error : props.theme.text}>
        {truncate(
          `${display()?.phase ?? display()?.step ?? "starting"} ${progress(display()?.phase_index, display()?.phase_total)}`,
          inner(),
        )}
      </text>
      <text fg={props.theme.textMuted}>
        {truncate(
          `${formatDuration(props.worker.uptime_ms)} · hb ${formatAge(heartbeat())} · ctx ${formatPercent(display()?.context)}`,
          inner(),
        )}
      </text>
    </box>
  )
}

function CompactDetail(props: {
  theme: Theme
  worker: Worker
  track: Track | undefined
  now: number
  width: number
  onBack: () => void
  onStop: () => void
  onRecycle: () => void
  onSteer: () => void
  onOpen: () => void
}) {
  const display = () => props.worker.display
  const heartbeat = () => age(display()?.heartbeat, props.now)
  const activity = () => (props.track?.activity ?? []).slice(-5)
  const inner = () => Math.max(12, props.width - 4)
  return (
    <box flexGrow={1} minHeight={0} border borderColor={props.theme.borderActive} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={display()?.failed ? props.theme.error : props.theme.primary} attributes={TextAttributes.BOLD}>
          {truncate(props.worker.worker_id, 18)}
        </text>
        <text fg={props.theme.textMuted} onMouseUp={props.onBack}>
          [enter]
        </text>
      </box>
      <scrollbox flexGrow={1} minHeight={0} scrollbarOptions={{ visible: false }}>
        <text fg={props.theme.text}>
          {truncate(`${display()?.runner ?? "runner ?"} · ${display()?.model ?? "model ?"}`, inner())}
        </text>
        <text fg={props.theme.text}>
          {truncate(
            `${progress(display()?.phase_index, display()?.phase_total)} ${display()?.phase ?? "starting"}${display()?.step ? ` · ${display()?.step}` : ""}`,
            inner(),
          )}
        </text>
        <text fg={props.theme.textMuted}>
          hb <span style={{ fg: heartbeatTone(heartbeat(), props.theme) }}>{formatAge(heartbeat())}</span> · elapsed{" "}
          {formatDuration(props.worker.uptime_ms)}
        </text>
        <text fg={props.theme.textMuted}>
          tok <span style={{ fg: props.theme.text }}>{formatCount(display()?.tokens)}</span> · tools{" "}
          <span style={{ fg: props.theme.text }}>{formatCount(display()?.tools)}</span>
        </text>
        <text fg={props.theme.textMuted}>
          ctx <span style={{ fg: props.theme.text }}>{formatPercent(display()?.context)}</span> · rss{" "}
          <span style={{ fg: props.theme.text }}>{formatBytes(props.worker.vitals.rss_bytes)}</span>
        </text>
        <text fg={props.theme.textMuted}>
          loc <span style={{ fg: props.theme.diffAdded }}>+{formatCount(display()?.added ?? 0)}</span>
          <span style={{ fg: props.theme.diffRemoved }}> -{formatCount(display()?.removed ?? 0)}</span>
        </text>
        <text fg={props.theme.textMuted}>activity</text>
        <Show when={activity().length > 0} fallback={<text fg={props.theme.textMuted}>waiting for heartbeat…</text>}>
          <For each={activity()}>{(item) => <ActivityLine theme={props.theme} item={item} width={inner()} />}</For>
        </Show>
      </scrollbox>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={props.theme.warning} onMouseUp={props.onStop}>
          [s]
        </text>
        <text fg={props.theme.info} onMouseUp={props.onRecycle}>
          [r]
        </text>
        <text fg={props.theme.primary} onMouseUp={props.onSteer}>
          [e]
        </text>
        <Show when={issueURL(props.worker)}>
          <text fg={props.theme.textMuted} onMouseUp={props.onOpen}>
            [o]
          </text>
        </Show>
      </box>
    </box>
  )
}

function compactIdleReason(status: Status) {
  const message = notice(status)
  if (message) return `${message.title} · ${message.body}`
  const activation = status?.activation
  if (!activation) return "The daemon has not reported a project activation."
  if (activation.target === 0) return "Target is 0. Resize the project to start Workers."
  return `Target ${activation.target}; the queue is drained or waiting for a slot.`
}

function compactHints(focused: boolean, hasWorkers: boolean) {
  if (focused) return "enter back · j/k select · s/r/e/o"
  if (!hasWorkers) return "z resize · p stop · R refresh"
  return "j/k select · enter details · R refresh"
}

function Header(props: {
  theme: Theme
  now: number
  width: number
  status: Status
  loading: boolean
  trackingSince: number | undefined
  onStart: () => void
  onResize: () => void
  onStopProject: () => void
}) {
  const theme = props.theme
  const host = () => props.status?.payload?.host
  const activation = () => props.status?.activation
  const staleness = () => props.status?.payload?.staleness
  const registered = () =>
    !!activation() && !!props.status?.payload?.registered_projects?.includes(activation()!.project)

  const slots = () => {
    const ceiling = number(host()?.ceiling.worker_count)
    const used = host()?.worker_count ?? 0
    const reserved = number(host()?.ceiling.interactive_reservation)
    return {
      ratio: ceiling ? used / ceiling : null,
      text: `${used}/${ceiling ?? "?"}${reserved ? ` (${reserved} reserved)` : ""}`,
      hot: !!ceiling && used >= ceiling,
    }
  }
  const memory = () => {
    const used = number(host()?.observed_rss_bytes)
    const ceiling = number(host()?.ceiling.memory_bytes)
    const ratio = number(host()?.ceiling_used_fraction) ?? (used !== null && ceiling ? used / ceiling : null)
    return { ratio, text: `${formatBytes(used)}/${formatBytes(ceiling)}`, hot: (ratio ?? 0) >= 0.85 }
  }

  /** Only the meters that fit are rendered, so the header stays exactly two lines. */
  const meters = createMemo(() => {
    const item = activation()
    const projected = item?.runner === "ACP"
    const all = [
      { id: "project", label: "", text: item?.project ?? "", ratio: null as number | null, hot: false },
      {
        id: "runner",
        label: "",
        text: projected
          ? "ACP projection"
          : item
            ? `${item.runner} × ${item.target}${item.standing ? " standing" : ""}`
            : "",
        ratio: null,
        hot: false,
      },
      ...(projected
        ? []
        : [
            { id: "slots", label: "slots", text: slots().text, ratio: slots().ratio, hot: slots().hot },
            { id: "mem", label: "mem", text: memory().text, ratio: memory().ratio, hot: memory().hot },
          ]),
    ].filter((entry) => entry.text)
    const budget = props.width - (props.width >= 80 ? 24 : 0)
    let used = 0
    return all.filter((entry) => {
      const size = entry.text.length + (entry.label ? entry.label.length + 1 : 0) + (entry.ratio === null ? 0 : 7) + 2
      if (used + size > budget) return false
      used += size
      return true
    })
  })

  const flags = () => {
    const out: string[] = []
    if (staleness()?.stale) out.push(`stale ${formatAge(number(staleness()?.age_ms))}`)
    const daemon = props.status?.payload?.daemon?.daemon_version
    if (daemon && daemon !== "ACP" && props.width >= 90) out.push(`daemon v${daemon}`)
    const since = props.trackingSince
    if (since && props.width >= 110) out.push(`tracking ${formatAge(props.now - since)}`)
    return out
  }

  const failed = () => props.status?.payload?.workers.filter((item) => item.display?.failed).length ?? 0
  const live = () => props.status?.lifecycle === "live"

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            RedDB Workers
          </text>
          <text fg={tone(props.status?.lifecycle, theme)}>
            {mark(props.status?.lifecycle)} {props.status?.lifecycle ?? "connecting"}
          </text>
          <Show when={live()}>
            <text fg={theme.success} attributes={TextAttributes.BLINK}>
              ●
            </text>
          </Show>
          <Show when={failed() > 0}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              ✗ {failed()} failed
            </text>
          </Show>
          <For each={flags()}>
            {(item) => <text fg={item.startsWith("stale") ? theme.warning : theme.textMuted}>{item}</text>}
          </For>
        </box>
        <box flexDirection="row" gap={1}>
          <Show when={props.width >= 70}>
            <text fg={theme.textMuted}>
              {props.loading ? "⟳ reading" : `⟳ ${formatAge(age(props.status?.payload?.generated_at, props.now))}`}
            </text>
            <text fg={theme.textMuted}>·</text>
          </Show>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            Project
          </text>
        </box>
      </box>

      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={2}>
          <For each={meters()}>
            {(item) => (
              <text fg={item.label ? theme.textMuted : theme.text}>
                {item.label ? `${item.label} ` : ""}
                <Show when={item.ratio !== null}>
                  <span style={{ fg: item.hot ? theme.warning : theme.success }}>{bar(item.ratio, 6)}</span>{" "}
                </Show>
                <span style={{ fg: item.hot ? theme.warning : theme.text }}>{item.text}</span>
              </text>
            )}
          </For>
        </box>
        <Show when={props.width >= 80}>
          <box flexDirection="row" gap={1}>
            <Show when={!registered()}>
              <text fg={theme.success} onMouseUp={props.onStart}>
                [start drain]
              </text>
            </Show>
            <Show when={registered()}>
              <text fg={theme.info} onMouseUp={props.onResize}>
                [z resize]
              </text>
              <text fg={theme.warning} onMouseUp={props.onStopProject}>
                [p stop drain]
              </text>
            </Show>
          </box>
        </Show>
      </box>
    </box>
  )
}

function WorkerRow(props: {
  theme: Theme
  worker: Worker
  now: number
  selected: boolean
  columns: { eta: boolean; heartbeat: boolean; counters: boolean; phase: number }
  onSelect: () => void
}) {
  const theme = props.theme
  const display = () => props.worker.display
  const heartbeat = () => age(display()?.heartbeat, props.now)
  const phase = () => {
    const head = `${display()?.failed ? "✗ " : ""}${display()?.phase ?? display()?.step ?? "starting"}`
    const step = display()?.phase && display()?.step ? ` · ${display()?.step}` : ""
    if (head.length + step.length + 1 <= props.columns.phase) return { head, step }
    return { head: truncate(head, props.columns.phase - 1), step: "" }
  }
  return (
    <box
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.selected ? theme.backgroundElement : undefined}
      onMouseDown={props.onSelect}
    >
      <text width={2} fg={theme.primary}>
        {props.selected ? "▶ " : "  "}
      </text>
      <text
        width={8}
        fg={props.selected ? theme.primary : theme.text}
        attributes={props.selected ? TextAttributes.BOLD : undefined}
      >
        {truncate(props.worker.worker_id, 7)}
      </text>
      <text width={7} fg={theme.text}>
        {issue(props.worker)}
      </text>
      <text width={props.columns.phase} fg={display()?.failed ? theme.error : theme.text}>
        {phase().head}
        <span style={{ fg: theme.textMuted }}>{phase().step}</span>
      </text>
      <text width={11} fg={display()?.failed ? theme.error : theme.success}>
        {bar(fraction(display()?.phase_index, display()?.phase_total), 5)}{" "}
        <span style={{ fg: theme.textMuted }}>{progress(display()?.phase_index, display()?.phase_total)}</span>
      </text>
      <text width={8} fg={theme.textMuted}>
        {formatDuration(props.worker.uptime_ms)}
      </text>
      <Show when={props.columns.eta}>
        <text width={6} fg={theme.textMuted}>
          {formatDuration(seconds(display()?.eta))}
        </text>
      </Show>
      <Show when={props.columns.heartbeat}>
        <text width={5} fg={heartbeatTone(heartbeat(), theme)}>
          {formatAge(heartbeat())}
        </text>
      </Show>
      <Show when={props.columns.counters}>
        <text width={7} fg={theme.textMuted}>
          {formatCount(display()?.tokens)}
        </text>
        <text width={6} fg={theme.textMuted}>
          {formatCount(display()?.tools)}
        </text>
      </Show>
    </box>
  )
}

function Detail(props: {
  theme: Theme
  worker: Worker
  track: Track | undefined
  now: number
  width: number
  rows: number
  focused: boolean
  onBack: () => void
  onStop: () => void
  onRecycle: () => void
  onSteer: () => void
  onOpen: () => void
}) {
  const theme = props.theme
  const display = () => props.worker.display
  const heartbeat = () => age(display()?.heartbeat, props.now)
  const samples = () => props.track?.samples ?? []
  const tokenRate = () => rate(samples(), "tokens", props.now)
  const toolRate = () => rate(samples(), "tools", props.now)
  const sparkWidth = () => Math.min(24, inner() - 9)
  const spark = () =>
    samples().length > 1 && sparkWidth() >= 8
      ? sparkline(series(samples(), "tokens", sparkWidth(), 10_000, props.now), sparkWidth())
      : ""
  const budget = () => number(props.worker.budget.used_fraction)
  const activity = () => (props.track?.activity ?? []).slice(-props.rows)
  /** Columns left inside the border and padding. Every line below is cut to this. */
  const inner = () => Math.max(12, props.width - 4)

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      border
      borderColor={props.focused ? theme.borderActive : theme.border}
      title={` ${props.worker.worker_id} `}
      titleColor={props.focused ? theme.primary : theme.textMuted}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.worker.worker_id}{" "}
          <span style={{ fg: display()?.failed ? theme.error : theme.success }}>
            {display()?.failed ? "✗ failed" : "● running"}
          </span>
          <span style={{ fg: theme.textMuted }}>
            {truncate(
              ` · ${issue(props.worker)} · ${props.worker.project_label} · pid ${props.worker.pid}`,
              Math.max(0, inner() - props.worker.worker_id.length - 10 - (props.focused ? 13 : 0)),
            )}
          </span>
        </text>
        <Show when={props.focused}>
          <text fg={theme.textMuted} onMouseUp={props.onBack}>
            [enter back]
          </text>
        </Show>
      </box>
      <text fg={theme.text}>
        {truncate(
          `${display()?.runner ?? "runner ?"} · ${display()?.model ?? "model ?"} · ${display()?.effort ?? "effort ?"}${
            display()?.origin ? ` · origin ${display()?.origin}` : ""
          }`,
          inner(),
        )}
      </text>
      <text fg={theme.text}>
        <span style={{ fg: theme.textMuted }}>phase </span>
        <span style={{ fg: display()?.failed ? theme.error : theme.success }}>
          {bar(fraction(display()?.phase_index, display()?.phase_total), 10)}
        </span>{" "}
        {truncate(
          `${progress(display()?.phase_index, display()?.phase_total)} ${display()?.phase ?? "starting"}${
            display()?.step ? ` · step ${display()?.step}` : ""
          }`,
          Math.max(4, inner() - 17),
        )}
      </text>
      <text fg={theme.textMuted}>
        heartbeat <span style={{ fg: heartbeatTone(heartbeat(), theme) }}>{formatAge(heartbeat())}</span>
        {truncate(
          ` · elapsed ${formatDuration(props.worker.uptime_ms)} · ETA ${formatDuration(seconds(display()?.eta))}`,
          Math.max(0, inner() - 10 - formatAge(heartbeat()).length),
        )}
      </text>
      <text fg={theme.textMuted}>
        tokens <span style={{ fg: theme.text }}>{formatCount(display()?.tokens)}</span>
        <Show when={tokenRate() !== null}>
          {" "}
          <span style={{ fg: theme.info }}>{formatRate(tokenRate())}</span>
        </Show>{" "}
        · tools <span style={{ fg: theme.text }}>{formatCount(display()?.tools)}</span>
        <Show when={toolRate() !== null}>
          {" "}
          <span style={{ fg: theme.info }}>{formatRate(toolRate())}</span>
        </Show>
      </text>
      <text fg={theme.textMuted}>
        {spark() ? "tok/10s " : ""}
        <span style={{ fg: theme.info }}>{spark()}</span>
      </text>
      <text fg={theme.textMuted}>
        {truncate(
          `ctx ${formatPercent(display()?.context)} · rss ${formatBytes(props.worker.vitals.rss_bytes)}${
            props.worker.vitals.fresh ? "" : " (stale)"
          } · budget `,
          Math.max(0, inner() - 12),
        )}
        <span style={{ fg: (budget() ?? 0) >= 0.85 ? theme.warning : theme.success }}>{bar(budget(), 6)}</span>{" "}
        <span style={{ fg: theme.text }}>{formatPercent(budget())}</span>
      </text>
      <text fg={theme.textMuted}>
        loc <span style={{ fg: theme.diffAdded }}>+{formatCount(display()?.added ?? 0)}</span>
        <span style={{ fg: theme.diffRemoved }}> -{formatCount(display()?.removed ?? 0)}</span>
        {truncate(
          ` · reasoning ${formatCount(display()?.reasoning)} · text ${formatCount(display()?.text)}`,
          Math.max(
            0,
            inner() - 6 - formatCount(display()?.added ?? 0).length - formatCount(display()?.removed ?? 0).length,
          ),
        )}
      </text>
      <text fg={theme.textMuted}>
        {truncate(
          `── activity (${props.track?.activity.length ?? 0})${props.focused ? "" : " · enter to expand"}`,
          inner(),
        )}
      </text>
      <box height={props.rows} flexShrink={0} flexDirection="column">
        <Show
          when={activity().length > 0}
          fallback={<text fg={theme.textMuted}>waiting for the first heartbeat…</text>}
        >
          <For each={activity()}>{(item) => <ActivityLine theme={theme} item={item} width={inner()} />}</For>
        </Show>
      </box>

      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.warning} onMouseUp={props.onStop}>
          {label("s", "stop", inner())}
        </text>
        <text fg={theme.info} onMouseUp={props.onRecycle}>
          {label("r", "recycle", inner())}
        </text>
        <text fg={theme.primary} onMouseUp={props.onSteer}>
          {label("e", "steer", inner())}
        </text>
        <Show when={issueURL(props.worker)}>
          <text fg={theme.textMuted} onMouseUp={props.onOpen}>
            {label("o", "issue", inner())}
          </text>
        </Show>
      </box>
    </box>
  )
}

/** `[s stop]` when the pane is wide enough for the four actions, `[s]` when it is not. */
function label(key: string, name: string, inner: number) {
  return inner >= 40 ? `[${key} ${name}]` : `[${key}]`
}

function ActivityLine(props: { theme: Theme; item: Activity; width: number }) {
  const theme = props.theme
  const color = () => {
    if (props.item.kind === "failed") return theme.error
    if (props.item.kind === "phase") return theme.success
    if (props.item.kind === "start") return theme.info
    if (props.item.kind === "step") return theme.text
    return theme.textMuted
  }
  return (
    <text fg={color()}>
      <span style={{ fg: theme.textMuted }}>{clock(props.item.at)}</span>{" "}
      {truncate(props.item.text, Math.max(4, props.width - 9))}
    </text>
  )
}

function Idle(props: {
  theme: Theme
  now: number
  status: Status
  loading: boolean
  departed: Array<Track & { ended: number }>
  width: number
  onStart: () => void
  onResize: () => void
}) {
  const theme = props.theme
  const activation = () => props.status?.activation
  const registered = () =>
    !!activation() && !!props.status?.payload?.registered_projects?.includes(activation()!.project)
  const lifecycle = () => props.status?.lifecycle
  const reason = () => {
    const item = activation()
    if (!item) return "The daemon has not reported an activation for this project."
    if (item.runner === "ACP")
      return `${registered() ? "Project drain is active" : "Project drain is not active"} · the public ACP snapshot reports no live Workers.`
    if (item.target === 0) return "Target is 0 — press z to size the project up."
    return `Target ${item.target} · ${registered() ? "registered" : "not registered"} · the queue is drained or the daemon has not granted a slot yet.`
  }
  const showStart = () => lifecycle() !== "unavailable" && lifecycle() !== "ineligible" && !registered()
  const showResize = () =>
    lifecycle() !== "unavailable" && lifecycle() !== "ineligible" && activation()?.target === 0
  return (
    <box flexGrow={1} border borderColor={theme.border} paddingLeft={1} paddingRight={1} flexDirection="column">
      <Show when={!props.loading} fallback={<text fg={theme.textMuted}>Reading daemon…</text>}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          No live Workers in this project
        </text>
        <text fg={theme.textMuted}>{truncate(reason(), props.width - 4)}</text>
        <Show when={lifecycle() === "unavailable" || lifecycle() === "ineligible"}>
          <text fg={theme.textMuted}> </text>
          <text fg={theme.warning}>{truncate(props.status?.error ?? "Start the public red-skills-redskilled acp adapter.", props.width - 4)}</text>
        </Show>
        <Show when={showStart() || showResize()}>
          <box flexDirection="row" gap={2} paddingTop={1}>
            <Show when={showStart()}>
              <text fg={theme.success} onMouseUp={props.onStart}>
                [start drain]
              </text>
            </Show>
            <Show when={showResize()}>
              <text fg={theme.info} onMouseUp={props.onResize}>
                [z resize]
              </text>
            </Show>
          </box>
        </Show>
        <Show when={props.departed.length > 0}>
          <text fg={theme.textMuted}> </text>
          <text fg={theme.textMuted}>recently ended</text>
          <For each={props.departed}>
            {(item) => <text fg={theme.textMuted}>{truncate(ended(item, props.now), props.width - 4)}</text>}
          </For>
        </Show>
      </Show>
    </box>
  )
}

function ended(item: Track & { ended: number }, now: number) {
  return `${item.worker.worker_id} · ${issue(item.worker)} · ${item.worker.display?.failed ? "failed · " : ""}${
    item.worker.display?.phase ?? "—"
  } · ended ${formatAge(now - item.ended)} ago after ${formatDuration(item.worker.uptime_ms)}`
}

function hints(focused: boolean, hasWorkers: boolean) {
  if (focused) return "enter back · j/k switch Worker · s stop · r recycle · e steer · o issue · R refresh"
  if (!hasWorkers) return "start drain · z resize · p stop drain · R refresh"
  return "j/k select · enter focus · s stop · r recycle · e steer · o issue · z resize · p stop drain · R refresh"
}

type Notice = {
  title: string
  body: string
  start: boolean
}

function notice(status: Status): Notice | undefined {
  const lifecycle = status?.lifecycle
  if (lifecycle === "unavailable" || lifecycle === "ineligible")
    return {
      title: "RedSkills is unavailable",
      body: status?.error ?? "Start the public red-skills-redskilled acp adapter.",
      start: false,
    }
  const project = status?.activation?.project
  const active = !!project && !!status?.payload?.registered_projects?.includes(project)
  if (project && !active)
    return {
      title: "Project drain is inactive",
      body: "Start the daemon-owned drain explicitly when you want RedSkills to process this Project.",
      start: true,
    }
  return undefined
}

function issue(worker: Worker | undefined) {
  const value = worker?.display?.issue
  if (!value) return "—"
  return value.startsWith("#") ? value : `#${value}`
}

function issueURL(worker: Worker | undefined): string | undefined {
  const value = worker?.display?.issue?.replace(/^#/, "")
  if (!worker || !value || !/^\d+$/.test(value) || !/^[\w.-]+\/[\w.-]+$/.test(worker.project_label)) return undefined
  return `https://github.com/${worker.project_label}/issues/${value}`
}

function seconds(value: unknown) {
  const amount = number(value)
  return amount === null ? null : amount * 1_000
}

function heartbeatTone(ms: number | null, theme: Theme) {
  if (ms === null) return theme.textMuted
  if (ms < HEARTBEAT.warn) return theme.success
  if (ms < HEARTBEAT.error) return theme.warning
  return theme.error
}

function mark(value: string | undefined) {
  if (value === "live") return "●"
  if (value === "degraded" || value === "needs_consent") return "◆"
  return "○"
}

function tone(value: string | undefined, theme: Theme) {
  if (value === "live") return theme.success
  if (value === "degraded" || value === "needs_consent") return theme.warning
  if (value === "unavailable") return theme.error
  return theme.textMuted
}
