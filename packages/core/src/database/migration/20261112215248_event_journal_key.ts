import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261112215248_event_journal_key",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`event_journal_key\` (
          \`id\` integer PRIMARY KEY,
          \`digest\` text NOT NULL
        );
      `)
    })
  },
}

export default migration
