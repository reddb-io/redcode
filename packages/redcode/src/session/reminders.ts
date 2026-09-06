import path from "path"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Session } from "./session"
import { DesignSystem } from "@/design/system"
import { SessionGoal } from "./goal"
import PROMPT_PLAN from "./prompt/plan.txt"
import BUILD_SWITCH from "./prompt/build-switch.txt"
import PLAN_MODE from "./prompt/plan-mode.txt"
import DESIGN_MODE from "./prompt/design-mode.txt"

export const apply = Effect.fn("SessionReminders.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const flags = yield* RuntimeFlags.Service
  const fsys = yield* FSUtil.Service
  const sessions = yield* Session.Service
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")

  // The goal is re-rendered from the session record on every step, so compaction can drop every
  // earlier copy and the model still reads the objective as it was set — and the turn it is on.
  const current = yield* sessions.get(input.session.id).pipe(Effect.orElseSucceed(() => input.session))
  const goal = SessionGoal.fromMetadata(current.metadata)
  if (goal?.status === "active") {
    userMessage.parts.push({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: SessionGoal.render(goal),
      synthetic: true,
    })
  }

  if (flags.experimentalDesignMode && input.agent.name === "design" && assistantMessage?.info.agent !== "design") {
    const ctx = yield* InstanceState.context
    const root = Session.design(input.session, ctx)
    const exists = yield* fsys.existsSafe(root)
    if (!exists) yield* fsys.ensureDir(root).pipe(Effect.catch(Effect.die))
    // What the project already looks like. A failed scan is a missing paragraph, not a failed turn.
    const system = yield* (yield* DesignSystem.Service)
      .summary()
      .pipe(
        Effect.catchCause(() =>
          Effect.succeed("The design system could not be read this turn; look for tokens and styled pages yourself."),
        ),
      )
    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: DESIGN_MODE.replace("${designInfo}", () =>
        exists
          ? `A design already exists at ${root}. Read what is there — including design.json — before changing it.`
          : `Build the prototype at ${root}, starting with index.html.`,
      ).replace("${designSystem}", () => system),
      synthetic: true,
    })
    userMessage.parts.push(part)
    return input.messages
  }

  if (!flags.experimentalPlanMode) {
    if (input.agent.name === "plan") {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: PROMPT_PLAN,
        synthetic: true,
      })
    }
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (wasPlan && input.agent.name === "build") {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: BUILD_SWITCH,
        synthetic: true,
      })
    }
    return input.messages
  }

  if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
    const ctx = yield* InstanceState.context
    const plan = Session.plan(input.session, ctx)
    const exists = yield* fsys.existsSafe(plan)
    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: exists
        ? `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`
        : BUILD_SWITCH,
      synthetic: true,
    })
    userMessage.parts.push(part)
    return input.messages
  }

  if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

  const ctx = yield* InstanceState.context
  const plan = Session.plan(input.session, ctx)
  const exists = yield* fsys.existsSafe(plan)
  if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
  const part = yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: PLAN_MODE.replace("${planInfo}", () =>
      exists
        ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.`
        : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`,
    ),
    synthetic: true,
  })
  userMessage.parts.push(part)
  return input.messages
})

export * as SessionReminders from "./reminders"
