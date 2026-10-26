import { expect } from "bun:test"
import { Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRequestContext } from "@opencode/core/session/request-context"
import { IntelligenceCodeRepair } from "@opencode/core/intelligence/code-repair"
import { IntelligenceResponse } from "@opencode/core/intelligence/response"
import { SessionMessageTable } from "@opencode/core/session/sql"
import { VaultRestricted } from "@opencode/core/vault/restricted"
import { Project } from "@opencode/schema/project"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionMessage } from "@opencode/schema/session-message"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)
const sessionID = Session.ID.make("ses_requests")
const otherID = Session.ID.make("ses_other")

const seed = Effect.gen(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const directory = AbsolutePath.make("/project")
  yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: directory, sandboxes: [] }).run()
  yield* Effect.forEach([sessionID, otherID], (id) =>
    bus.publish(SessionEvent.Created, {
      sessionID: id,
      projectID: Project.ID.global,
      location: { directory },
      slug: "request-context",
      version: "test",
    }),
  )
  return database.db
})

it.effect("keeps the original contract and correction before continue, excluding later and foreign requests", () =>
  Effect.gen(function* () {
    const db = yield* seed
    yield* db
      .insert(SessionMessageTable)
      .values(
        [
          "Fix recovery without selecting providers",
          "Correction: preserve the selected account",
          "continue",
          "New topic",
        ]
          .map((text, index) => ({
            id: SessionMessage.ID.make(`msg_${index}`),
            session_id: sessionID,
            type: "user" as const,
            seq: index + 1,
            data: { text, time: { created: index } },
          }))
          .concat({
            id: SessionMessage.ID.make("msg_foreign"),
            session_id: otherID,
            type: "user",
            seq: 1,
            data: { text: "Do not leak across sessions", time: { created: 0 } },
          }),
      )
      .run()
    const context = yield* SessionRequestContext.load(db, {
      sessionID,
      requestID: SessionMessage.ID.make("msg_2"),
      excluded: new Set(),
      scrub: (text) => text,
    })
    expect(context?.messages.map((message) => message.text.content)).toEqual([
      "Fix recovery without selecting providers",
      "Correction: preserve the selected account",
      "continue",
    ])
    expect(context?.olderOmitted).toBe(false)
    expect(context?.through).toBe(SessionMessage.ID.make("msg_2"))
    expect(context?.policy).toContain("superseded topic")
    expect(
      yield* SessionRequestContext.load(db, {
        sessionID: otherID,
        requestID: SessionMessage.ID.make("msg_2"),
        excluded: new Set(),
        scrub: (text) => text,
      }),
    ).toBeUndefined()
  }),
)

it.effect("bounds long histories, redacts before clipping and retains retrieval provenance", () =>
  Effect.gen(function* () {
    const db = yield* seed
    yield* db
      .insert(SessionMessageTable)
      .values(
        Array.from({ length: 30 }, (_, index) => ({
          id: SessionMessage.ID.make(`msg_${index}`),
          session_id: sessionID,
          type: "user" as const,
          seq: index + 1,
          data: { text: `secret-value ${"long requirement ".repeat(1_000)} ${index}`, time: { created: index } },
        })),
      )
      .run()
    const context = yield* SessionRequestContext.load(db, {
      sessionID,
      requestID: SessionMessage.ID.make("msg_29"),
      excluded: new Set(["msg_28"]),
      scrub: (text) => text.replaceAll("secret-value", "{vault:credential}"),
    })
    expect(context?.messages).toHaveLength(SessionRequestContext.HISTORY + 2)
    expect(context?.messages.at(0)?.messageID).toBe(SessionMessage.ID.make("msg_0"))
    expect(context?.messages.at(-1)?.messageID).toBe(SessionMessage.ID.make("msg_29"))
    expect(context?.olderOmitted).toBe(true)
    expect(context?.messages.find((message) => message.messageID === "msg_28")?.text.content).toBe(
      VaultRestricted.WITHHELD,
    )
    expect(context?.messages.at(0)?.text).toMatchObject({ reference: "msg_0", truncated: true })
    expect(context?.retrieval.tool).toBe("session_history")
    expect(JSON.stringify(context)).not.toContain("secret-value")
    expect(JSON.stringify(context).length).toBeLessThan(14_000)
    const review = IntelligenceResponse.evaluation({
      sessionID,
      request: { id: "msg_29", text: "Latest request ".repeat(10_000) },
      requestContext: context,
      candidate: { id: "msg_candidate", text: "Candidate answer ".repeat(10_000) },
      attempt: 0,
      tools: { total: 100, calls: ["Evidence ".repeat(20_000)] },
      tasks: ["Applicable task ".repeat(10_000)],
      goal: "Goal criteria ".repeat(10_000),
      artifact: IntelligenceCodeRepair.artifact({
        from: "original",
        to: "candidate",
        files: Array.from({ length: 4 }, (_, index) => ({ file: `src/${index}.ts`, patch: "Patch ".repeat(10_000) })),
      }),
    })
    expect(
      JSON.stringify({ state: { sources: review.sources, candidate: review.candidate }, questions: review.questions })
        .length,
    ).toBeLessThanOrEqual(80_000)
  }),
)
