export * as DesignHandoff from "./handoff"

import path from "node:path"
import { Effect } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignFiles } from "@reddb-io/redcode-core/design/files"
import { DesignStudio } from "./studio"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { SessionGoal } from "@/session/goal"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Provider } from "@/provider/provider"

/** Called only after approval of the exact revision in the browser or TUI question. */
export const approve = Effect.fn("DesignHandoff.approve")(function* (
  sessionID: SessionID,
  id: Design.ID,
  revision: string,
  variant?: Design.Variant,
) {
  const studio = yield* DesignStudio.Service
  const sessions = yield* Session.Service
  const provider = yield* Provider.Service
  const instance = yield* InstanceState.context
  return yield* studio.use(
    Effect.gen(function* () {
      const info = yield* studio.assertSession(sessionID)
      const store = yield* DesignStore.Service
      const document = yield* store.get(id, sessionID)
      const plan = yield* Session.preparePlan(info, instance)
      const begin = "<!-- redcode:design:start -->"
      const end = "<!-- redcode:design:end -->"
      const existing = yield* Effect.promise(async () => ((await Bun.file(plan).exists()) ? Bun.file(plan).text() : ""))
      const start = existing.indexOf(begin)
      const finish = existing.indexOf(end)
      if (start >= 0 !== finish >= 0 || (start >= 0 && finish < start))
        return yield* new Design.Error({
          code: "conflict",
          message: "The plan's Design section markers are incomplete",
        })
      const approved = yield* store.approve(id, revision, variant)
      const record = yield* store.approval(id, revision)
      const handoff = yield* Effect.promise(() => Bun.file(approved.plan).text())
      const block = handoff.slice(handoff.indexOf(begin), handoff.indexOf(end) + end.length)
      yield* Effect.promise(async () => {
        const { mkdir } = await import("node:fs/promises")
        await mkdir(path.dirname(plan), { recursive: true })
        await DesignFiles.atomic(
          plan,
          start >= 0
            ? existing.slice(0, start) + block + existing.slice(finish + end.length)
            : [existing.trimEnd(), block, ""].filter((value, index) => value || index > 0).join("\n\n"),
        )
      })
      const goal = SessionGoal.fromMetadata((yield* sessions.get(sessionID)).metadata)
      if (goal?.status === "active" && goal.stopAfter === "design")
        return { ...approved, plan, agent: "design" as const, resume: false }
      // A repeated browser acknowledgement must not insert another handoff message.
      if (document.approvedRevision === revision && info.agent === "plan")
        return { ...approved, plan, agent: "plan" as const, resume: false }
      const messages = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
      const last = messages.findLast((message) => message.info.role === "user")
      const model = last?.info.role === "user" ? last.info.model : yield* provider.defaultModel()
      const messageID = MessageID.ascending()
      yield* sessions.updateMessage({
        id: messageID,
        sessionID,
        role: "user",
        agent: "plan",
        model,
        time: { created: Date.now() },
      })
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID,
        sessionID,
        type: "text",
        synthetic: true,
        metadata: { designApproval: { id, name: record.revision.document.name, revision, variant: record.variant } },
        text: `Design ${record.revision.document.name}, revision ${revision}${variant ? `, variant ${variant.name} (${variant.id})` : ""}, approved. Continue in Plan. Approved decisions and constraints are supplied automatically in context. Details: design_read {"id":"${id}","revision":"${revision}"}. Plan: ${plan}. Open review with /design-review.`,
      })
      yield* sessions.setAgentModel({
        sessionID,
        agent: "plan",
        model: { id: model.modelID, providerID: model.providerID },
        time: Date.now(),
      })
      return { ...approved, plan, agent: "plan" as const, resume: true }
    }).pipe(studio.handoff),
  )
})
