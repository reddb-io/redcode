import { createInterface } from "node:readline"
import { appendFileSync } from "node:fs"

const [driver, capture, ...args] = process.argv.slice(2)
// A forked Claude session gets a new native identity.
const claudeSession = args.includes("--fork-session") ? "claude-fork" : "claude-fixture"
if (args.includes("--version")) {
  console.log(process.env.REDCODE_FIXTURE_VERSION ?? "fixture-cli 1.0")
  process.exit(0)
}
if (args.includes("status")) {
  // A probe that inherits the launching Claude Code session's variables would report that session's state.
  console.log(JSON.stringify({ loggedIn: !process.env.CLAUDECODE, authMethod: "claude.ai", subscriptionType: "max" }))
  process.exit(0)
}
const send = (value: object) => console.log(JSON.stringify(value))
const state = {
  turn: "turn-fixture",
  thread: "thread-fixture",
  completed: 0,
  prompt: "",
  waiting: "",
  claudeActive: false,
}
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
      session_id: claudeSession,
      message: { content: [{ type: "tool_use", id: `tool-${taskID}`, name: "Monitor" }] },
    })
    const task = {
      type: "system",
      session_id: claudeSession,
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
    state.claudeActive = false
    send({
      type: "assistant",
      message: { content: [{ type: "text", text: "fixture response" }] },
      parent_tool_use_id: null,
    })
    send({
      type: "result",
      uuid: state.prompt,
      session_id: claudeSession,
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
      const text = value.params.input.find((item: { type: string }) => item.type === "text")?.text ?? ""
      if (text.startsWith("delegate:")) {
        send({
          id: 910,
          method: "item/tool/call",
          params: {
            threadId: state.thread,
            turnId: state.turn,
            callId: "delegate-call",
            namespace: null,
            tool: "redcode_delegate_task",
            arguments: { requestID: "fixture-delegation", driver: text.slice(9), task: "review" },
          },
        })
        continue
      }
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
      if (text === "tools") {
        const item = (method: string, value: object) =>
          send({ method, params: { threadId: state.thread, turnId: state.turn, item: value } })
        const command = { type: "commandExecution", id: "cmd-1", command: "echo hi", status: "inProgress" }
        const edit = {
          type: "fileChange",
          id: "edit-1",
          changes: [{ path: "a.txt", kind: { type: "add" }, diff: "+one" }],
          status: "inProgress",
        }
        item("item/started", { type: "agentMessage", id: "message-1", text: "" })
        item("item/started", command)
        item("item/completed", { ...command, status: "completed", aggregatedOutput: "hi" })
        item("item/started", edit)
        item("item/completed", { ...edit, status: "declined" })
        send({
          method: "turn/plan/updated",
          params: {
            threadId: state.thread,
            turnId: state.turn,
            explanation: null,
            plan: [
              { step: "Write tests", status: "completed" },
              { step: "Ship", status: "inProgress" },
            ],
          },
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
    if (value.id === 910 && value.result) {
      send({
        method: "item/agentMessage/delta",
        params: {
          threadId: state.thread,
          turnId: state.turn,
          delta: `DELEGATE_RESULT ${value.result.contentItems[0].text}`,
        },
      })
      complete()
    }
  }
  if (driver === "claude") {
    if (value.type === "control_request") {
      if (value.request.subtype === "interrupt") state.claudeActive = false
      send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: value.request_id,
          response:
            value.request.subtype === "initialize"
              ? {
                  models: [
                    { value: "default", displayName: "Default (recommended)" },
                    { value: "opus", displayName: "Opus" },
                  ],
                }
              : value.request.subtype === "get_usage"
                ? {
                    rate_limits_available: true,
                    rate_limits: {
                      five_hour: { utilization: 37.5, resets_at: "2026-11-18T20:00:00Z" },
                      seven_day: null,
                      seven_day_opus: { utilization: null, resets_at: "2026-11-21T00:00:00Z" },
                      model_scoped: [{ display_name: "Fable", utilization: 12, resets_at: "2026-11-21T00:00:00Z" }],
                    },
                  }
                : {},
        },
      })
      if (value.request.subtype === "initialize" && value.request.sdkMcpServers?.includes("redcode")) {
        send({
          type: "control_request",
          request_id: "delegation-mcp-list",
          request: { subtype: "mcp_message", server_name: "redcode", message: { jsonrpc: "2.0", id: 2, method: "tools/list" } },
        })
      }
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
      // Like Claude Code, a message during a held turn joins that turn instead of starting another.
      if (state.claudeActive) {
        send({
          type: "assistant",
          message: { content: [{ type: "text", text: `STEERED ${value.message.content}` }] },
          parent_tool_use_id: null,
        })
        continue
      }
      state.prompt = value.uuid
      send({ type: "system", subtype: "init", session_id: claudeSession })
      const text =
        typeof value.message.content === "string"
          ? value.message.content
          : (value.message.content.find((item: { type: string }) => item.type === "text")?.text ?? "")
      state.claudeActive = text === "hold" || text === "permission"
      if (text.startsWith("delegate:")) {
        send({
          type: "control_request",
          request_id: "delegate-call",
          request: {
            subtype: "mcp_message",
            server_name: "redcode",
            message: {
              jsonrpc: "2.0",
              id: 910,
              method: "tools/call",
              params: {
                name: "redcode_delegate_task",
                arguments: { requestID: "fixture-delegation", driver: text.slice(9), task: "review" },
              },
            },
          },
        })
        continue
      }
      if (text.startsWith("wait-")) {
        startWait(text)
        continue
      }
      if (text === "native-tasks") {
        const task = {
          type: "system",
          session_id: claudeSession,
          task_id: "native-monitor",
          task_type: "local_bash",
          tool_use_id: "monitor-call",
          parent_task_id: "native-parent",
          description: "Observe deployment",
        }
        send({ ...task, subtype: "task_started" })
        send({
          type: "assistant",
          session_id: claudeSession,
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
      if (text === "tools") {
        const assistant = (content: object[]) =>
          send({ type: "assistant", session_id: claudeSession, parent_tool_use_id: null, message: { content } })
        const result = (block: object, extra: object = {}) =>
          send({
            type: "user",
            session_id: claudeSession,
            parent_tool_use_id: null,
            message: { role: "user", content: [{ type: "tool_result", ...block }] },
            ...extra,
          })
        assistant([{ type: "text", text: `TODO_TOOLS ${process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS}` }])
        assistant([
          { type: "tool_use", id: "search-1", name: "ToolSearch", input: { query: "select:TaskCreate,TaskUpdate" } },
          { type: "tool_use", id: "create-1", name: "TaskCreate", input: { subject: "Write tests" } },
          { type: "tool_use", id: "create-2", name: "TaskCreate", input: { subject: "Ship" } },
        ])
        result(
          { tool_use_id: "create-1", content: "Task #1 created" },
          { tool_use_result: { task: { id: "1", subject: "Write tests" } } },
        )
        result(
          { tool_use_id: "create-2", content: "Task #2 created" },
          { tool_use_result: { task: { id: "2", subject: "Ship" } } },
        )
        assistant([
          { type: "tool_use", id: "update-1", name: "TaskUpdate", input: { taskId: "1", status: "completed" } },
          { type: "tool_use", id: "update-2", name: "TaskUpdate", input: { id: "2", status: "in_progress" } },
          { type: "tool_use", id: "bash-1", name: "Bash", input: { command: "echo hi" } },
          { type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/missing.txt" } },
        ])
        result({ tool_use_id: "bash-1", content: [{ type: "text", text: "hi" }] })
        result({ tool_use_id: "read-1", content: "File does not exist.", is_error: true })
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
      if (text === "plan")
        send({
          type: "control_request",
          request_id: "claude-plan",
          request: {
            subtype: "can_use_tool",
            tool_name: "ExitPlanMode",
            input: { plan: "# Plan\n\n1. Ship it", planFilePath: "/fixture/plans/plan.md" },
          },
        })
      if (!["permission", "question", "hold", "plan"].includes(text)) complete()
    }
    if (value.type === "control_response") {
      if (["wait-mcp-init", "wait-mcp-list", "delegation-mcp-list"].includes(value.response.request_id)) continue
      if (value.response.request_id === "delegate-call") {
        send({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: `DELEGATE_RESULT ${value.response.response.mcp_response.result.content[0].text}` },
            ],
          },
          parent_tool_use_id: null,
        })
        complete()
        continue
      }
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
      // Like Claude Code, an approved plan leaves plan mode.
      if (value.response.request_id === "claude-plan" && value.response.response.behavior === "allow")
        send({ type: "system", subtype: "status", status: null, permissionMode: "default" })
      complete()
    }
  }
}
