import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260926220254_share-backend",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_share\` ADD \`resource\` text DEFAULT 'share' NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_share\` ADD \`account_id\` text;`)
      yield* tx.run(`ALTER TABLE \`session_share\` ADD \`org_id\` text;`)
    })
  },
}

export default migration
