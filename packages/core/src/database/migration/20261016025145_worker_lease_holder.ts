import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261016025145_worker_lease_holder",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`worker_lease\` ADD \`holder\` text NOT NULL;`)
    })
  },
}

export default migration
