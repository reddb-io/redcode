import type { Plugin } from "@opencode/plugin/tui"
import type { SessionImportSourceInfo, SessionImportSummary } from "@opencode/client"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { createSignal, onMount } from "solid-js"
import { DialogSessionImport, type SessionImportApi } from "../../../component/dialog-session-import"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const directory = "/Users/kit/code/open-source/opencode"

const scenarios = {
  many: "many sessions",
  empty: "empty folder",
  conflict: "already imported",
  failure: "import fails",
  unavailable: "no sources",
} as const

type Scenario = keyof typeof scenarios

const sources = (scenario: Scenario): SessionImportSourceInfo[] => [
  {
    source: "claude-code",
    name: "Claude Code",
    available: scenario !== "unavailable",
    sessions: scenario === "unavailable" ? 0 : 48,
    ...(scenario === "unavailable" ? { warning: "No Claude Code history found in ~/.claude/projects" } : {}),
  },
  {
    source: "opencode",
    name: "OpenCode",
    available: false,
    sessions: 0,
    warning: "OpenCode's database could not be opened: it is locked by another process",
  },
]

const titles = [
  "Fix the flaky session tabs test",
  "Port the diff viewer to the new theme tokens",
  "Investigate slow startup on Windows",
  "Add a Codex adapter for session import",
  "Refactor the inbox projection",
  "Explain the compaction retry policy",
  "Draft release notes for 0.75",
  "Remove the legacy keybind map",
]

const folders = [directory, `${directory}/packages/tui`, "/Users/kit/code/reddb/design-system", "/tmp/scratch"]

const fixtureSessions = (scenario: Scenario, all: boolean): SessionImportSummary[] => {
  if (scenario === "empty" && !all) return []
  const now = Date.now()
  return Array.from({ length: 36 }, (_, index) => ({
    source: "claude-code" as const,
    ref: `fixture-${index}`,
    title:
      titles[index % titles.length] + (index >= titles.length ? ` (${Math.floor(index / titles.length) + 1})` : ""),
    directory: folders[index % folders.length],
    messages: 6 + ((index * 37) % 400),
    ...(index % 5 === 0 ? { estimated: true } : {}),
    subagents: index % 3,
    ...(index % 4 === 3 ? {} : { model: index % 2 ? "anthropic/claude-opus-4-5" : "anthropic/claude-sonnet-4-5" }),
    time: { created: now - (index + 2) * 5_400_000, updated: now - index * 4_100_000 - 30_000 },
  })).filter((session) => all || session.directory === directory)
}

function SessionImportStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [scenario, setScenario] = createSignal<Scenario>("many")
  const [status, setStatus] = createSignal("Press o to open the import dialog")

  // Every call stays in the story: nothing reaches a server or a foreign session store.
  const api: SessionImportApi = {
    sources: () => delay(sources(scenario())),
    list: (input) => delay(fixtureSessions(scenario(), input.directory === undefined)),
    import: (input) => {
      if (scenario() === "conflict")
        return delay(undefined).then(() => {
          throw Object.assign(new Error(`Session already imported: ses_${input.ref}`), {
            name: "ConflictError",
            resource: `ses_${input.ref}`,
          })
        })
      if (scenario() === "failure" && !input.location)
        return delay(undefined).then(() => {
          throw Object.assign(
            new Error(
              `The session's directory no longer exists: ${directory}/old-worktree. Pass a location to import it elsewhere.`,
            ),
            { name: "LocationNotFoundError" },
          )
        })
      // Slow enough to show the importing state; the imported session exists only in this reply.
      return delay(
        {
          session: {
            id: `ses_${input.ref}`,
            agent: "build",
            title: "Imported fixture",
            location: { directory: input.location?.directory ?? directory },
            projectID: "fixture-project",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: Date.now(), updated: Date.now() },
          },
          sessions: [`ses_${input.ref}`, `ses_${input.ref}_subagent`],
          warnings: [],
        },
        900,
      )
    },
  }

  const open = () =>
    props.context.ui.dialog.show(() => (
      <DialogSessionImport api={api} directory={directory} onOpen={(sessionID) => setStatus(`Opened ${sessionID}`)} />
    ))
  const pick = (next: Scenario) => {
    setScenario(next)
    setStatus(`Scenario: ${scenarios[next]}`)
  }
  onMount(open)

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "o,return", title: "Open import dialog", group: "Storybook", run: open },
      ...(Object.keys(scenarios) as Scenario[]).map((key, index) => ({
        bind: String(index + 1),
        title: `Scenario: ${scenarios[key]}`,
        group: "Storybook",
        run: () => pick(key),
      })),
      {
        bind: "r",
        title: "Reset story",
        group: "Storybook",
        run: () => {
          pick("many")
          setStatus("Press o to open the import dialog")
        },
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.base}>
      <box paddingLeft={2} paddingRight={2} paddingTop={1} flexGrow={1}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          Import a session from another coding agent
        </text>
        <text fg={theme.text.muted}>{directory}</text>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / session import"
        details={[scenarios[scenario()]]}
        status={status()}
        controls={[
          { shortcut: "o", label: "open" },
          ...(Object.keys(scenarios) as Scenario[]).map((key, index) => ({
            shortcut: String(index + 1),
            label: scenarios[key],
          })),
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

/** Resolves like a server reply, late enough to show the loading and importing states. */
function delay<T>(value: T, ms = 250) {
  return new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))
}

export const sessionImportStory: Story = {
  id: "session-import",
  title: "Session import",
  render: (context) => <SessionImportStory context={context} />,
}
