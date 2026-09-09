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
import { PartID } from "./schema"
import { Session } from "./session"
import { SessionGoal } from "./goal"
import BUILD_SWITCH from "./prompt/build-switch.txt"
import PLAN_MODE from "./prompt/plan-mode.txt"

export const apply = Effect.fn("SessionReminders.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const fsys = yield* FSUtil.Service
  const sessions = yield* Session.Service
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

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

  if (["plan", "build"].includes(input.agent.name)) {
    const plans = yield* SessionPlan.Service
    const guidance = SessionPlan.guidance(yield* plans.list(input.session.id))
    if (guidance)
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
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
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        synthetic: true,
        text: context.baseline,
      })
  }

  if (input.agent.name === "design") {
    const studio = yield* DesignStudio.Service
    const documents = yield* studio.use(DesignStore.Service.use((store) => store.list(input.session.id)))
    userMessage.parts.push({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      synthetic: true,
      text:
        DESIGN_INSTRUCTIONS +
        "\n\nThis is the current TUI conversation. Browser feedback and approval return here.\n" +
        documents
          .map(
            (document) =>
              `Design ${document.id}: ${document.name}; root ${document.root}; revision ${document.revision ?? "unpublished"}; ${document.ended ? "ended: do not reopen without the user asking" : "open"}`,
          )
          .join("\n"),
    })
    return input.messages
  }

  if (input.agent.name !== "plan") {
    if (
      input.agent.name === "build" &&
      input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    )
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        synthetic: true,
        text: BUILD_SWITCH,
      })
    return input.messages
  }

  const ctx = yield* InstanceState.context
  const plan = yield* Session.preparePlan(input.session, ctx)
  const exists = yield* fsys.existsSafe(plan)
  if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
  userMessage.parts.push({
    id: PartID.ascending(),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    synthetic: true,
    text: PLAN_MODE.replace("${planInfo}", () =>
      exists
        ? `A plan file already exists at ${plan}. Read it before making incremental edits.`
        : `Save your complete plan at ${plan} using the write tool before calling plan_exit. A plan written only in chat cannot be approved for execution.`,
    ),
  })
  return input.messages
})

export * as SessionReminders from "./reminders"
