import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261013145858_reporter_delivery_destination",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`usage_reporter_delivery\` ADD \`destination\` text NOT NULL;`)
      yield* tx.run(`CREATE INDEX \`event_type_created_id_idx\` ON \`event\` (\`type\`,\`created\`,\`id\`);`)
    })
  },
}

export default migration
