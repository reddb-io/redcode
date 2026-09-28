export * as DesignConversations from "./conversations.js"

import { Design } from "@opencode/schema/design"
import { AbsolutePath } from "@opencode/schema/schema"
import { and, desc, eq, isNotNull, or } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database.js"
import { SessionTable } from "../session/sql.js"
import { DesignTable } from "./sql.js"

export const list = Effect.fn("DesignConversations.list")(function* (directory: AbsolutePath) {
  const database = yield* Database.Service
  const rows = yield* database.db
    .select({
      sessionID: SessionTable.id,
      title: SessionTable.title,
      slug: SessionTable.slug,
      updated: SessionTable.time_updated,
      designID: DesignTable.id,
      design: DesignTable.data,
    })
    .from(SessionTable)
    .leftJoin(DesignTable, eq(DesignTable.session_id, SessionTable.id))
    .where(and(eq(SessionTable.directory, directory), or(eq(SessionTable.agent, "design"), isNotNull(DesignTable.id))))
    .orderBy(desc(SessionTable.time_updated))
    .all()
    .pipe(Effect.orDie)
  const conversations = Map.groupBy(rows, (row) => row.sessionID)
  return yield* Schema.decodeUnknownEffect(Schema.Array(Design.Conversation))(
    Array.from(conversations.values(), (items) => ({
      sessionID: items[0].sessionID,
      title: items[0].title ?? items[0].slug,
      updated: items[0].updated,
      designs: items.flatMap((row) =>
        row.design
          ? [
              {
                id: row.designID,
                name: row.design.name,
                revision: row.design.revision,
                approvedRevision: row.design.approvedRevision,
                ended: row.design.ended,
              },
            ]
          : [],
      ),
    })),
  ).pipe(Effect.mapError(() => new Design.Error({ code: "invalid", message: "Invalid stored Design conversation" })))
})
