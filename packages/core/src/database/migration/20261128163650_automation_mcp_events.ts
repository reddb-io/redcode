import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261128163650_automation_mcp_events",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_automation\` ADD \`event_source\` text;`)
      yield* tx.run(`ALTER TABLE \`session_automation\` ADD \`event_cursor\` text;`)
    })
  },
}

export default migration
