import { createInterface } from "node:readline"
import { appendFileSync } from "node:fs"

const [driver, capture, ...args] = process.argv.slice(2)
if (args.includes("--version")) {
  console.log("fixture-cli 1.0")
  process.exit(0)
}
if (args.includes("status")) {
  console.log(JSON.stringify({ loggedIn: true }))
  process.exit(0)
}
const send = (value: object) => console.log(JSON.stringify(value))
if (args.includes("login")) {
  console.log("https://claude.example.test/authorize")
  for await (const code of createInterface({ input: process.stdin })) process.exit(code === "fixture-code" ? 0 : 1)
}
const state = { turn: "turn-fixture", thread: "thread-fixture", completed: 0, prompt: "", waiting: "" }
const startWait = (mode: string) => {
  state.waiting = mode
  const taskID = `wait-${driver === "claude" ? state.prompt : state.turn}`
  const arguments_ =
    mode === "wait-invalid"
      ? { taskID, runID: "foreign-run", timeoutMs: 999999 }
      : {
          taskID: mode === "wait-foreign" ? (driver === "claude" ? "native-monitor" : "native-command") : taskID,
          timeoutMs: mode === "wait-timeout" ? 1000 : 30000,
        }
  if (driver === "codex") {
    const item = {
      type: "commandExecution",
      id: taskID,
      command: mode,
      status: "inProgress",
      processId: "wait-pty",
      aggregatedOutput: null,
    }
    send({ method: "item/started", params: { threadId: state.thread, turnId: state.turn, item } })
    send({
      id: 909,
      method: "item/tool/call",
      params: {
        threadId: mode === "wait-foreign-thread" ? "foreign-thread" : state.thread,
        turnId: state.turn,
        callId: "wait-call",
        namespace: null,
        tool: "redcode_background_wait",
        arguments: arguments_,
      },
    })
    if (mode === "wait-success")
      send({
        method: "item/completed",
        params: {
          threadId: state.thread,
          item: { ...item, status: "failed", aggregatedOutput: "native build failed" },
        },
      })
  }
  if (driver === "claude") {
    send({
      type: "assistant",
      session_id: "claude-fixture",
      message: { content: [{ type: "tool_use", id: `tool-${taskID}`, name: "Monitor" }] },
    })
    const task = {
      type: "system",
      session_id: "claude-fixture",
      task_id: taskID,
      task_type: "local_bash",
      tool_use_id: `tool-${taskID}`,
      description: mode,
    }
    send({ ...task, subtype: "task_started" })
    send({
      type: "control_request",
      request_id: "wait-call",
      request: {
        subtype: "mcp_message",
        server_name: "redcode_wait",
        message: {
          jsonrpc: "2.0",
          id: 909,
          method: "tools/call",
          params: { name: "redcode_background_wait", arguments: arguments_ },
        },
      },
    })
    if (mode === "wait-success")
      send({ ...task, subtype: "task_notification", status: "failed", summary: "native build failed" })
  }
}
const complete = () => {
  state.completed++
  if (driver === "codex") {
    const usage = {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: state.thread,
        tokenUsage: {
          total: {
            inputTokens: 100 * state.completed,
            cachedInputTokens: 80 * state.completed,
            outputTokens: 30 * state.completed,
            reasoningOutputTokens: 5 * state.completed,
          },
        },
      },
    }
    send(usage)
    send(usage)
    send({
      method: "item/agentMessage/delta",
      params: { threadId: state.thread, turnId: state.turn, delta: "fixture response" },
    })
    send({
      method: "turn/completed",
      params: { threadId: state.thread, turn: { id: state.turn, status: "completed" } },
    })
  }
  if (driver === "claude") {
    send({
      type: "assistant",
      message: { content: [{ type: "text", text: "fixture response" }] },
      parent_tool_use_id: null,
    })
    send({
      type: "result",
      uuid: state.prompt,
      session_id: "claude-fixture",
      is_error: false,
      usage: { input_tokens: 20, output_tokens: 30, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 },
      total_cost_usd: 0.002 * state.completed,
      modelUsage: {
        "fixture-model": {
          inputTokens: 20 * state.completed,
          outputTokens: 30 * state.completed,
          cacheReadInputTokens: 80 * state.completed,
          cacheCreationInputTokens: 10 * state.completed,
        },
      },
    })
  }
}
for await (const line of createInterface({ input: process.stdin })) {
  appendFileSync(capture, line + "\n")
  const value = JSON.parse(line)
  if (driver === "codex") {
    if (value.method === "initialize") send({ id: value.id, result: {} })
    if (value.method === "account/login/start") {
      send({
        id: value.id,
        result: {
          loginId: "fixture-login",
          verificationUrl: "https://codex.example.test/device",
          userCode: "ABCD-1234",
        },
      })
      send({ method: "account/login/completed", params: { loginId: "fixture-login", success: true } })
    }
    if (value.method === "account/read") send({ id: value.id, result: { account: { type: "chatgpt" } } })
    if (value.method === "model/list" && value.params.cursor && args.includes("models-error")) {
      send({ id: value.id, error: { code: -32000, message: "The model catalog is temporarily unavailable" } })
      continue
    }
    if (value.method === "model/list")
      send({
        id: value.id,
        result: {
          data: value.params.cursor
            ? [{ id: "fixture-second", model: "fixture-second", displayName: "Second model", isDefault: false }]
            : [
                { id: "fixture-model", model: "fixture-model", displayName: "Fixture model", isDefault: true },
                { id: "hidden-model", hidden: true },
              ],
          nextCursor: value.params.cursor ? null : "models-second-page",
        },
      })
    if (["thread/start", "thread/resume"].includes(value.method))
      send({ id: value.id, result: { thread: { id: state.thread } } })
    if (value.method === "turn/start") {
      state.turn = `turn-${value.id}`
      send({ id: value.id, result: { turn: { id: state.turn } } })
      send({ method: "turn/started", params: { threadId: state.thread, turn: { id: state.turn } } })
      const text = value.params.input[0].text
      if (text.startsWith("wait-")) {
        startWait(text)
        if (text === "wait-foreign-thread") complete()
        continue
      }
      if (text === "native-tasks") {
        const item = {
          type: "commandExecution",
          id: "native-command",
          command: "bun run verify",
          status: "inProgress",
          processId: "pty-42",
          aggregatedOutput: null,
        }
        send({ method: "item/started", params: { threadId: state.thread, turnId: state.turn, item } })
        send({
          method: "item/commandExecution/outputDelta",
          params: { threadId: state.thread, turnId: state.turn, itemId: item.id, delta: "check started" },
        })
        send({ method: "item/started", params: { threadId: "foreign-thread", item: { ...item, id: "foreign-task" } } })
        send({
          method: "item/completed",
          params: {
            threadId: state.thread,
            turnId: "previous-turn",
            item: { ...item, status: "completed", aggregatedOutput: "checks passed" },
          },
        })
        send({
          method: "item/commandExecution/outputDelta",
          params: { threadId: state.thread, itemId: item.id, delta: "late output" },
        })
        send({ method: "item/started", params: { threadId: state.thread, item: { ...item, id: "native-active" } } })
        send({
          method: "item/commandExecution/outputDelta",
          params: { threadId: state.thread, itemId: "native-active", delta: "x".repeat(64000) + "tail" },
        })
        send({
          method: "item/completed",
          params: { threadId: state.thread, item: { ...item, id: "native-unknown", status: "future-status" } },
        })
      }
      if (text === "permission")
        send({
          id: 77,
          method: "item/commandExecution/requestApproval",
          params: { threadId: state.thread, turnId: state.turn, command: "echo fixture" },
        })
      if (text === "question")
        send({
          id: 78,
          method: "item/tool/requestUserInput",
          params: {
            threadId: state.thread,
            turnId: state.turn,
            questions: [{ id: "choice", question: "Choose implementation", options: [{ label: "Small" }] }],
          },
        })
      if (text === "unsupported")
        send({
          id: 79,
          method: "item/permissions/requestApproval",
          params: { threadId: state.thread, turnId: state.turn },
        })
      if (text === "foreign") {
        send({
          id: 80,
          method: "item/commandExecution/requestApproval",
          params: { threadId: "other-thread", turnId: state.turn },
        })
        complete()
      }
      if (!["permission", "question", "unsupported", "foreign", "hold"].includes(text)) complete()
    }
    if (value.method === "turn/steer") {
      send({ id: value.id, result: {} })
      complete()
    }
    if (value.method === "turn/interrupt") {
      send({ id: value.id, result: {} })
      send({
        method: "turn/completed",
        params: { threadId: state.thread, turn: { id: state.turn, status: "interrupted" } },
      })
    }
    if ([77, 78, 79].includes(value.id) && (value.result || value.error)) complete()
    if (value.id === 909 && value.result) {
      send({
        method: "item/agentMessage/delta",
        params: {
          threadId: state.thread,
          turnId: state.turn,
          delta: `WAIT_RESULT ${value.result.contentItems[0].text}`,
        },
      })
      if (state.waiting !== "wait-cancel") complete()
    }
  }
  if (driver === "claude") {
    if (value.type === "control_request") {
      send({ type: "control_response", response: { subtype: "success", request_id: value.request_id, response: {} } })
      if (value.request.subtype === "initialize" && value.request.sdkMcpServers?.includes("redcode_wait")) {
        send({
          type: "control_request",
          request_id: "wait-mcp-init",
          request: {
            subtype: "mcp_message",
            server_name: "redcode_wait",
            message: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
          },
        })
        send({
          type: "control_request",
          request_id: "wait-mcp-list",
          request: {
            subtype: "mcp_message",
            server_name: "redcode_wait",
            message: { jsonrpc: "2.0", id: 2, method: "tools/list" },
          },
        })
      }
    }
    if (value.type === "user") {
      state.prompt = value.uuid
      send({ type: "system", subtype: "init", session_id: "claude-fixture" })
      const text = value.message.content
      if (text.startsWith("wait-")) {
        startWait(text)
        continue
      }
      if (text === "native-tasks") {
        const task = {
          type: "system",
          session_id: "claude-fixture",
          task_id: "native-monitor",
          task_type: "local_bash",
          tool_use_id: "monitor-call",
          parent_task_id: "native-parent",
          description: "Observe deployment",
        }
        send({ ...task, subtype: "task_started" })
        send({
          type: "assistant",
          session_id: "claude-fixture",
          parent_tool_use_id: null,
          message: { content: [{ type: "tool_use", id: "monitor-call", name: "Monitor" }] },
        })
        send({ ...task, subtype: "task_progress", description: "Observe deployment readiness" })
        send({
          ...task,
          subtype: "task_notification",
          status: "completed",
          summary: "deployment healthy",
          output_file: "/native/task-output.txt",
        })
        send({ ...task, subtype: "task_progress", description: "late progress" })
        send({ ...task, subtype: "task_started", session_id: "foreign-session", task_id: "foreign-task" })
        send({
          ...task,
          subtype: "task_started",
          task_id: "native-active",
          tool_use_id: "bash-call",
          description: "Background build",
        })
        send({
          ...task,
          subtype: "task_notification",
          task_id: "native-unknown",
          tool_use_id: "future-call",
          task_type: "future-kind",
          status: "future-status",
        })
      }
      if (text === "permission")
        send({
          type: "control_request",
          request_id: "claude-permission",
          request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "echo fixture" } },
        })
      if (text === "question")
        send({
          type: "control_request",
          request_id: "claude-question",
          request: {
            subtype: "can_use_tool",
            tool_name: "AskUserQuestion",
            input: { questions: [{ question: "Choose implementation", options: [{ label: "Small" }] }] },
          },
        })
      if (!["permission", "question", "hold"].includes(text)) complete()
    }
    if (value.type === "control_response") {
      if (["wait-mcp-init", "wait-mcp-list"].includes(value.response.request_id)) continue
      if (value.response.request_id === "wait-call") {
        send({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: `WAIT_RESULT ${value.response.response.mcp_response.result.content[0].text}` },
            ],
          },
          parent_tool_use_id: null,
        })
        if (state.waiting !== "wait-cancel") complete()
        continue
      }
      complete()
    }
  }
}
