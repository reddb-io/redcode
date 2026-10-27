import type { Database } from "bun:sqlite"
import { Harness } from "@opencode/schema/harness"
import { Schema } from "effect"
import { z } from "zod"
import type { Frame } from "./harness-wire"

const ClaudeTask = z.object({
  type: z.literal("system"),
  subtype: z.enum(["task_started", "task_progress", "task_notification"]),
  session_id: z.string().optional(),
  task_id: z.string().min(1),
  task_type: z.string().optional(),
  tool_use_id: z.string().optional(),
  parent_task_id: z.string().optional(),
  description: z.string().optional(),
  summary: z.string().optional(),
  output_file: z.string().optional(),
  status: z.string().optional(),
})
const ClaudeTools = z.object({
  type: z.literal("assistant"),
  session_id: z.string().optional(),
  message: z.object({
    content: z.array(z.object({ type: z.string(), id: z.string().optional(), name: z.string().optional() })),
  }),
})
const CodexTask = z.object({
  method: z.enum(["item/started", "item/completed"]),
  params: z.object({
    threadId: z.string(),
    item: z.object({
      type: z.literal("commandExecution"),
      id: z.string().min(1),
      command: z.string(),
      status: z.string(),
      processId: z.string().nullish(),
      aggregatedOutput: z.string().nullish(),
    }),
  }),
})
const CodexOutput = z.object({
  method: z.literal("item/commandExecution/outputDelta"),
  params: z.object({ threadId: z.string(), itemId: z.string(), delta: z.string() }),
})

/** Native lifecycle projections, scoped to an explicitly owned harness run. No commands or output files are opened. */
export function createHarnessTasks(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS native_task (run TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run,id));
    CREATE TABLE IF NOT EXISTS native_task_launch (run TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(run,id));
  `)
  const listeners = new Map<string, Set<() => void>>()
  const list = (run: string) =>
    db
      .query<{ data: string }, [string]>("SELECT data FROM native_task WHERE run=? ORDER BY rowid DESC")
      .all(run)
      .map((row) => Schema.decodeUnknownSync(Schema.fromJsonString(Harness.Task))(row.data))
  const read = (run: string, id: string) => {
    const row = db
      .query<{ data: string }, [string, string]>("SELECT data FROM native_task WHERE run=? AND id=?")
      .get(run, id)
    return row ? Schema.decodeUnknownSync(Schema.fromJsonString(Harness.Task))(row.data) : undefined
  }
  const write = (run: string, task: Harness.Task) => {
    db.query(
      "INSERT INTO native_task(run,id,data) VALUES (?,?,?) ON CONFLICT(run,id) DO UPDATE SET data=excluded.data",
    ).run(run, task.id, JSON.stringify(task))
    listeners.get(JSON.stringify([run, task.id]))?.forEach((listener) => listener())
  }
  const kind = (run: string, toolUseID?: string, nativeType?: string): Harness.Task["kind"] => {
    const tool = toolUseID
      ? db
          .query<{ name: string }, [string, string]>("SELECT name FROM native_task_launch WHERE run=? AND id=?")
          .get(run, toolUseID)?.name
      : undefined
    if (tool === "Monitor") return "monitor"
    if (nativeType === "local_bash") return "command"
    if (nativeType && ["local_agent", "remote_agent", "in_process_teammate", "local_workflow"].includes(nativeType))
      return "agent"
    return "unknown"
  }
  const unavailable = (run: string) =>
    list(run)
      .filter((task) => task.status === "running" || task.wait?.state === "waiting")
      .forEach((task) =>
        write(run, {
          ...task,
          status: task.status === "running" ? "unknown" : task.status,
          updatedAt: Date.now(),
          ...(task.wait?.state === "waiting"
            ? { wait: { ...task.wait, state: "unavailable", endedAt: Date.now() } }
            : {}),
        }),
      )
  return {
    list,
    unavailable,
    wait(run: string, taskID: string, timeoutMs: number, signal: AbortSignal) {
      const task = read(run, taskID)
      if (!task || !["monitor", "command"].includes(task.kind))
        throw new Error("Choose a recorded Monitor or command task from this harness run")
      const wait: Harness.TaskWait = {
        id: crypto.randomUUID(),
        state: "waiting",
        startedAt: Date.now(),
        deadlineAt: Date.now() + timeoutMs,
      }
      write(run, { ...task, wait })
      return new Promise<{ state: Exclude<Harness.TaskWait["state"], "waiting">; task: Harness.Task }>((resolve) => {
        const key = JSON.stringify([run, taskID])
        const watchers = listeners.get(key) ?? new Set<() => void>()
        const finish = (state: Exclude<Harness.TaskWait["state"], "waiting">) => {
          clearTimeout(timer)
          signal.removeEventListener("abort", cancel)
          watchers.delete(observe)
          if (!watchers.size) listeners.delete(key)
          const current = read(run, taskID) ?? task
          const result =
            current.wait?.id === wait.id ? { ...current, wait: { ...wait, state, endedAt: Date.now() } } : current
          if (current.wait?.id === wait.id) write(run, result)
          resolve({ state, task: result })
        }
        const cancel = () => finish("cancelled")
        const observe = () => {
          const current = read(run, taskID)
          if (!current || current.status === "unknown") return finish("unavailable")
          if (current.status !== "running") finish("settled")
        }
        const timer = setTimeout(() => finish("timed_out"), timeoutMs)
        watchers.add(observe)
        listeners.set(key, watchers)
        signal.addEventListener("abort", cancel, { once: true })
        if (signal.aborted) return cancel()
        observe()
      })
    },
    observe(run: Harness.Run, frame: Frame) {
      if (run.driver === "claude") {
        const tools = ClaudeTools.safeParse(frame)
        if (tools.success && (!tools.data.session_id || !run.nativeID || tools.data.session_id === run.nativeID)) {
          tools.data.message.content.forEach((block) => {
            if (block.type !== "tool_use" || !block.id || block.name !== "Monitor") return
            db.query("INSERT OR REPLACE INTO native_task_launch VALUES (?,?,?)").run(run.id, block.id, "Monitor")
            // Native tasks can arrive before the assistant frame that identifies their launching tool.
            list(run.id)
              .filter((task) => task.toolUseID === block.id)
              .forEach((task) => write(run.id, { ...task, kind: "monitor" }))
          })
          return
        }
        const parsed = ClaudeTask.safeParse(frame)
        if (!parsed.success || (parsed.data.session_id && run.nativeID && parsed.data.session_id !== run.nativeID))
          return
        const value = parsed.data
        const previous = read(run.id, value.task_id)
        if (value.subtype === "task_progress" && previous && !["running", "unknown"].includes(previous.status)) return
        const status =
          value.subtype !== "task_notification"
            ? "running"
            : value.status === "completed"
              ? "succeeded"
              : value.status === "failed"
                ? "failed"
                : value.status === "stopped"
                  ? "cancelled"
                  : "unknown"
        const output = value.summary ?? previous?.output ?? ""
        const nativeType = value.task_type ?? previous?.nativeType
        const toolUseID = value.tool_use_id ?? previous?.toolUseID
        write(run.id, {
          id: value.task_id,
          kind: kind(run.id, toolUseID, nativeType),
          status,
          nativeType,
          toolUseID,
          parentTaskID: value.parent_task_id ?? previous?.parentTaskID,
          title: (value.description ?? previous?.title ?? value.task_id).slice(0, 2000),
          output: output.slice(-64000),
          outputFile: value.output_file ?? previous?.outputFile,
          truncated: output.length > 64000 || (previous?.truncated ?? false),
          updatedAt: Date.now(),
          wait: previous?.wait,
        })
        return
      }
      const parsed = CodexTask.safeParse(frame)
      if (parsed.success && parsed.data.params.threadId === run.nativeID) {
        const item = parsed.data.params.item
        const previous = read(run.id, item.id)
        const status =
          item.status === "completed"
            ? "succeeded"
            : item.status === "failed"
              ? "failed"
              : item.status === "declined"
                ? "cancelled"
                : item.status === "inProgress"
                  ? "running"
                  : "unknown"
        if (status === "running" && previous && !["running", "unknown"].includes(previous.status)) return
        const output = item.aggregatedOutput ?? previous?.output ?? ""
        write(run.id, {
          id: item.id,
          kind: "command",
          nativeType: "commandExecution",
          status,
          title: item.command.slice(0, 2000),
          processID: item.processId ?? previous?.processID,
          output: output.slice(-64000),
          truncated: output.length > 64000 || (previous?.truncated ?? false),
          updatedAt: Date.now(),
          wait: previous?.wait,
        })
        return
      }
      const delta = CodexOutput.safeParse(frame)
      if (!delta.success || delta.data.params.threadId !== run.nativeID) return
      const previous = read(run.id, delta.data.params.itemId)
      if (!previous || !["running", "unknown"].includes(previous.status)) return
      const output = previous.output + delta.data.params.delta
      write(run.id, {
        ...previous,
        output: output.slice(-64000),
        truncated: previous.truncated || output.length > 64000,
        updatedAt: Date.now(),
      })
    },
  }
}
