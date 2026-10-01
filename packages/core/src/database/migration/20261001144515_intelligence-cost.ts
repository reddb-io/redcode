import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261001144515_intelligence-cost",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`intelligence_evaluation\` ADD \`cost\` real;`)
      yield* tx.run(`ALTER TABLE \`intelligence_evaluation\` ADD \`unpriced_cost\` integer;`)
    })
  },
}

export default migration
