import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261010173240_infrastructure_resource_origins",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`console_infrastructure_resource\` ADD \`url\` text;`)
    })
  },
}

export default migration
