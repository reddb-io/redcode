import type { Plugin } from "@opencode/plugin/tui"
import type { MonitorPublicInfo } from "@opencode/client"
import { Monitor } from "@opencode/schema/monitor"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { createSignal, onCleanup, Show } from "solid-js"
import { ComposerContext, type ComposerTab } from "../../../routes/session/composer/context"
import {
  createSessionMonitors,
  MonitorsIndicator,
  MonitorsTab,
  type MonitorApi,
} from "../../../routes/session/composer/monitors-tab"
import { ComposerFooter } from "../../../routes/session/composer/footer"
import { runningMonitors } from "../../../routes/session/composer/monitors-model"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

type Kind = { command: string; options: MonitorPublicInfo["options"]; output: string }

// Each new monitor takes the next shape, so the rows cover shell polls, native probes and a noisy build.
const KINDS: Kind[] = [
  {
    command: "gh run view 8812 --json status,conclusion",
    options: { mode: "poll", interval_ms: 30_000, deadline_ms: 1_800_000, success_contains: "completed" },
    output: '{"status":"queued"}\n{"status":"in_progress"}',
  },
  {
    command: "probe: GET https://staging.example.com/health",
    options: { mode: "poll", interval_ms: 5_000, deadline_ms: 300_000 },
    output: "HTTP 503 Service Unavailable",
  },
  {
    command: 'probe: process "vite build" (command line) exited',
    options: { mode: "poll", interval_ms: 2_000, deadline_ms: 45_000 },
    output: "1 matching process, pid 48121",
  },
  {
    command: "bun run build --filter @opencode/tui",
    options: { mode: "once", deadline_ms: 900_000 },
    output: Array.from({ length: 40 }, (_, index) => `[${index + 1}/40] bundling chunk-${index}.js`).join("\n"),
  },
]
const OUTPUTS = ["plain", "noisy", "ansi"] as const

function fixture(index: number, input: Partial<MonitorPublicInfo> = {}): MonitorPublicInfo {
  const kind = KINDS[index % KINDS.length]
  return {
    id: `mon_story_${index}`,
    sessionID: "ses_story_monitors",
    command: kind.command,
    workdir: "/Users/kit/code/opencode",
    options: kind.options,
    status: "running",
    created: Date.now(),
    updated: Date.now(),
    attempts: 1,
    delivery: "pending",
    evidence: { exit: 1, output: kind.output, truncated: false },
    ...input,
  }
}

function showcase() {
  const now = Date.now()
  return [
    fixture(1, { id: "mon_story_health", created: now - 20_000, attempts: 4 }),
    fixture(0, {
      id: "mon_story_ci",
      status: "succeeded",
      delivery: "delivered",
      created: now - 600_000,
      updated: now - 120_000,
      attempts: 9,
      evidence: {
        exit: 0,
        output: '{"status":"completed","conclusion":"success"}',
        truncated: false,
        matched: 'exit code 0, output contains "completed"',
      },
    }),
    fixture(2, {
      id: "mon_story_vite",
      status: "timed_out",
      delivery: "delivered",
      created: now - 900_000,
      updated: now - 855_000,
      attempts: 22,
    }),
    fixture(3, {
      id: "mon_story_build",
      status: "failed",
      delivery: "delivered",
      created: now - 1_200_000,
      updated: now - 1_100_000,
      attempts: 1,
      error: "Command exited with code 1\nerror TS2322: Type 'string' is not assignable to type 'number'.",
    }),
  ]
}

function MonitorsTabStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [items, setItems] = createSignal(showcase())
  const [visible, setVisible] = createSignal(true)
  const [failing, setFailing] = createSignal(false)
  const [next, setNext] = createSignal(10)
  const [output, setOutput] = createSignal(0)
  const [tab, setTab] = createSignal<ComposerTab>()
  const [message, setMessage] = createSignal("n starts a monitor; s/x/t settle the oldest running one")

  // Everything the tab does goes through this fixture API: nothing leaves the story.
  const api: MonitorApi = {
    list: () =>
      failing() ? Promise.reject(new Error("fixture server unavailable")) : Promise.resolve(structuredClone(items())),
    cancel: (input) => {
      setItems((list) =>
        list.map(
          (info): MonitorPublicInfo =>
            info.id === input.monitorID
              ? { ...info, status: "cancelled", delivery: "suppressed", updated: Date.now() }
              : info,
        ),
      )
      setMessage(`cancelled ${input.monitorID}`)
      return Promise.resolve(structuredClone(items().find((info) => info.id === input.monitorID)!))
    },
  }
  const monitors = createSessionMonitors({
    sessionID: () => "ses_story_monitors",
    onOpen: () => setVisible(true),
    api,
  })
  const update = (list: MonitorPublicInfo[], event: string) => {
    setItems(list)
    setMessage(event)
    monitors.refresh()
  }

  const start = () => {
    const index = next()
    setNext(index + 1)
    update([...items(), fixture(index)], `started ${KINDS[index % KINDS.length].command}`)
  }

  const progress = () => {
    const target = items()
      .filter((info) => info.status === "running")
      .toSorted((a, b) => b.created - a.created)[0]
    if (!target) {
      setMessage("no running monitor; press n to start one")
      return
    }
    const attempts = target.attempts + 1
    const result = `Check ${attempts}: waiting for readiness`
    update(
      items().map((info) =>
        info.id !== target.id
          ? info
          : {
              ...info,
              attempts,
              updated: Date.now(),
              evidence: {
                exit: null,
                output:
                  OUTPUTS[output()] === "noisy"
                    ? `${Array.from({ length: 600 }, (_, index) => `probe output line ${index}`).join("\n")}\n${result}`.slice(
                        -Monitor.EVIDENCE_CHARS,
                      )
                    : OUTPUTS[output()] === "ansi"
                      ? `\u001b[31m${result}\u001b[0m\u0000`
                      : result,
                truncated: OUTPUTS[output()] === "noisy",
              },
            },
      ),
      `${OUTPUTS[output()]} progress in the existing summary; enter expands its bounded evidence`,
    )
  }

  const settle = (status: "succeeded" | "failed" | "timed_out") => {
    const target = items()
      .filter((info) => info.status === "running")
      .toSorted((a, b) => a.created - b.created)[0]
    if (!target) {
      setMessage("no running monitor; press n to start one")
      return
    }
    update(
      items().map(
        (info): MonitorPublicInfo =>
          info.id !== target.id
            ? info
            : {
                ...info,
                status,
                delivery: "delivered",
                updated: Date.now(),
                attempts: info.attempts + 1,
                ...(status === "succeeded"
                  ? {
                      evidence: {
                        exit: 0,
                        output: "ok",
                        truncated: false,
                        matched: 'exit code 0, output contains "ok"',
                      },
                    }
                  : {}),
                ...(status === "failed" ? { error: 'output contains failure_contains "error"' } : {}),
              },
      ),
      `${target.command} ${status}${visible() ? " while the tab is visible (no toast)" : " while hidden (toast)"}`,
    )
  }

  const reset = () => {
    setFailing(false)
    setVisible(true)
    setNext(10)
    setOutput(0)
    update(showcase(), "reset to the showcase fixture")
  }

  onCleanup(props.context.keymap.mode.push("composer"))
  props.context.keymap.layer(() => ({
    mode: "composer",
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "n", title: "Start a monitor", group: "Storybook", run: start },
      { bind: "p", title: "Advance running probe evidence", group: "Storybook", run: progress },
      {
        bind: "b",
        title: "Cycle progress output style",
        group: "Storybook",
        run: () => {
          setOutput((value) => (value + 1) % OUTPUTS.length)
          setMessage(`${OUTPUTS[output()]} progress; press p to update the newest running monitor`)
        },
      },
      { bind: "s", title: "Oldest running monitor succeeds", group: "Storybook", run: () => settle("succeeded") },
      { bind: "x", title: "Oldest running monitor fails", group: "Storybook", run: () => settle("failed") },
      { bind: "t", title: "Oldest running monitor times out", group: "Storybook", run: () => settle("timed_out") },
      {
        bind: "v",
        title: "Show or hide the Monitors tab",
        group: "Storybook",
        run: () => {
          setVisible((value) => !value)
          setMessage(visible() ? "tab visible: finishes stay quiet" : "tab hidden: finishes toast")
        },
      },
      {
        bind: "e",
        title: "Toggle list failure",
        group: "Storybook",
        run: () => {
          setFailing((value) => !value)
          setMessage(failing() ? "reads fail; the error shows once the list is empty" : "reads succeed")
          monitors.refresh()
        },
      },
      { bind: "0", title: "Clear all monitors", group: "Storybook", run: () => update([], "no monitors") },
      { bind: "z", title: "Reset", group: "Storybook", run: reset },
    ],
  }))

  const composer = {
    register(value: ComposerTab) {
      setTab(value)
      return () => setTab(undefined)
    },
    active: (id: string) => visible() && id === "monitors",
    close: () => setVisible(false),
  }

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.base}
    >
      <box flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
        <text fg={theme.text.base}>{"> Ship the staging deploy and tell me when CI is green"}</text>
        <box height={1} />
        <text fg={theme.text.muted}>● Started monitors for CI and the staging health endpoint.</text>
      </box>
      <ComposerContext.Provider value={composer}>
        <Show when={visible()}>
          <box
            flexShrink={0}
            backgroundColor={theme.background.raised.base}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            gap={1}
          >
            <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
              {tab()?.label ?? ""}
            </text>
            <MonitorsTab monitors={monitors} />
            <ComposerFooter hints={tab()?.hints?.() ?? []} />
          </box>
        </Show>
      </ComposerContext.Provider>
      <box flexShrink={0} flexDirection="row" gap={2} paddingLeft={3} paddingRight={2}>
        <text fg={theme.text.muted} flexGrow={1} wrapMode="none" truncate>
          ~/code/opencode
        </text>
        <MonitorsIndicator monitors={monitors} onOpen={() => setVisible(true)} />
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / monitors tab"
        details={[
          visible() ? "tab visible" : "tab hidden",
          `${runningMonitors(items())} running`,
          `${items().length} total`,
          failing() ? "reads failing" : "reads ok",
          `${OUTPUTS[output()]} progress`,
        ]}
        message={message()}
        controls={[
          { shortcut: "↑/↓", label: "select" },
          { shortcut: "enter", label: "evidence" },
          { shortcut: "ctrl+d", label: "stop" },
          { shortcut: "r", label: "refresh" },
          { shortcut: "n", label: "start" },
          { shortcut: "p", label: "progress" },
          { shortcut: "b", label: "plain/noisy/ANSI" },
          { shortcut: "s/x/t", label: "succeed/fail/time out" },
          { shortcut: "v", label: "show/hide tab" },
          { shortcut: "e", label: "read failure" },
          { shortcut: "0", label: "empty" },
          { shortcut: "z", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const monitorsTabStory: Story = {
  id: "monitors-tab",
  title: "Monitors tab",
  render: (context) => <MonitorsTabStory context={context} />,
}
