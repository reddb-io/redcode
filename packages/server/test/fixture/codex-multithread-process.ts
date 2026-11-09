import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"

const [, capture, ...args] = process.argv.slice(2)
if (args.includes("--version")) {
  console.log("fixture-cli 1.0")
  process.exit(0)
}
appendFileSync(capture, JSON.stringify({ environment: { CODEX_HOME: process.env.CODEX_HOME ?? null } }) + "\n")

const threads = { count: 0 }
const approvals = new Map<string, { thread: string; turn: string }>()
const send = (value: object) => console.log(JSON.stringify(value))
const complete = (thread: string, turn: string, text: string) => {
  send({ method: "item/agentMessage/delta", params: { threadId: thread, turnId: turn, delta: text } })
  send({ method: "turn/completed", params: { threadId: thread, turn: { id: turn, status: "completed" } } })
}

for await (const line of createInterface({ input: process.stdin })) {
  appendFileSync(capture, line + "\n")
  const value = JSON.parse(line)
  if (value.method === "initialize") {
    send({ id: value.id, result: {} })
    continue
  }
  if (value.method === "account/read") {
    send({ id: value.id, result: { account: { type: "chatgpt" } } })
    continue
  }
  if (value.method === "model/list") {
    send({ id: value.id, result: { data: [], nextCursor: null } })
    continue
  }
  if (value.method === "thread/start") {
    const thread = `thread-${++threads.count}`
    send({ id: value.id, result: { thread: { id: thread } } })
    continue
  }
  if (value.method === "thread/resume") {
    send({ id: value.id, result: { thread: { id: value.params.threadId } } })
    continue
  }
  if (value.method === "turn/start") {
    const thread = value.params.threadId
    const turn = `turn-${value.id}`
    const text = value.params.input[0].text
    send({ id: value.id, result: { turn: { id: turn } } })
    send({ method: "turn/started", params: { threadId: thread, turn: { id: turn } } })
    if (text === "hold") continue
    if (text === "permission") {
      const request = `permission-${thread}`
      approvals.set(request, { thread, turn })
      send({
        id: request,
        method: "item/commandExecution/requestApproval",
        params: { threadId: thread, turnId: turn, command: `echo ${thread}` },
      })
      continue
    }
    complete(thread, turn, `${thread}:${text}`)
    continue
  }
  if (value.method === "turn/interrupt") {
    send({ id: value.id, result: {} })
    send({
      method: "turn/completed",
      params: { threadId: value.params.threadId, turn: { id: value.params.turnId, status: "interrupted" } },
    })
    continue
  }
  const approval = approvals.get(String(value.id))
  if (!approval || (!value.result && !value.error)) continue
  approvals.delete(String(value.id))
  complete(approval.thread, approval.turn, `${approval.thread}:approved`)
}
