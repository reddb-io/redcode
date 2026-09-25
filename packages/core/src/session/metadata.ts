export * as SessionMetadata from "./metadata"

import { eq } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { SessionV1 } from "../v1/session"
import { SessionSchema } from "./schema"
import { SessionTable } from "./sql"

type DatabaseService = Database.Interface["db"]

/**
 * Changes a Session's free-form metadata through the event log, as legacy's `Session.updateMetadata`
 * does: `session.updated` carries the whole record and its projector writes all of it back, so the
 * read and the write share one transaction and a change made meanwhile is never overwritten from a
 * stale read. Both runtimes and every surface hear of it through that event.
 *
 * `fn` returning the metadata it was given changes nothing and publishes nothing.
 */
export const update = Effect.fn("SessionMetadata.update")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  fn: (metadata: Record<string, unknown> | undefined) => Record<string, unknown> | undefined,
) {
  return yield* db
    .transaction(() =>
      Effect.gen(function* () {
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()
        if (!row) return undefined
        const current = row.metadata ?? undefined
        const metadata = fn(current)
        if (metadata === current) return current
        const record = info(row)
        yield* events.publish(SessionV1.Event.Updated, {
          sessionID,
          info: { ...record, metadata, time: { ...record.time, updated: Date.now() } },
        })
        return metadata
      }),
    )
    .pipe(Effect.orDie)
})

/** The legacy record of a Session row, which `session.updated` carries whole. */
function info(row: typeof SessionTable.$inferSelect): SessionV1.SessionInfo {
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    path: row.path ?? undefined,
    parentID: row.parent_id ?? undefined,
    title: row.title,
    agent: row.agent ?? undefined,
    model: row.model
      ? {
          id: ModelV2.ID.make(row.model.id),
          providerID: ProviderV2.ID.make(row.model.providerID),
          variant: row.model.variant,
        }
      : undefined,
    version: row.version,
    summary:
      row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
        ? {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
            diffs: row.summary_diffs ?? undefined,
          }
        : undefined,
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: { read: row.tokens_cache_read, write: row.tokens_cache_write },
    },
    share: row.share_url ? { url: row.share_url } : undefined,
    metadata: row.metadata ?? undefined,
    revert: row.revert
      ? {
          messageID: SessionV1.MessageID.make(row.revert.messageID),
          partID: row.revert.partID ? SessionV1.PartID.make(row.revert.partID) : undefined,
          snapshot: row.revert.snapshot,
          diff: row.revert.diff,
        }
      : undefined,
    permission: row.permission ? [...row.permission] : undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}
