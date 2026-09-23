export * as DesignConversations from "./conversations"

import { and, eq, isNotNull, isNull, or } from "drizzle-orm"
import { Effect } from "effect"
import type { Design } from "@reddb-io/redcode-schema/design"
import { Database } from "../database/database"
import { FSUtil } from "../fs-util"
import { SessionTable } from "../session/sql"
import { DesignTable } from "./sql"

/**
 * The unarchived conversations of one directory that own a design or run in Design mode, newest first.
 * Read from the database alone, so any process sharing it answers the same list.
 */
export const list = Effect.fn("DesignConversations.list")(function* (directory: string) {
  const db = yield* Database.Service
  const resolved = FSUtil.resolve(directory)
  const rows = yield* db.db
    .select({
      sessionID: SessionTable.id,
      title: SessionTable.title,
      updated: SessionTable.time_updated,
      design: DesignTable.data,
    })
    .from(SessionTable)
    .leftJoin(DesignTable, and(eq(SessionTable.id, DesignTable.session_id), eq(DesignTable.directory, resolved)))
    .where(
      and(
        eq(SessionTable.directory, resolved),
        isNull(SessionTable.time_archived),
        or(isNotNull(DesignTable.id), eq(SessionTable.agent, "design")),
      ),
    )
    .all()
    .pipe(Effect.orDie)
  const conversations = rows.reduce((result, row) => {
    const current = result.get(row.sessionID)
    result.set(row.sessionID, {
      sessionID: row.sessionID,
      title: row.title,
      updated: Math.max(current?.updated ?? 0, row.updated, row.design?.updated ?? 0),
      designs: [
        ...(current?.designs ?? []),
        ...(row.design
          ? [
              {
                id: row.design.id,
                name: row.design.name,
                revision: row.design.revision,
                approvedRevision: row.design.approvedRevision,
                ended: row.design.ended,
              },
            ]
          : []),
      ],
    })
    return result
  }, new Map<string, Design.Conversation>())
  return [...conversations.values()].sort((a, b) => b.updated - a.updated)
})
