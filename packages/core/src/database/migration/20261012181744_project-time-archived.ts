import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261012181744_project-time-archived",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`project\` ADD \`time_archived\` integer;`)
    })
  },
}

export default migration
