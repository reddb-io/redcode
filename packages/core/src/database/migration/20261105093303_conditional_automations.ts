import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261105093303_conditional_automations",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_automation_run\` ADD \`condition_result\` text;`)
      yield* tx.run(`ALTER TABLE \`session_automation\` ADD \`condition\` text;`)
    })
  },
}

export default migration
