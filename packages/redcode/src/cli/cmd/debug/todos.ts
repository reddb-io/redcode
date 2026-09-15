import { Effect } from "effect"
import { SessionTaskFacts } from "@reddb-io/redcode-core/session/task-facts"
import { SessionTodoStore } from "@reddb-io/redcode-core/session/todo-store"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Todo } from "@/session/todo"
import { effectCmd, fail } from "../../effect-cmd"

export type TodoReport = {
  sessionID: string
  tasks: Array<{
    id: string
    status: string
    priority: string
    content: string
    revision: number | undefined
    source?: { type: string; messageID: string; quote: string; paraphrase?: string }
    criterion?: string
    evidence?: string
    reason?: string
    scopeChange?: { messageID: string; quote: string; paraphrase?: string }
    /** Failed todowrite calls that named this task. */
    refusals: number
  }>
  /** The latest failed todowrite calls, newest first. */
  errors: Array<{ time: string; kind: string; message: string; callID: string }>
}

const ERROR_LIMIT = 20

const firstLine = (text: string) => text.split("\n")[0]?.trim() ?? ""

/** Whether a todowrite input addressed `task`, by id or by its exact content. */
function names(input: unknown, task: { id: string; content: string }) {
  const todos = typeof input === "object" && input !== null ? (input as { todos?: unknown }).todos : undefined
  return (
    Array.isArray(todos) &&
    todos.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        ((item as { id?: unknown }).id === task.id || (item as { content?: unknown }).content === task.content),
    )
  )
}

/** The stored tasks of a session with their provenance, and the todowrite calls that failed. */
export const todoReport = Effect.fn("Cli.debug.todos.report")(function* (sessionID: SessionID) {
  const tasks = yield* Todo.Service.use((todo) => todo.get(sessionID))
  const facts = yield* SessionTaskFacts.Service.use((service) => service.load(sessionID))
  const failed = facts.results
    .filter((result) => result.tool === "todowrite" && result.errored && !result.abandoned)
    .toSorted((a, b) => b.completed - a.completed)
  return {
    sessionID,
    tasks: tasks.map((task) => ({
      id: task.id ?? "",
      status: task.status,
      priority: task.priority,
      content: task.content,
      revision: task.revision,
      ...(task.source
        ? {
            source: {
              type: task.source.type,
              messageID: task.source.id,
              quote: task.source.quote,
              ...(task.source.paraphrase ? { paraphrase: task.source.paraphrase } : {}),
            },
          }
        : {}),
      ...(task.criterion ? { criterion: task.criterion } : {}),
      ...(task.evidence
        ? {
            evidence: `${task.evidence.tool} ${task.evidence.callID} (message ${task.evidence.messageID}): ${firstLine(task.evidence.explanation)}`,
          }
        : {}),
      ...(task.reason ? { reason: task.reason } : {}),
      ...(task.scopeChange
        ? {
            scopeChange: {
              messageID: task.scopeChange.messageID,
              quote: task.scopeChange.quote,
              ...(task.scopeChange.paraphrase ? { paraphrase: task.scopeChange.paraphrase } : {}),
            },
          }
        : {}),
      refusals: failed.filter((result) => names(result.input, { id: task.id ?? "", content: task.content })).length,
    })),
    errors: failed.slice(0, ERROR_LIMIT).map((result) => ({
      time: new Date(result.completed).toISOString(),
      kind: SessionTodoStore.refusalKind(result.error),
      message: firstLine(result.error),
      callID: result.callID,
    })),
  } satisfies TodoReport
})

const clip = (text: string, limit = 200) => {
  const line = text.replaceAll(/\s+/g, " ").trim()
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

export function renderTodoReport(report: TodoReport) {
  const lines = [`session ${report.sessionID}`, "", `tasks (${report.tasks.length})`]
  if (!report.tasks.length) lines.push("  none")
  for (const task of report.tasks) {
    lines.push(`  ${task.id} r${task.revision ?? "?"} [${task.status}] (${task.priority}) ${clip(task.content)}`)
    if (task.source) {
      const text = task.source.paraphrase
        ? `paraphrase "${clip(task.source.paraphrase)}"`
        : `quote "${clip(task.source.quote)}"`
      lines.push(`    source: ${task.source.type} ${task.source.messageID}, ${text}`)
    } else lines.push("    source: none")
    lines.push(`    criterion: ${task.criterion ? clip(task.criterion) : "none"}`)
    lines.push(`    evidence: ${task.evidence ? clip(task.evidence) : "none"}`)
    if (task.reason) lines.push(`    reason: ${clip(task.reason)}`)
    if (task.scopeChange) {
      const text = task.scopeChange.paraphrase
        ? `paraphrase "${clip(task.scopeChange.paraphrase)}"`
        : `quote "${clip(task.scopeChange.quote)}"`
      lines.push(`    scope change: ${task.scopeChange.messageID}, ${text}`)
    }
    lines.push(`    refused attempts: ${task.refusals}`)
  }
  lines.push("", `todowrite errors (latest ${report.errors.length}, max ${ERROR_LIMIT})`)
  if (!report.errors.length) lines.push("  none")
  for (const error of report.errors) lines.push(`  ${error.time} ${error.kind} ${error.callID}: ${clip(error.message)}`)
  return lines.join("\n")
}

export const TodosCommand = effectCmd({
  command: "todos [sessionID]",
  describe: "show a session's tasks, their sources and evidence, and recent todowrite errors",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        type: "string",
        description: "session id (defaults to the most recent session in this directory)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description: "print machine-readable JSON",
      }),
  handler: Effect.fn("Cli.debug.todos")(function* (args) {
    const sessionID = args.sessionID
      ? SessionID.make(args.sessionID)
      : (yield* Session.Service.use((session) => session.list({ directory: process.cwd(), limit: 1 })))[0]?.id
    if (!sessionID) return yield* fail(`No session found in ${process.cwd()}`)
    const report = yield* todoReport(sessionID)
    console.log(args.json ? JSON.stringify(report, null, 2) : renderTodoReport(report))
  }),
})
