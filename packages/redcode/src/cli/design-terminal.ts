import type { Redcode, SessionsEventsOutput, QuestionsListOutput } from "@reddb-io/redcode-client"
import timers from "node:timers/promises"
import { DesignFeedback } from "@reddb-io/redcode-core/design/feedback"
import { errorMessage } from "@/util/error"
import { withTimeout } from "@/util/timeout"

export const help = [
  "Write a message to steer the session; /queue text waits until its current work finishes.",
  "/mode design|plan|build · /model provider/model · /status · /stop · /resume · /review · /quit",
  "/goal objective · /goal-status · /goal-pause · /goal-resume · /goal-budget N · /goal-drop",
  "/allow request-id once|always|reject · /answer request-id 1; 2,3 · /reject request-id",
  "For questions, separate answers with semicolons and multiple option numbers with commas.",
].join("\n")

export async function create(input: {
  client: ReturnType<typeof Redcode.make>
  directory: string
  sessionID?: string
  agent?: "design" | "plan" | "build"
  model?: { providerID: string; id: string }
  write: (text: string) => void
  mode: (agent: string) => void
  review: (sessionID: string) => Promise<void>
}) {
  const abort = new AbortController()
  const options = () => ({ signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) })
  const session = input.sessionID
    ? await input.client.sessions.get({ sessionID: input.sessionID }, options())
    : await input.client.sessions.create(
        { location: { directory: input.directory }, agent: input.agent ?? "design", model: input.model },
        options(),
      )
  const ref = { sessionID: session.id }
  const state = {
    agent: session.agent ?? "build",
    sequence: 0,
    epoch: 0,
    refresh: 0,
    status: "",
    goal: "",
    requests: new Set<string>(),
  }
  input.mode(state.agent)
  input.write(`Session ${session.id} · ${state.agent}\n${help}`)
  if (input.sessionID)
    input.write("Session history restored. Execution resumes only when you send a message or use /resume.")

  const render = (event: SessionsEventsOutput) => {
    if (event.durable && event.durable.seq <= state.sequence) return
    if (event.durable) state.sequence = event.durable.seq
    state.epoch++
    switch (event.type) {
      case "session.next.agent.switched":
        state.agent = event.data.agent
        input.mode(state.agent)
        input.write(`Mode: ${state.agent}`)
        return
      case "session.next.prompted": {
        const review = DesignFeedback.summarize(event.data.prompt.text)
        if (!review) {
          input.write(`You: ${event.data.prompt.text}`)
          return
        }
        input.write(
          [
            `Design review ${review.id} · ${review.revision}${review.variant ? ` · ${review.variant}` : ""}${review.ended ? " · ended" : ""}`,
            review.text,
            ...review.notes.map((note, index) => `${index + 1}. ${note.label} — ${note.text}`),
            review.attachments.length ? `Attachments: ${review.attachments.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        )
        return
      }
      case "session.next.text.ended":
        input.write(event.data.text.slice(-24000))
        return
      case "session.next.step.started":
        input.write(`${event.data.agent}: working`)
        return
      case "session.next.tool.called":
        input.write(`Tool: ${event.data.tool}`)
        return
      case "session.next.tool.success":
        input.write(
          event.data.content
            .flatMap((part) => (part.type === "text" ? [part.text] : [part.uri]))
            .join("\n")
            .slice(-12000),
        )
        return
      case "session.next.step.failed":
      case "session.next.tool.failed":
        input.write(`Failed: ${event.data.error.message}`)
        return
    }
  }

  const history = async () => {
    while (!abort.signal.aborted) {
      const page = await input.client.sessions.history({ ...ref, limit: 100, after: state.sequence }, options())
      for (const event of page.data) render(event)
      if (!page.hasMore || page.data.length === 0) return
    }
  }
  await history()

  const status = async (force = false) => {
    const refresh = ++state.refresh
    const epoch = state.epoch
    const [current, active, goal, permissions, questions] = await Promise.all([
      input.client.sessions.get(ref, options()),
      input.client.sessions.active(options()),
      input.client.sessions.goal(ref, options()),
      input.client.permissions.list(ref, options()),
      input.client.questions.list(ref, options()),
    ])
    if (abort.signal.aborted || refresh !== state.refresh || epoch !== state.epoch) return
    state.agent = current.agent ?? "build"
    input.mode(state.agent)
    const activity = `${state.agent} · ${active[session.id] ? "running" : "idle"}`
    if (force || activity !== state.status) input.write(activity)
    state.status = activity
    const goalText = goal
      ? `Goal: ${goal.status} · attempts ${goal.turns.used}/${goal.turns.max} · ${goal.tokens} tokens · ${goal.reason}`
      : "No Goal"
    if (force || goalText !== state.goal) input.write(goalText)
    state.goal = goalText
    const pending = new Set([...permissions, ...questions].map((request) => request.id))
    for (const request of permissions) {
      if (!force && state.requests.has(request.id)) continue
      input.write(
        `Permission ${request.id}: ${request.action}\n${request.resources.join("\n")}\n/allow ${request.id} once|always|reject`,
      )
    }
    for (const request of questions) {
      if (!force && state.requests.has(request.id)) continue
      input.write(
        `Question ${request.id}:\n${request.questions.map((question, index) => `${index + 1}. ${question.question}\n${question.options.map((option, optionIndex) => `  ${optionIndex + 1}) ${option.label}: ${option.description}`).join("\n")}`).join("\n")}\n/answer ${request.id} answer-for-each-question`,
      )
    }
    state.requests = pending
  }
  await status()

  const line = async (value: string) => {
    const text = value.trim()
    if (!text) return
    if (!text.startsWith("/")) {
      state.refresh++
      await input.client.sessions.prompt({ ...ref, prompt: { text } }, options())
      return
    }
    const command = text.split(/\s/, 1)[0]
    const argument = text.slice(command.length).trim()
    if (command === "/help") return input.write(help)
    if (command === "/status" || command === "/goal-status") return status(true)
    if (command === "/review") return input.review(session.id)
    // Invalidate reads already in flight before submitting an intervention.
    state.refresh++
    if (command === "/stop") return input.client.sessions.interrupt(ref, options())
    if (command === "/resume") {
      await input.client.sessions.prompt(
        { ...ref, prompt: { text: "Resume the interrupted work within the existing authorized scope." } },
        options(),
      )
      return
    }
    if (command === "/queue") {
      if (!argument) throw new Error("Usage: /queue message")
      await input.client.sessions.prompt({ ...ref, delivery: "queue", prompt: { text: argument } }, options())
      return
    }
    if (command === "/mode") {
      if (!["design", "plan", "build"].includes(argument)) throw new Error("Usage: /mode design|plan|build")
      await input.client.sessions.switchAgent({ ...ref, agent: argument }, options())
      await status(true)
      return
    }
    if (command === "/model") {
      await input.client.sessions.switchModel({ ...ref, model: model(argument) }, options())
      await status(true)
      return
    }
    if (command === "/goal") {
      if (!argument) return status(true)
      await input.client.sessions.goalSet({ ...ref, objective: argument }, options())
      await status(true)
      return
    }
    if (["/goal-pause", "/goal-resume", "/goal-drop", "/goal-budget"].includes(command)) {
      const action =
        command === "/goal-pause"
          ? "pause"
          : command === "/goal-resume"
            ? "resume"
            : command === "/goal-drop"
              ? "drop"
              : "budget"
      const maxTurns = action === "budget" ? Number(argument) : undefined
      if (maxTurns !== undefined && (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 1000))
        throw new Error("Usage: /goal-budget N (1–1000 provider attempts)")
      await input.client.sessions.goalControl({ ...ref, action, maxTurns }, options())
      await status(true)
      return
    }
    if (command === "/allow") {
      const [requestID, reply] = argument.split(/\s+/)
      if (!requestID || (reply !== "once" && reply !== "always" && reply !== "reject"))
        throw new Error("Usage: /allow request-id once|always|reject")
      await input.client.permissions.reply({ ...ref, requestID, reply }, options())
      await status()
      return
    }
    if (command === "/answer") {
      const requestID = argument.split(/\s/, 1)[0]
      const requests = await input.client.questions.list(ref, options())
      const request = requests.find((item) => item.id === requestID)
      if (!request) throw new Error("Question is no longer pending; use /status to refresh.")
      await input.client.questions.reply(
        { ...ref, requestID, answers: answers(request, argument.slice(requestID.length).trim()) },
        options(),
      )
      await status()
      return
    }
    if (command === "/reject") {
      await input.client.questions.reject({ ...ref, requestID: argument }, options())
      await status()
      return
    }
    throw new Error(`Unknown command ${command}; use /help.`)
  }

  const watch = async () => {
    while (!abort.signal.aborted) {
      await (async () => {
        for await (const event of input.client.sessions.events(
          { ...ref, after: state.sequence },
          { signal: abort.signal },
        ))
          render(event)
      })().catch((error) => {
        if (!abort.signal.aborted)
          input.write(`Connection interrupted: ${errorMessage(error)}. Reconnecting from the last recorded event.`)
      })
      if (abort.signal.aborted) return
      await timers.setTimeout(1000, undefined, { signal: abort.signal }).catch(() => {})
    }
  }
  const poll = async () => {
    while (!abort.signal.aborted) {
      await timers.setTimeout(1500, undefined, { signal: abort.signal }).catch(() => {})
      if (abort.signal.aborted) return
      await status().catch((error) => {
        if (!abort.signal.aborted) input.write(`Status unavailable: ${errorMessage(error)}`)
      })
    }
  }
  const pending = Promise.all([watch(), poll()])
  return {
    sessionID: session.id,
    line,
    interrupt: () => {
      state.refresh++
      return input.client.sessions.interrupt(ref, options())
    },
    async close() {
      abort.abort()
      await withTimeout(pending, 2000, "Closing the terminal event stream timed out").catch((error) =>
        input.write(errorMessage(error)),
      )
    },
  }
}

export function model(value: string) {
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) throw new Error("Use provider/model, for example openai/gpt-5.")
  return { providerID: value.slice(0, slash), id: value.slice(slash + 1) }
}

function answers(request: QuestionsListOutput[number], text: string) {
  const values = text.split(";").map((value) => value.trim())
  if (values.length !== request.questions.length || values.some((value) => !value))
    throw new Error("Answer each question in order, separated by semicolons.")
  return request.questions.map((question, index) => {
    const value = values[index]
    if (!/^\d+(\s*,\s*\d+)*$/.test(value)) {
      if (question.custom === false) throw new Error("Choose a listed option number for this question.")
      return [value]
    }
    const selected = [...new Set(value.split(",").map(Number))]
    if (!question.multiple && selected.length !== 1) throw new Error("This question accepts one option.")
    return selected.map((index) => {
      const option = question.options[index - 1]
      if (!option) throw new Error("Choose a listed option number.")
      return option.label
    })
  })
}

export * as DesignTerminal from "./design-terminal"
