import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261001170713_intelligence-observation",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`intelligence_evaluation\` ADD \`mode\` text;`)
    })
  },
}

export default migration
