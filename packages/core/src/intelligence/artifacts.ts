export * as IntelligenceArtifacts from "./artifacts.js"

import { Intelligence } from "@opencode/schema/intelligence"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database.js"
import { KVTable } from "../kv/sql.js"
import { IntelligenceEvaluation } from "./evaluation.js"

const PREFIX = "redcode.intelligence.artifact."
const make = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const decode = (value: unknown) =>
    Schema.decodeUnknownEffect(Intelligence.Artifact)(value).pipe(
      Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Invalid reasoning artifact" })),
    )

  const save = Effect.fn("IntelligenceArtifacts.save")(function* (artifact: Intelligence.Artifact) {
    const value = yield* Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)(JSON.stringify(artifact)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
      Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Invalid reasoning artifact" })),
    )
    yield* db
      .insert(KVTable)
      .values({ key: PREFIX + artifact.id, value })
      .onConflictDoUpdate({ target: KVTable.key, set: { value } })
      .run()
      .pipe(Effect.orDie)
    return artifact
  })

  const get = Effect.fn("IntelligenceArtifacts.get")(function* (sessionID: string, id: string) {
    const row = yield* db
      .select()
      .from(KVTable)
      .where(eq(KVTable.key, PREFIX + id))
      .get()
      .pipe(Effect.orDie)
    if (!row) return yield* new IntelligenceEvaluation.Error({ message: "Reasoning artifact not found" })
    const artifact = yield* decode(row.value)
    if (artifact.sessionID !== sessionID)
      return yield* new IntelligenceEvaluation.Error({ message: "Reasoning artifact not found in this Session" })
    return artifact
  })

  const list = Effect.fn("IntelligenceArtifacts.list")(function* (sessionID: string) {
    const rows = yield* db
      .select()
      .from(KVTable)
      .where(sql`${KVTable.key} like ${PREFIX + "%"} AND json_extract(${KVTable.value}, '$.sessionID') = ${sessionID}`)
      .orderBy(sql`json_extract(${KVTable.value}, '$.created') DESC`)
      .limit(100)
      .all()
      .pipe(Effect.orDie)
    const artifacts = yield* Effect.forEach(rows, (row) => decode(row.value))
    return artifacts
  })

  // Approval marks a proposal for export; it never installs a memory or a skill.
  const review = Effect.fn("IntelligenceArtifacts.review")(function* (
    sessionID: string,
    id: string,
    change: Intelligence.LearningReview,
  ) {
    const artifact = yield* get(sessionID, id)
    if (artifact.type !== "learning")
      return yield* new IntelligenceEvaluation.Error({ message: "Only a learning candidate can be reviewed" })
    return yield* save({
      ...artifact,
      status: change.status,
      ...(change.reason === undefined ? {} : { reason: change.reason }),
    })
  })
  return { save, get, list, review }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "@redcode/IntelligenceArtifacts",
) {}
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [Database.node] })
