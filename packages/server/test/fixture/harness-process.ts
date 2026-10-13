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
const state = { turn: "turn-fixture", thread: "thread-fixture" }
const complete = () => {
  if (driver === "codex") {
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
    send({ type: "result", session_id: "claude-fixture", is_error: false })
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
    if (value.method === "model/list")
      send({
        id: value.id,
        result: {
          data: [{ id: "fixture-model", model: "fixture-model", displayName: "Fixture model", isDefault: true }],
        },
      })
    if (["thread/start", "thread/resume"].includes(value.method))
      send({ id: value.id, result: { thread: { id: state.thread } } })
    if (value.method === "turn/start") {
      send({ id: value.id, result: { turn: { id: state.turn } } })
      send({ method: "turn/started", params: { threadId: state.thread, turn: { id: state.turn } } })
      const text = value.params.input[0].text
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
  }
  if (driver === "claude") {
    if (value.type === "control_request")
      send({ type: "control_response", response: { subtype: "success", request_id: value.request_id, response: {} } })
    if (value.type === "user") {
      send({ type: "system", subtype: "init", session_id: "claude-fixture" })
      const text = value.message.content
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
    if (value.type === "control_response") complete()
  }
}
