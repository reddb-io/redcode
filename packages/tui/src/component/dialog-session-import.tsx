import { createSignal, Match, onCleanup, onMount, Switch } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { OpenCodeClient, SessionImportSourceInfo, SessionImportSummary } from "@opencode/client"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { truncateFilePath } from "../ui/file-path"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { useTuiPaths } from "../context/runtime"
import { abbreviateHome } from "../util/path-format"
import { Locale } from "../util/locale"
import { errorMessage } from "../util/error"
import { Spinner } from "./spinner"

/** The server's foreign session import API, or a fixture of it in stories and tests. */
export type SessionImportApi = OpenCodeClient["session"]["foreign"]

/**
 * Imports a session from another coding agent: pick one of the sources the server reports, then
 * one of its sessions. Sources come from the server, so a new adapter appears without changes here.
 */
export function DialogSessionImport(props: {
  api: SessionImportApi
  /** The folder whose sessions are listed first; the toggle lists every folder. */
  directory: string
  onOpen: (sessionID: string) => void
}) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const lifetime = new AbortController()
  onCleanup(() => lifetime.abort())
  // Undefined while the server detects the sources.
  const [sources, setSources] = createSignal<{ data: SessionImportSourceInfo[]; error?: string }>()
  props.api.sources({ signal: lifetime.signal }).then(
    (data) => !lifetime.signal.aborted && setSources({ data: [...data] }),
    (error: unknown) => !lifetime.signal.aborted && setSources({ data: [], error: errorMessage(error) }),
  )
  const [source, setSource] = createSignal<SessionImportSourceInfo>()
  onMount(() => dialog.setSize("large"))

  // A static root: the dialog host re-runs a reactive root, which would remount this dialog on each step.
  return (
    <box>
      <Switch>
        <Match when={source()}>
          {(selected) => (
            <ImportSessions
              api={props.api}
              source={selected()}
              directory={props.directory}
              onBack={() => setSource(undefined)}
              onOpen={(sessionID) => {
                props.onOpen(sessionID)
                dialog.clear()
              }}
              notify={toast.show}
            />
          )}
        </Match>
        <Match when={true}>
          <DialogSelect
            title="Import session"
            placeholder="Search sources"
            options={(sources()?.data ?? []).map((item) => ({
              title: item.name,
              value: item.source,
              titleView: item.available ? undefined : (
                <span style={{ fg: theme.text.formfield.disabled }}>{item.name}</span>
              ),
              footer: item.available ? count(item.sessions, "session") : "unavailable",
              details: item.warning ? [item.warning] : undefined,
              detailsColor: theme.text.feedback.warning.base,
              detailsWrap: true,
            }))}
            focusTarget={sources()?.data.find((item) => item.available)?.source}
            focusCurrent={true}
            emptyView={
              <box paddingLeft={4} paddingRight={4}>
                <text fg={sources()?.error ? theme.text.feedback.error.base : theme.text.muted}>
                  {sources() ? (sources()?.error ?? "No import sources available") : "Detecting coding agents…"}
                </text>
              </box>
            }
            onSelect={(option) => {
              const item = sources()?.data.find((candidate) => candidate.source === option.value)
              if (!item) return
              if (!item.available)
                return toast.show({
                  variant: "warning",
                  message: item.warning ?? `${item.name} has no session history on this machine`,
                })
              setSource(item)
            }}
          />
        </Match>
      </Switch>
    </box>
  )
}

function ImportSessions(props: {
  api: SessionImportApi
  source: SessionImportSourceInfo
  directory: string
  onBack: () => void
  onOpen: (sessionID: string) => void
  notify: ReturnType<typeof useToast>["show"]
}) {
  const theme = useTheme().surface("dialog")
  const paths = useTuiPaths()
  const lifetime = new AbortController()
  const listing = { request: new AbortController() }
  onCleanup(() => {
    lifetime.abort()
    listing.request.abort()
  })
  const [importing, setImporting] = createSignal<SessionImportSummary>()
  const [failure, setFailure] = createSignal<{ ref: string; message: string; relocate: boolean }>()
  // `data` and `error` are undefined while the sessions of the current scope load.
  const [sessions, setSessions] = createSignal<{ all: boolean; data?: SessionImportSummary[]; error?: string }>({
    all: false,
  })
  const all = () => sessions().all
  const list = () => sessions().data ?? []
  const load = (all: boolean) => {
    listing.request.abort()
    const request = new AbortController()
    listing.request = request
    setFailure(undefined)
    setSessions({ all })
    props.api
      .list(
        { source: props.source.source, directory: all ? undefined : props.directory, limit: 100 },
        { signal: request.signal },
      )
      .then(
        // A reply for a scope the user already left is stale.
        (data) => !request.signal.aborted && setSessions({ all, data: [...data] }),
        (error: unknown) => !request.signal.aborted && setSessions({ all, data: [], error: errorMessage(error) }),
      )
  }
  load(false)
  const folder = () => truncateFilePath(abbreviateHome(props.directory, paths.home), 40)

  const run = (summary: SessionImportSummary) => {
    if (importing()) return
    const previous = failure()
    const relocate = previous?.ref === summary.ref && previous.relocate
    setFailure(undefined)
    setImporting(summary)
    props.api
      .import(
        {
          source: summary.source,
          ref: summary.ref,
          ...(relocate ? { location: { directory: props.directory } } : {}),
        },
        { signal: lifetime.signal },
      )
      .then(
        (result) => {
          if (lifetime.signal.aborted) return
          const subagents = result.sessions.length - 1
          props.notify({
            variant: result.warnings.length > 0 ? "warning" : "success",
            message:
              `Imported "${summary.title}" from ${props.source.name}` +
              (subagents > 0 ? ` with ${count(subagents, "subagent session")}` : "") +
              (result.warnings.length > 0 ? ` (${count(result.warnings.length, "warning")})` : ""),
          })
          props.onOpen(result.session.id)
        },
        (error: unknown) => {
          if (lifetime.signal.aborted) return
          const existing = existingSession(error)
          if (existing) {
            props.notify({ variant: "info", message: `"${summary.title}" was already imported; opened it` })
            props.onOpen(existing)
            return
          }
          setFailure({
            ref: summary.ref,
            message: errorMessage(error),
            relocate: error instanceof Error && error.name === "LocationNotFoundError",
          })
        },
      )
      .finally(() => {
        if (!lifetime.signal.aborted) setImporting(undefined)
      })
  }

  return (
    <DialogSelect
      title={`Import from ${props.source.name}`}
      titleView={
        <box flexDirection="row">
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            Import from {props.source.name}
          </text>
          <text fg={theme.text.muted}> {all() ? "· all folders" : `· ${folder()}`}</text>
        </box>
      }
      placeholder="Search by title or folder"
      locked={importing() !== undefined}
      options={list().map((summary) => ({
        title: summary.title,
        value: summary.ref,
        searchText: summary.directory,
        footer: Locale.relative(summary.time.updated),
        details: [
          [
            `${summary.estimated ? "~" : ""}${count(summary.messages, "message")}`,
            ...(summary.subagents > 0 ? [count(summary.subagents, "subagent")] : []),
            ...(summary.model ? [summary.model] : []),
            truncateFilePath(abbreviateHome(summary.directory, paths.home), 32),
          ].join(" · "),
        ],
      }))}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <Switch>
            <Match when={!sessions().data}>
              <text fg={theme.text.muted}>Loading {props.source.name} sessions…</text>
            </Match>
            <Match when={sessions().error}>
              {(message) => <text fg={theme.text.feedback.error.base}>{message()}</text>}
            </Match>
            <Match when={all()}>
              <text fg={theme.text.muted}>No {props.source.name} sessions found</text>
            </Match>
            <Match when={true}>
              <text fg={theme.text.muted}>
                No {props.source.name} sessions in this folder — <span style={{ fg: theme.text.base }}>ctrl+a</span>{" "}
                show all folders
              </text>
            </Match>
          </Switch>
        </box>
      }
      noMatchView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.muted}>
            No matching sessions
            {all() ? "" : " in this folder — ctrl+a searches all folders"}
          </text>
        </box>
      }
      footer={
        <Switch>
          <Match when={importing()}>
            {(summary) => (
              <box flexDirection="row" gap={1}>
                <Spinner color={theme.text.muted} />
                <text fg={theme.text.muted}>Importing "{Locale.truncate(summary().title, 40)}"…</text>
              </box>
            )}
          </Match>
          <Match when={failure()}>
            {(value) => (
              <text fg={theme.text.feedback.error.base} wrapMode="word">
                {value().message}
                {value().relocate ? ` Press enter to import it into ${folder()}.` : ""}
              </text>
            )}
          </Match>
        </Switch>
      }
      bindings={[
        {
          bind: "ctrl+a",
          title: all() ? "Show sessions in this folder" : "Show sessions in all folders",
          group: "Dialog",
          run: () => load(!all()),
        },
      ]}
      footerHints={[{ title: all() ? "this folder" : "all folders", label: "ctrl+a", side: "right" }]}
      onCancel={props.onBack}
      onSelect={(option) => {
        const summary = list().find((item) => item.ref === option.value)
        if (summary) run(summary)
      }}
    />
  )
}

function count(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`
}

/** The session a conflict names when the server reports the session as already imported. */
function existingSession(error: unknown) {
  if (!(error instanceof Error) || error.name !== "ConflictError" || !("resource" in error)) return
  return typeof error.resource === "string" ? error.resource : undefined
}
