import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { diffLines } from "diff"
import type { UiI18n, UiI18nPluralKey } from "@opencode/ui/context/i18n"
import { currentToolFailed, currentToolInput, currentToolMetadata } from "../message/current-tool-state"
import { TimelineRow } from "./timeline-row"

/** What a step did, in the order a turn summary lists them. */
export const stepKinds = ["command", "edit", "read", "search", "web", "agent", "skill", "other"] as const
export type StepKind = (typeof stepKinds)[number]
export type StepCount = { kind: StepKind; count: number; failed: number }
export type LiveActivityKind = StepKind | "thinking" | "writing" | "working"
export type FileChange = {
  path: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

type TurnRowInput = {
  /** Whether a turn's steps show; the caller resolves the default. */
  open: (userMessageID: string) => boolean
  /** Whether an assistant row is reply text rather than a step. */
  answer: (row: TimelineRow.AssistantPart) => boolean
  working: (userMessageID: string) => boolean
  edited: (userMessageID: string) => boolean
}

const stepKeys = {
  command: ["ui.sessionTurn.steps.command", "ui.sessionTurn.steps.commandFailed"],
  edit: ["ui.sessionTurn.steps.edit", "ui.sessionTurn.steps.editFailed"],
  read: ["ui.sessionTurn.steps.read", "ui.sessionTurn.steps.readFailed"],
  search: ["ui.sessionTurn.steps.search", "ui.sessionTurn.steps.searchFailed"],
  web: ["ui.sessionTurn.steps.web", "ui.sessionTurn.steps.webFailed"],
  agent: ["ui.sessionTurn.steps.agent", "ui.sessionTurn.steps.agentFailed"],
  skill: ["ui.sessionTurn.steps.skill", "ui.sessionTurn.steps.skillFailed"],
  other: ["ui.sessionTurn.steps.other", "ui.sessionTurn.steps.otherFailed"],
} as const satisfies Record<StepKind, readonly [UiI18nPluralKey, UiI18nPluralKey]>

/**
 * "Ran 3 commands (1 failed), edited 4 files, searched code": one phrase per kind, joined as
 * a localized list. Phrases are written to continue a sentence, so the first is capitalized.
 */
export function stepSummary(counts: StepCount[], i18n: Pick<UiI18n, "plural" | "list">) {
  const text = i18n.list(
    counts.map((item) =>
      i18n.plural(stepKeys[item.kind][item.failed > 0 ? 1 : 0], item.count, { failed: item.failed }),
    ),
  )
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

export function stepKind(name: string): StepKind | undefined {
  if (name === "shell" || name === "execute" || name === "bash") return "command"
  if (name === "edit" || name === "write" || name === "patch" || name === "apply_patch" || name === "multiedit")
    return "edit"
  if (name === "read") return "read"
  if (name === "grep" || name === "glob" || name === "list" || name === "codesearch") return "search"
  if (name === "websearch" || name === "webfetch") return "web"
  if (name === "subagent" || name === "task") return "agent"
  if (name === "skill") return "skill"
  // Bookkeeping tools are not work a person scans a turn for.
  if (name === "todowrite" || name === "todoread" || name === "question") return undefined
  return "other"
}

/**
 * Per-kind step counts for a run of tools. Edits and reads count distinct files, the
 * rest count calls; `commands` adds shell runs that are not tool calls (user `!` shells).
 */
export function countSteps(tools: SessionMessageAssistantTool[], commands = 0): StepCount[] {
  const kinds = new Map<StepKind, { calls: number; failed: number; files: Set<string> }>()
  const entry = (kind: StepKind) => {
    const existing = kinds.get(kind)
    if (existing) return existing
    const created = { calls: 0, failed: 0, files: new Set<string>() }
    kinds.set(kind, created)
    return created
  }
  tools.forEach((tool) => {
    const kind = stepKind(tool.name)
    if (!kind) return
    const current = entry(kind)
    current.calls += 1
    if (currentToolFailed(tool)) current.failed += 1
    if (kind !== "edit" && kind !== "read") return
    const paths = toolPaths(tool)
    if (paths.length === 0) current.files.add(`tool:${tool.id}`)
    paths.forEach((path) => current.files.add(path))
  })
  if (commands > 0) entry("command").calls += commands
  return stepKinds.flatMap((kind) => {
    const current = kinds.get(kind)
    if (!current) return []
    return [
      { kind, count: kind === "edit" || kind === "read" ? current.files.size : current.calls, failed: current.failed },
    ]
  })
}

/** Files a set of tools changed, summed per path and ordered by the size of the change. */
export function editedFiles(tools: SessionMessageAssistantTool[]): FileChange[] {
  const files = new Map<string, FileChange & { order: number }>()
  tools.forEach((tool) => {
    if (tool.state.status !== "completed" || stepKind(tool.name) !== "edit") return
    toolChanges(tool).forEach((change) => {
      const existing = files.get(change.path)
      if (!existing) {
        files.set(change.path, { ...change, order: files.size })
        return
      }
      existing.additions += change.additions
      existing.deletions += change.deletions
      // A file the turn created stays "added" through later edits; a deletion is final.
      if (change.status === "deleted") existing.status = "deleted"
      if (change.status === "added" && existing.status === "deleted") existing.status = "modified"
    })
  })
  return [...files.values()]
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || a.order - b.order)
    .map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions, status: file.status }))
}

/** Whether any completed tool in these messages edited a file, without computing diffs. */
export function turnEdited(messages: SessionMessageAssistant[]) {
  return messages.some((message) =>
    message.content.some(
      (content) => content.type === "tool" && content.state.status === "completed" && stepKind(content.name) === "edit",
    ),
  )
}

export function turnTools(messages: SessionMessageAssistant[]) {
  return messages.flatMap((message) =>
    message.content.filter((content): content is SessionMessageAssistantTool => content.type === "tool"),
  )
}

/** What the agent is doing right now and since when, for the live status line. */
export function liveActivity(
  messages: SessionMessageAssistant[],
  fallback: number,
): { kind: LiveActivityKind; since: number } {
  const contents = messages.flatMap((message) => message.content)
  const running = contents.findLast(
    (content): content is SessionMessageAssistantTool =>
      content.type === "tool" && (content.state.status === "running" || content.state.status === "streaming"),
  )
  if (running)
    return {
      kind: stepKind(running.name) ?? "other",
      since: running.time.ran ?? running.time.created,
    }
  const last = messages.at(-1)
  const content = last && last.time.completed === undefined ? last.content.at(-1) : undefined
  if (last && content?.type === "reasoning" && content.time?.completed === undefined)
    return { kind: "thinking", since: content.time?.created ?? last.time.created }
  if (last && content?.type === "text" && content.text.trim()) return { kind: "writing", since: last.time.created }
  const ended = Math.max(
    fallback,
    ...messages.map((message) => message.time.completed ?? message.time.created),
    ...contents.flatMap((content) => (content.type === "tool" ? [completedAt(content)] : [])),
  )
  return { kind: "working", since: ended }
}

/**
 * Adds each turn's summary and changes rows, and drops the steps of closed turns. Steps are
 * every row between the prompt and the reply text that ends the turn; errors, retries and
 * interruption markers stay visible because a closed turn must still say how it ended.
 */
export function projectTurnRows(rows: TimelineRow.TimelineRow[], input: TurnRowInput) {
  const runs = rows.reduce<TimelineRow.TimelineRow[][]>((result, row) => {
    const previous = result.at(-1)
    if (previous && previous[0]!.userMessageID === row.userMessageID) previous.push(row)
    if (!previous || previous[0]!.userMessageID !== row.userMessageID) result.push([row])
    return result
  }, [])
  // Keys of the step rows an open turn shows, so they can hang off the turn's header.
  const steps = new Set<string>()
  const projected = runs.flatMap((run) => {
    const id = run[0]!.userMessageID
    const user = run.findIndex((row) => row._tag === "UserMessage")
    if (user < 0) return run
    const indexes = stepIndexes(run, user, input.answer)
    const changes = !input.working(id) && input.edited(id) ? [new TimelineRow.TurnChanges({ userMessageID: id })] : []
    if (indexes.size === 0) return [...run, ...changes]
    const open = input.open(id)
    if (open) indexes.forEach((index) => steps.add(TimelineRow.key(run[index]!)))
    return [
      ...run.slice(0, user + 1),
      new TimelineRow.TurnSummary({ userMessageID: id }),
      ...run.slice(user + 1).filter((_, index) => open || !indexes.has(index + user + 1)),
      ...changes,
    ]
  })
  return { rows: projected, steps }
}

function stepIndexes(run: TimelineRow.TimelineRow[], user: number, answer: TurnRowInput["answer"]) {
  const candidates = run.flatMap((row, index) =>
    index > user && row._tag !== "Error" && row._tag !== "Retry" && row._tag !== "TurnDivider" ? [index] : [],
  )
  const reply = (index: number) => {
    const row = run[index]!
    return row._tag === "AssistantPart" && answer(row)
  }
  // The reply is the last run of text; notices that land after it are steps like the rest.
  const last = candidates.findLastIndex(reply)
  const first = last < 0 ? 0 : candidates.slice(0, last + 1).findLastIndex((index) => !reply(index)) + 1
  return new Set(candidates.filter((_, position) => last < 0 || position < first || position > last))
}

function completedAt(tool: SessionMessageAssistantTool) {
  return tool.time.completed ?? tool.time.ran ?? tool.time.created
}

function toolPaths(tool: SessionMessageAssistantTool) {
  const files = currentToolMetadata(tool).files
  const fromMetadata = Array.isArray(files)
    ? files.flatMap((file) => (record(file) && typeof file.file === "string" ? [file.file] : []))
    : []
  if (fromMetadata.length > 0) return fromMetadata
  const input = currentToolInput(tool)
  const path = typeof input.path === "string" ? input.path : input.filePath
  return typeof path === "string" && path ? [path] : []
}

// The same per-tool math the file-change group renders: recorded diff metadata first, then
// the edit's own strings, then a written file's line count.
function toolChanges(tool: SessionMessageAssistantTool): FileChange[] {
  const files = currentToolMetadata(tool).files
  if (Array.isArray(files) && files.length > 0)
    return files.flatMap((file) => {
      if (!record(file) || typeof file.file !== "string") return []
      const additions = typeof file.additions === "number" ? file.additions : 0
      const deletions = typeof file.deletions === "number" ? file.deletions : 0
      if (additions === 0 && deletions === 0 && file.status !== "added" && file.status !== "deleted") return []
      return [
        {
          path: file.file,
          additions,
          deletions,
          status: file.status === "added" || file.status === "deleted" ? file.status : "modified",
        },
      ]
    })
  const input = currentToolInput(tool)
  const path = typeof input.path === "string" ? input.path : input.filePath
  if (typeof path !== "string" || !path) return []
  if (typeof input.oldString === "string" && typeof input.newString === "string") {
    const changes = diffLines(input.oldString, input.newString)
    const additions = changes.filter((change) => change.added).reduce((total, change) => total + (change.count ?? 0), 0)
    const deletions = changes
      .filter((change) => change.removed)
      .reduce((total, change) => total + (change.count ?? 0), 0)
    if (additions === 0 && deletions === 0) return []
    return [{ path, additions, deletions, status: "modified" }]
  }
  if (tool.name !== "write" || typeof input.content !== "string" || !input.content) return []
  return [
    {
      path,
      additions: input.content.split("\n").length - Number(input.content.endsWith("\n")),
      deletions: 0,
      status: "modified",
    },
  ]
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
