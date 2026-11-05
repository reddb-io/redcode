import type { Harness } from "@opencode/schema/harness"
import { z } from "zod"
import type { createHarnessTasks } from "./harness-tasks"
import type { Frame } from "./harness-wire"

const WaitInput = z
  .object({ taskID: z.string().min(1), timeoutMs: z.number().int().min(1000).max(30000).optional() })
  .strict()
const CodexCall = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.literal("item/tool/call"),
  params: z.object({
    threadId: z.string(),
    turnId: z.string(),
    callId: z.string(),
    tool: z.enum(["redcode_background_wait", "redcode_delegate_task", "redcode_task_status", "redcode_task_cancel"]),
    namespace: z.null().optional(),
    arguments: z.json(),
  }),
})
const ClaudeCall = z.object({
  type: z.literal("control_request"),
  request_id: z.string(),
  request: z.object({
    subtype: z.literal("mcp_message"),
    server_name: z.enum(["redcode_wait", "redcode"]),
    message: z.object({
      jsonrpc: z.literal("2.0"),
      id: z.union([z.string(), z.number()]).optional(),
      method: z.string(),
      params: z.record(z.string(), z.json()).optional(),
    }),
  }),
})

export const backgroundWaitTool = {
  name: "redcode_background_wait",
  description:
    "Wait for a recorded Monitor or command task from this harness run. Use its native task ID. Waits at most 30 seconds, without starting, stopping or resuming work. A settled wait is not proof of success: inspect task.status and task.output. On timeout, decide whether to wait again. Do not wait for services or watchers you intend to leave running.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["taskID"],
    properties: {
      taskID: { type: "string", minLength: 1 },
      timeoutMs: { type: "integer", minimum: 1000, maximum: 30000, default: 10000 },
    },
  },
}

export const delegationTools: Array<{ name: string; description: string; inputSchema: Frame }> = [
  {
    name: "redcode_delegate_task",
    description:
      "Delegate a task to Redcode or a configured Codex or Claude harness in this checkout. This creates a child task, not a user-requested conversation. Supply a stable requestID when retrying. The result is delivered back when the parent is ready.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["requestID", "driver", "task"],
      properties: {
        requestID: { type: "string", minLength: 1, maxLength: 200 },
        driver: { type: "string", enum: ["redcode", "codex", "claude"] },
        task: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "redcode_task_status",
    description:
      "Inspect a task delegated by this harness, including its state, output and pending requests. A waiting task may need the user's attention.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskID"],
      properties: { taskID: { type: "string", minLength: 1 } },
    },
  },
  {
    name: "redcode_task_cancel",
    description: "Interrupt a running task delegated by this harness. Completed results remain available.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskID"],
      properties: { taskID: { type: "string", minLength: 1 } },
    },
  },
]

const TaskInput = z.object({ taskID: z.string().min(1) }).strict()

/** Per-process protocol bridge. Callers can name tasks, never another harness or filesystem path. */
export function createHarnessTools(input: {
  driver: Harness.Driver
  wait: (
    taskID: string,
    timeoutMs: number,
    signal: AbortSignal,
  ) => ReturnType<ReturnType<typeof createHarnessTasks>["wait"]>
  waitEnabled: boolean
  delegation?: {
    delegate: (args: unknown) => Promise<unknown>
    status: (id: string) => unknown
    cancel: (id: string) => Promise<unknown>
  }
  send: (frame: Frame) => void
}) {
  const pending = new Map<string, AbortController>()
  const call = async (id: string, name: string, args: unknown) => {
    if (name !== "redcode_background_wait") {
      if (!input.delegation) throw new Error("Delegation is not enabled for this harness")
      if (name === "redcode_delegate_task") return input.delegation.delegate(args)
      const task = TaskInput.parse(args)
      if (name === "redcode_task_status") return input.delegation.status(task.taskID)
      if (name === "redcode_task_cancel") return input.delegation.cancel(task.taskID)
      throw new Error("Unsupported Redcode tool")
    }
    if (!input.waitEnabled) throw new Error("Background wait is not enabled for this harness")
    const parsed = WaitInput.safeParse(args)
    if (!parsed.success) throw new Error("Expected taskID and an optional timeoutMs from 1000 to 30000")
    if (pending.has(id)) throw new Error("This tool request is already waiting")
    const controller = new AbortController()
    pending.set(id, controller)
    try {
      return await input.wait(parsed.data.taskID, parsed.data.timeoutMs ?? 10000, controller.signal)
    } finally {
      pending.delete(id)
    }
  }
  return {
    cancel(id?: string) {
      if (id !== undefined) return pending.get(id)?.abort()
      pending.forEach((controller) => controller.abort())
    },
    handle(frame: Frame) {
      if (input.driver === "codex") {
        const parsed = CodexCall.safeParse(frame)
        if (!parsed.success) return false
        void call(String(parsed.data.id), parsed.data.params.tool, parsed.data.params.arguments).then(
          (result) =>
            input.send({
              id: parsed.data.id,
              result: {
                contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
                success:
                  parsed.data.params.tool !== "redcode_background_wait" ||
                  (typeof result === "object" && result !== null && "state" in result && result.state === "settled"),
              },
            }),
          (error) =>
            input.send({
              id: parsed.data.id,
              result: {
                contentItems: [
                  { type: "inputText", text: error instanceof Error ? error.message : "Native wait failed" },
                ],
                success: false,
              },
            }),
        )
        return true
      }
      const parsed = ClaudeCall.safeParse(frame)
      if (!parsed.success) return false
      const message = parsed.data.request.message
      const server = parsed.data.request.server_name
      const reply = (response: Frame) =>
        input.send({
          type: "control_response",
          response: { subtype: "success", request_id: parsed.data.request_id, response: { mcp_response: response } },
        })
      if (message.id === undefined) {
        reply({ jsonrpc: "2.0", result: {} })
        return true
      }
      const id = message.id
      if (message.method === "initialize") {
        reply({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: server, version: "1.0.0" },
          },
        })
        return true
      }
      if (message.method === "tools/list") {
        reply({
          jsonrpc: "2.0",
          id,
          result: {
            tools:
              server === "redcode_wait"
                ? input.waitEnabled
                  ? [
                      {
                        ...backgroundWaitTool,
                        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
                      },
                    ]
                  : []
                : input.delegation
                  ? delegationTools
                  : [],
          },
        })
        return true
      }
      if (message.method === "ping") {
        reply({ jsonrpc: "2.0", id, result: {} })
        return true
      }
      const name = message.params?.name
      const allowed =
        server === "redcode_wait"
          ? name === backgroundWaitTool.name && input.waitEnabled
          : !!input.delegation && delegationTools.some((tool) => tool.name === name)
      if (message.method !== "tools/call" || typeof name !== "string" || !allowed) {
        reply({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unsupported Redcode observer method or tool" } })
        return true
      }
      void call(parsed.data.request_id, name, message.params?.arguments).then(
        (result) =>
          reply({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result) }],
              isError:
                name === "redcode_background_wait" &&
                !(typeof result === "object" && result !== null && "state" in result && result.state === "settled"),
            },
          }),
        (error) =>
          reply({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: error instanceof Error ? error.message : "Native wait failed" }],
              isError: true,
            },
          }),
      )
      return true
    },
  }
}
