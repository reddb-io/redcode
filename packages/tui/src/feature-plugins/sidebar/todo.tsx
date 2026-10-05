import type { DesignFeedbackItem, DesignInfo } from "@opencode/client"
import { SessionTodo } from "@opencode/schema/session-todo"
import { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { errorMessage } from "../../util/error"
import { Locale } from "../../util/locale"

const CLOSED_WINDOW_MS = 15 * 60 * 1000
// An expanded task shows its whole content; the request quote and the proof are only context for
// it, and a request can run to thousands of characters, so they stop after about a dozen lines.
const DETAIL_WIDTH = 480
// The notes of a round the sidebar quotes; the rest are counted, and design_read lists them all.
const ROUND_NOTES = 3
const ELEMENT_WIDTH = 16

export function SidebarTodo(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const dimensions = useTerminalDimensions()
  const [open, setOpen] = createSignal(true)
  const [all, setAll] = createSignal(false)
  const [expanded, setExpanded] = createSignal<string>()
  const [clock, setClock] = createSignal(Date.now())
  const agent = () => props.context.data.session.get(props.sessionID)?.agent ?? "build"
  const [tasks, { refetch }] = createResource(
    () => props.sessionID,
    (sessionID) =>
      props.context.client.session.todo.list({ sessionID }).then(
        (data) => ({ data, error: undefined }),
        (error: unknown) => ({ data: [], error: errorMessage(error) }),
      ),
  )
  // Review notes are the Design agent's checklist; they are polled with the tasks while the session is
  // in Design or still has a design, so a session that never had one pays for a single request.
  const [designs, designList] = createResource(
    () => props.sessionID,
    (sessionID) =>
      props.context.client.session.design.list({ sessionID }).then(
        (data) => ({ data, error: undefined }),
        (error: unknown) => ({ data: [], error: errorMessage(error) }),
      ),
  )
  const timer = setInterval(() => {
    setClock(Date.now())
    if (!tasks.loading) void refetch()
    if (!designs.loading && (agent() === "design" || designs()?.data.length)) void designList.refetch()
  }, 5_000)
  onCleanup(() => clearInterval(timer))
  const visible = createMemo(() =>
    SessionTodo.forAgent(tasks()?.data ?? [], agent()).filter(
      (item) =>
        (item.status !== "completed" && item.status !== "cancelled") ||
        (item.closedAt !== undefined && clock() - item.closedAt < CLOSED_WINDOW_MS),
    ),
  )
  const shown = createMemo(() => (all() ? visible() : visible().slice(0, Math.max(3, dimensions().height - 20))))
  const rounds = createMemo(() => pendingRounds(designs()?.data ?? []))
  const designError = () => (agent() === "design" ? designs()?.error : undefined)

  return (
    <Show when={visible().length > 0 || tasks()?.error || rounds().length > 0 || designError()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => visible().length > 2 && setOpen(!open())}>
          <Show when={visible().length > 2}>
            <text fg={theme.text.action.primary.base}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.text.action.primary.base}>
            <b>Todo · {agent() === "design" ? "Design" : agent() === "plan" ? "Plan / Design" : "Build"}</b>
          </text>
        </box>
        <Show when={tasks()?.error}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            Tasks unavailable: {tasks()?.error}
          </text>
        </Show>
        <Show when={designError()}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            Review notes unavailable: {designError()}
          </text>
        </Show>
        <For each={rounds()}>
          {(round) => (
            <box>
              {/* Wrapped, not cut: the counts are the point of the line and a sidebar row is ~37 cells. */}
              <text wrapMode="word" fg={theme.text.muted}>
                <span style={{ fg: theme.text.base, bold: true }}>
                  {round.design ? `${round.design} · ` : ""}Round {round.number}
                </span>{" "}
                · {round.addressed}/{round.total} addressed · {round.recorded} recorded
              </text>
              <For each={round.left.slice(0, ROUND_NOTES)}>
                {(note) => (
                  <box flexDirection="row" gap={0}>
                    <text flexShrink={0} wrapMode="none" fg={theme.text.muted}>
                      [ ] {element(note.item)}:{" "}
                    </text>
                    <text flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.text.base}>
                      {flat(note.item.text) || "(no text)"}
                    </text>
                  </box>
                )}
              </For>
              <Show when={round.left.length > ROUND_NOTES}>
                <text paddingLeft={4} fg={theme.text.muted}>
                  +{round.left.length - ROUND_NOTES} more without a mark
                </text>
              </Show>
            </box>
          )}
        </For>
        <Show when={visible().length <= 2 || open()}>
          <For each={shown()}>
            {(item) => {
              const key = item.id ?? item.content
              const tone = ["in_progress", "blocked"].includes(item.status)
                ? theme.text.feedback.warning.base
                : theme.text.muted
              // Collapsed, a task takes its title line and at most one reason line, however long the
              // model wrote it; a click shows the full task and what it is checked against.
              return (
                <box onMouseUp={() => setExpanded(expanded() === key ? undefined : key)}>
                  <box flexDirection="row" gap={0}>
                    <text flexShrink={0} fg={tone}>
                      [
                      {item.status === "completed"
                        ? "✓"
                        : item.status === "cancelled"
                          ? "−"
                          : item.status === "in_progress"
                            ? "•"
                            : item.status === "blocked"
                              ? "!"
                              : " "}
                      ]{" "}
                    </text>
                    <text flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" truncate fg={tone}>
                      {SessionTodo.label(item)}
                    </text>
                  </box>
                  <Show
                    when={expanded() === key}
                    fallback={
                      <Show when={item.reason}>
                        {(reason) => (
                          <text paddingLeft={4} wrapMode="none" truncate fg={theme.text.muted}>
                            {SessionTodo.label({ content: reason() })}
                          </text>
                        )}
                      </Show>
                    }
                  >
                    <box paddingLeft={4}>
                      <text wrapMode="word" fg={theme.text.base}>
                        {item.content}
                      </text>
                      <For
                        each={[
                          ["Done when", item.criterion !== item.content ? item.criterion : undefined],
                          ["Reason", item.reason],
                          ["Requested", item.source?.quote],
                          ["Evidence", item.evidence?.explanation],
                        ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))}
                      >
                        {(entry) => (
                          <text wrapMode="word" fg={theme.text.muted}>
                            {entry[0]}: {Locale.truncateWidth(entry[1].trim(), DETAIL_WIDTH)}
                          </text>
                        )}
                      </For>
                    </box>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={visible().length > shown().length}>
            <text fg={theme.text.action.secondary.base} onMouseUp={() => setAll(true)}>
              +{visible().length - shown().length} more
            </text>
          </Show>
        </Show>
      </box>
    </Show>
  )
}

/**
 * Every round of an open review that still has a note without an outcome, newest first, counted as the
 * agent's own design_document results recite it: notes it marked addressed (an outcome keeps the mark),
 * notes with an outcome, and the notes still without either, which are the work left.
 */
function pendingRounds(designs: ReadonlyArray<DesignInfo>) {
  return designs
    .filter((design) => !design.ended)
    .flatMap((design) => {
      const notes = design.notes ?? []
      return [...new Set(notes.filter((note) => note.status === "open").map((note) => note.round))]
        .toSorted((a, b) => b - a)
        .map((number) => {
          const round = notes.filter((note) => note.round === number)
          return {
            design: designs.length > 1 ? design.name : undefined,
            number,
            total: round.length,
            addressed: round.filter((note) => note.addressed).length,
            recorded: round.filter((note) => note.status !== "open").length,
            left: round.filter((note) => note.status === "open" && !note.addressed),
          }
        })
    })
}

/**
 * The element a note is on, at most ELEMENT_WIDTH cells so the user's words keep most of a sidebar row:
 * `button "Save"` from the captured tag and text, else the page's label or the selector.
 */
function element(item: DesignFeedbackItem) {
  const text = flat(item.elementText ?? "")
  if (item.tag && text)
    return `${item.tag} "${Locale.truncateWidth(text, Math.max(6, ELEMENT_WIDTH - item.tag.length - 3))}"`
  return Locale.truncateWidth(flat(item.label || item.target), ELEMENT_WIDTH)
}

const flat = (value: string) => value.replace(/\s+/g, " ").trim()

export default Plugin.define({
  id: "redcode.sidebar.todo",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarTodo context={context} sessionID={props.sessionID} />,
    })
  },
})
