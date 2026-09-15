import { SessionPlan } from "@reddb-io/redcode-core/session/plan"
import { DESIGN_INSTRUCTIONS } from "@reddb-io/redcode-core/design/instructions"
import { DesignStudio } from "@/design/studio"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignContext } from "@reddb-io/redcode-core/design/context"
import { SystemContext } from "@reddb-io/redcode-core/system-context/index"
import path from "path"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "./schema"
import { Session } from "./session"
import { SessionGoal } from "./goal"
import { SessionTodo } from "@reddb-io/redcode-core/session/todo"
import { ToolInterrupted } from "@reddb-io/redcode-core/session/tool-interrupted"
import { Todo } from "./todo"
import { ProviderTransform } from "@/provider/transform"
import BUILD_SWITCH from "./prompt/build-switch.txt"
import PLAN_MODE from "./prompt/plan-mode.txt"

export const apply = Effect.fn("SessionReminders.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  agent: Agent.Info
  session: Session.Info
  /** The task list as reviewed for this step; omitted when the agent may not use todowrite. */
  todos?: ReadonlyArray<Todo.Info>
  /** An unattended run is nearly out of context: ask it once to wrap up. */
  wrapUp?: string
}) {
  const fsys = yield* FSUtil.Service
  const sessions = yield* Session.Service
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return undefined
  // Per-step reminders ride a synthetic user message after everything else instead of being
  // appended to the last real user message. That message is part of history on the next turn, so
  // text added to it changed bytes the provider had cached and re-billed the whole turn after it.
  // Kept out of the stored transcript and out of the step's `msgs`: tools read those to tell a
  // human prompt from an autonomous continuation.
  const trailing: SessionV1.WithParts = {
    info: {
      id: MessageID.ascending(),
      sessionID: userMessage.info.sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: (userMessage.info as SessionV1.User).agent,
      model: (userMessage.info as SessionV1.User).model,
    } as SessionV1.User,
    parts: [],
  }
  // Tagged so the model reads it as harness context rather than a new request, and so provider
  // transforms can recognise the message and keep cache breakpoints off it.
  const result = () =>
    trailing.parts.length > 0
      ? {
          ...trailing,
          parts: trailing.parts.map((part) =>
            part.type === "text" ? { ...part, text: ProviderTransform.reminder(part.text) } : part,
          ),
        }
      : undefined

  // A turn that follows a cancelled or interrupted one hears about it here, not in history: the
  // tool calls that turn left behind read as cancelled, and the model is told to check before
  // repeating a side effect. Recomputed each step, so it never lands in the cached prefix.
  {
    const index = input.messages.findLastIndex((msg) => msg.info.role === "user")
    const previous = input.messages.slice(0, index).findLast((msg) => msg.info.role === "assistant")
    if (previous?.info.role === "assistant" && previous.info.error?.name === "MessageAbortedError")
      trailing.parts.push({
        id: PartID.ascending(),
        messageID: trailing.info.id,
        sessionID: trailing.info.sessionID,
        type: "text",
        synthetic: true,
        text: ToolInterrupted.NOTE,
      })
  }

  // The goal is re-rendered from the session record on every step, so compaction can drop every
  // earlier copy and the model still reads the objective as it was set — and the turn it is on.
  const current = yield* sessions.get(input.session.id).pipe(Effect.orElseSucceed(() => input.session))
  const goal = SessionGoal.fromMetadata(current.metadata)
  if (goal?.status === "active") {
    trailing.parts.push({
      id: PartID.ascending(),
      messageID: trailing.info.id,
      sessionID: trailing.info.sessionID,
      type: "text",
      text: SessionGoal.render(goal),
      synthetic: true,
    })
  }

  // Rides the trailing reminder like everything else here, so the cached prefix stays untouched.
  if (input.wrapUp)
    trailing.parts.push({
      id: PartID.ascending(),
      messageID: trailing.info.id,
      sessionID: trailing.info.sessionID,
      type: "text",
      text: input.wrapUp,
      synthetic: true,
    })

  // Task state used to sit in the system prompt, where every todowrite rewrote it and threw away
  // the provider's cached prefix for the next request. Rendered here it rides the trailing
  // reminder like the goal, and the system prompt only changes when something durable does.
  if (input.todos)
    trailing.parts.push({
      id: PartID.ascending(),
      messageID: trailing.info.id,
      sessionID: trailing.info.sessionID,
      type: "text",
      synthetic: true,
      text: SessionTodo.context(input.todos),
    })

  if (["plan", "build"].includes(input.agent.name)) {
    const plans = yield* SessionPlan.Service
    const guidance = SessionPlan.guidance(yield* plans.list(input.session.id))
    if (guidance)
      trailing.parts.push({
        id: PartID.ascending(),
        messageID: trailing.info.id,
        sessionID: trailing.info.sessionID,
        type: "text",
        synthetic: true,
        text: guidance,
      })
  }

  if (["design", "plan", "build"].includes(input.agent.name)) {
    const studio = yield* DesignStudio.Service
    const context = yield* studio.use(
      DesignContext.load(input.session.id).pipe(Effect.flatMap(SystemContext.initialize)),
    )
    if (context.baseline)
      trailing.parts.push({
        id: PartID.ascending(),
        messageID: trailing.info.id,
        sessionID: trailing.info.sessionID,
        type: "text",
        synthetic: true,
        text: context.baseline,
      })
  }

  if (input.agent.name === "design") {
    const studio = yield* DesignStudio.Service
    const documents = yield* studio.use(DesignStore.Service.use((store) => store.list(input.session.id)))
    trailing.parts.push({
      id: PartID.ascending(),
      messageID: trailing.info.id,
      sessionID: trailing.info.sessionID,
      type: "text",
      synthetic: true,
      text:
        DESIGN_INSTRUCTIONS +
        "\n\nThis is the current TUI conversation. Browser feedback and approval return here.\n" +
        (input.todos
          ? "Task tracking is on: update tasks by id and revision with only the changed fields, cite the callID of the design_preview, design_export or check that verified a task as evidence with an explanation (or omit it to record the newest preview, export or check after the last edit automatically), and read a refusal's inline candidate list instead of resending the completion.\n"
          : "") +
        documents
          .map(
            (document) =>
              `Design ${document.id}: ${document.name}; root ${document.root}; revision ${document.revision ?? "unpublished"}; ${document.ended ? "ended: do not reopen without the user asking" : "open"}`,
          )
          .join("\n"),
    })
    return result()
  }

  if (input.agent.name !== "plan") {
    if (
      input.agent.name === "build" &&
      input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    )
      trailing.parts.push({
        id: PartID.ascending(),
        messageID: trailing.info.id,
        sessionID: trailing.info.sessionID,
        type: "text",
        synthetic: true,
        text: BUILD_SWITCH,
      })
    return result()
  }

  const ctx = yield* InstanceState.context
  const plan = yield* Session.preparePlan(input.session, ctx)
  const exists = yield* fsys.existsSafe(plan)
  if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
  trailing.parts.push({
    id: PartID.ascending(),
    messageID: trailing.info.id,
    sessionID: trailing.info.sessionID,
    type: "text",
    synthetic: true,
    text: PLAN_MODE.replace("${planInfo}", () =>
      exists
        ? `A plan file already exists at ${plan}. Read it before making incremental edits.`
        : `Save your complete plan at ${plan} using the write tool before calling plan_exit. A plan written only in chat cannot be approved for execution.`,
    ),
  })
  return result()
})

export * as SessionReminders from "./reminders"
