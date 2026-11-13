import { expect, test } from "bun:test"
import {
  createHarnessTools,
  encodeComputerUseToolName,
  type ComputerUseBridge,
} from "../src/harness-tools"
import type { Frame } from "../src/harness-wire"

const bridge = (call: ComputerUseBridge["call"]): ComputerUseBridge => ({
  tools: [
    {
      name: "desktop_observe",
      description: "Observe the bound desktop",
      inputSchema: { type: "object", additionalProperties: false },
    },
  ],
  call,
  close: async () => {},
})

test("Codex Computer Use dynamic calls preserve the native tool name and execute once", async () => {
  const sent: Frame[] = []
  const calls: Array<{ name: string; args: unknown }> = []
  const tools = createHarnessTools({
    driver: "codex",
    waitEnabled: false,
    wait: async () => {
      throw new Error("not used")
    },
    computerUse: bridge(async (name, args) => {
      calls.push({ name, args })
      return { content: [{ type: "text", text: "observed" }], isError: false }
    }),
    send: (frame) => sent.push(frame),
  })

  expect(
    tools.handle({
      id: 41,
      method: "item/tool/call",
      params: {
        threadId: "thread",
        turnId: "turn",
        callId: "call",
        tool: encodeComputerUseToolName("desktop_observe"),
        namespace: null,
        arguments: { application: "Editor" },
      },
    }),
  ).toBeTrue()
  await until(() => sent.length === 1)
  expect(calls).toEqual([{ name: "desktop_observe", args: { application: "Editor" } }])
  expect(sent[0]).toMatchObject({ id: 41, result: { success: true } })
})

test("Claude Computer Use advertises only bound tools and cancellation does not retry input", async () => {
  const sent: Frame[] = []
  let calls = 0
  let aborted = false
  const tools = createHarnessTools({
    driver: "claude",
    waitEnabled: false,
    wait: async () => {
      throw new Error("not used")
    },
    computerUse: bridge(
      (_name, _args, signal) =>
        new Promise((_resolve, reject) => {
          calls++
          signal.addEventListener(
            "abort",
            () => {
              aborted = true
              reject(new Error("cancelled"))
            },
            { once: true },
          )
        }),
    ),
    send: (frame) => sent.push(frame),
  })
  const request = (requestID: string, message: Frame) =>
    tools.handle({
      type: "control_request",
      request_id: requestID,
      request: { subtype: "mcp_message", server_name: "redcode_computer_use", message },
    })

  expect(request("list", { jsonrpc: "2.0", id: 1, method: "tools/list" })).toBeTrue()
  expect(sent[0]).toMatchObject({
    response: { response: { mcp_response: { result: { tools: [{ name: "desktop_observe" }] } } } },
  })
  expect(
    request("call", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "desktop_observe", arguments: {} },
    }),
  ).toBeTrue()
  await until(() => calls === 1)
  tools.cancelComputerUse()
  await until(() => aborted && sent.length === 2)
  expect(calls).toBe(1)
  expect(sent[1]).toMatchObject({ response: { response: { mcp_response: { result: { isError: true } } } } })
})

test("revoking Computer Use leaves an unrelated background wait running", async () => {
  let computerUseAborted = false
  let waitAborted = false
  let finishWait = () => {}
  const tools = createHarnessTools({
    driver: "codex",
    waitEnabled: true,
    wait: async (_taskID, _timeoutMs, signal) =>
      new Promise((resolve, reject) => {
        finishWait = () => resolve({ state: "settled" } as never)
        signal.addEventListener(
          "abort",
          () => {
            waitAborted = true
            reject(new Error("wait cancelled"))
          },
          { once: true },
        )
      }),
    computerUse: bridge(
      (_name, _args, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              computerUseAborted = true
              reject(new Error("computer use cancelled"))
            },
            { once: true },
          ),
        ),
    ),
    send: () => {},
  })
  tools.handle({
    id: 51,
    method: "item/tool/call",
    params: {
      threadId: "thread",
      turnId: "turn",
      callId: "computer",
      tool: encodeComputerUseToolName("desktop_observe"),
      namespace: null,
      arguments: {},
    },
  })
  tools.handle({
    id: 52,
    method: "item/tool/call",
    params: {
      threadId: "thread",
      turnId: "turn",
      callId: "wait",
      tool: "redcode_background_wait",
      namespace: null,
      arguments: { taskID: "task" },
    },
  })
  tools.cancelComputerUse()
  await until(() => computerUseAborted)
  expect(waitAborted).toBeFalse()
  finishWait()
})

async function until(check: () => boolean) {
  for (let index = 0; index < 100; index++) {
    if (check()) return
    await Bun.sleep(5)
  }
  throw new Error("Timed out")
}
