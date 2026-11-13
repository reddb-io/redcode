import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261113175602_automation_delivery_result",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_automation_run\` ADD \`delivery_result\` text;`)
    })
  },
}

export default migration
