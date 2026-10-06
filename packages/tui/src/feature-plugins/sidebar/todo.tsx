import type { DesignFeedbackItem, DesignInfo } from "@opencode/client"
import { SessionTodo } from "@opencode/schema/session-todo"
import { Plugin } from "@opencode/plugin/tui"
import { designRoundSummary, outcomeTally } from "@opencode/util/design-round-summary"
import type { RGBA } from "@opentui/core"
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
  const [tasksOpen, setTasksOpen] = createSignal(false)
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
  // A revision's number (R7) is its position in the design's revision list, which is read again only when the
  // design publishes a new revision, not on every poll.
  const [revisions] = createResource(
    () =>
      (designs()?.data ?? [])
        .filter((design) => !design.ended && design.revision && design.rounds?.length)
        .map((design) => `${design.id}:${design.revision}`)
        .join(" "),
    (key) =>
      Promise.all(
        key.split(" ").map((entry) => {
          const designID = entry.slice(0, entry.indexOf(":"))
          // Only the ids are kept; an unreachable list leaves the ordinal unknown.
          return props.context.client.session.design
            .revisions({ sessionID: props.sessionID, designID })
            .then(
              (list) => list.map((revision) => ({ id: revision.id })),
              () => [],
            )
            .then((list) => [designID, list] as const)
        }),
      ).then((entries) => new Map(entries)),
  )
  const reviews = createMemo(() => designReviews(designs()?.data ?? [], revisions.latest))
  // While a review has rounds to show, the Design tasks (setup, approval, anti-slop) fold into one line.
  const folded = createMemo(() =>
    reviews().length ? visible().filter((item) => (item.phase ?? "build") === "design") : [],
  )
  const listed = createMemo(() =>
    folded().length && !tasksOpen() ? visible().filter((item) => (item.phase ?? "build") !== "design") : visible(),
  )
  const shown = createMemo(() => (all() ? listed() : listed().slice(0, Math.max(3, dimensions().height - 20))))
  const designError = () => (agent() === "design" ? designs()?.error : undefined)

  return (
    <Show when={visible().length > 0 || tasks()?.error || reviews().length > 0 || designError()}>
      <box>
        <Show when={designError()}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            Review notes unavailable: {designError()}
          </text>
        </Show>
        <For each={reviews()}>
          {(review) => (
            <box>
              <text wrapMode="word" fg={theme.text.muted}>
                <span style={{ fg: theme.text.base, bold: true }}>
                  Design review{review.name ? ` · ${review.name}` : ""}
                </span>
                {review.summary.revision?.ordinal ? ` · R${review.summary.revision.ordinal}` : ""}
                {review.summary.endRequested ? " · ending after this round" : ""}
              </text>
              <For each={review.summary.pending}>
                {(round) => {
                  const left = round.notes.filter((note) => note.status === "open" && !note.addressed)
                  return (
                    <box>
                      {/* Wrapped, not cut: the counts are the point of the line and a sidebar row is ~37 cells. */}
                      <text wrapMode="word" fg={theme.text.muted}>
                        <span style={{ fg: theme.text.base, bold: true }}>Round {round.number}</span> ·{" "}
                        {round.addressed}/{round.total} addressed · {round.recorded} recorded
                      </text>
                      <For each={left.slice(0, ROUND_NOTES)}>
                        {(note) => (
                          <NoteRow mark="[ ]" tone={theme.text.muted} base={theme.text.base} item={note.item} />
                        )}
                      </For>
                      <Show when={left.length > ROUND_NOTES}>
                        <text paddingLeft={4} fg={theme.text.muted}>
                          +{left.length - ROUND_NOTES} more without a mark
                        </text>
                      </Show>
                    </box>
                  )
                }}
              </For>
              {/* The newest round once every note has an outcome: one line of tallies, then what stayed open. */}
              <Show when={review.summary.answered}>
                {(round) => {
                  const kept = () =>
                    round().notes.filter((note) => note.status === "partial" || note.status === "unresolved")
                  return (
                    <box>
                      <text wrapMode="word" fg={theme.text.muted}>
                        <span style={{ fg: theme.text.base, bold: true }}>Round {round().number}</span> ·{" "}
                        {outcomeTally(round())}
                      </text>
                      <For each={kept().slice(0, ROUND_NOTES)}>
                        {(note) => (
                          <NoteRow
                            mark={note.status === "partial" ? "[~]" : "[✗]"}
                            tone={
                              note.status === "partial"
                                ? theme.text.feedback.warning.base
                                : theme.text.feedback.error.base
                            }
                            base={theme.text.base}
                            item={note.item}
                          />
                        )}
                      </For>
                      <Show when={kept().length > ROUND_NOTES}>
                        <text paddingLeft={4} fg={theme.text.muted}>
                          +{kept().length - ROUND_NOTES} more partial or unresolved
                        </text>
                      </Show>
                    </box>
                  )
                }}
              </Show>
            </box>
          )}
        </For>
        <Show when={visible().length > 0 || tasks()?.error}>
          <box flexDirection="row" gap={1} onMouseDown={() => listed().length > 2 && setOpen(!open())}>
            <Show when={listed().length > 2}>
              <text fg={theme.text.action.primary.base}>{open() ? "▼" : "▶"}</text>
            </Show>
            <text fg={theme.text.action.primary.base}>
              <b>Todo · {agent() === "design" ? "Design" : agent() === "plan" ? "Plan / Design" : "Build"}</b>
            </text>
          </box>
        </Show>
        <Show when={tasks()?.error}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            Tasks unavailable: {tasks()?.error}
          </text>
        </Show>
        <Show when={folded().length}>
          <text wrapMode="word" fg={theme.text.action.secondary.base} onMouseUp={() => setTasksOpen(!tasksOpen())}>
            {tasksOpen() ? "▼" : "▶"} Design tasks · {taskTally(folded())}
          </text>
        </Show>
        <Show when={listed().length <= 2 || open()}>
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
          <Show when={listed().length > shown().length}>
            <text fg={theme.text.action.secondary.base} onMouseUp={() => setAll(true)}>
              +{listed().length - shown().length} more
            </text>
          </Show>
        </Show>
      </box>
    </Show>
  )
}

/**
 * The open reviews worth a block: those with a round that still has a note without an outcome (the work left,
 * counted as the agent's own design_document results recite it) or whose newest round is answered, so its
 * partial and unresolved outcomes stay in sight. Each review names its design when the session has several.
 */
function designReviews(
  designs: ReadonlyArray<DesignInfo>,
  revisions: ReadonlyMap<string, ReadonlyArray<{ readonly id: string }>> | undefined,
) {
  return designs
    .filter((design) => !design.ended)
    .map((design) => ({
      name: designs.length > 1 ? design.name : undefined,
      summary: designRoundSummary(design, revisions?.get(design.id)),
    }))
    .filter((review) => review.summary.pending.length > 0 || review.summary.answered)
}

/** How the folded Design tasks stand: `1 in progress · 2 open · 3 done`, zero counts left out. */
function taskTally(items: ReadonlyArray<{ readonly status: string }>) {
  return (
    [
      ["in progress", items.filter((item) => item.status === "in_progress").length],
      ["blocked", items.filter((item) => item.status === "blocked").length],
      ["open", items.filter((item) => item.status === "pending").length],
      ["done", items.filter((item) => item.status === "completed").length],
    ] as const
  )
    .filter((entry) => entry[1] > 0)
    .map((entry) => `${entry[1]} ${entry[0]}`)
    .join(" · ")
}

/** One note of a round on one row: its mark, the element held to a few cells, then the user's words cut to fit. */
function NoteRow(props: { mark: string; tone: RGBA; base: RGBA; item: DesignFeedbackItem }) {
  return (
    <box flexDirection="row" gap={0}>
      <text flexShrink={0} wrapMode="none" fg={props.tone}>
        {props.mark} {element(props.item)}:{" "}
      </text>
      <text flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" truncate fg={props.base}>
        {flat(props.item.text) || "(no text)"}
      </text>
    </box>
  )
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
