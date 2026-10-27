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
    tool: z.literal("redcode_background_wait"),
    namespace: z.null().optional(),
    arguments: z.json(),
  }),
})
const ClaudeCall = z.object({
  type: z.literal("control_request"),
  request_id: z.string(),
  request: z.object({
    subtype: z.literal("mcp_message"),
    server_name: z.literal("redcode_wait"),
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

/** Per-process protocol bridge. Callers can name tasks, never another harness or filesystem path. */
export function createHarnessTools(input: {
  driver: Harness.Driver
  wait: (
    taskID: string,
    timeoutMs: number,
    signal: AbortSignal,
  ) => ReturnType<ReturnType<typeof createHarnessTasks>["wait"]>
  send: (frame: Frame) => void
}) {
  const pending = new Map<string, AbortController>()
  const call = async (id: string, args: unknown) => {
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
        void call(String(parsed.data.id), parsed.data.params.arguments).then(
          (result) =>
            input.send({
              id: parsed.data.id,
              result: {
                contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
                success: result.state === "settled",
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
            serverInfo: { name: "redcode_wait", version: "1.0.0" },
          },
        })
        return true
      }
      if (message.method === "tools/list") {
        reply({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              {
                ...backgroundWaitTool,
                annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
              },
            ],
          },
        })
        return true
      }
      if (message.method === "ping") {
        reply({ jsonrpc: "2.0", id, result: {} })
        return true
      }
      if (message.method !== "tools/call" || message.params?.name !== backgroundWaitTool.name) {
        reply({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unsupported Redcode observer method or tool" } })
        return true
      }
      void call(parsed.data.request_id, message.params.arguments).then(
        (result) =>
          reply({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(result) }], isError: result.state !== "settled" },
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
