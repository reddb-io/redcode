import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261112210711_event_deliveries",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`event_delivery\` (
          \`seq\` integer PRIMARY KEY AUTOINCREMENT,
          \`subscription_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`payload\` text NOT NULL,
          CONSTRAINT \`fk_event_delivery_subscription_id_event_subscription_id_fk\` FOREIGN KEY (\`subscription_id\`) REFERENCES \`event_subscription\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`event_subscription\` (
          \`id\` text PRIMARY KEY,
          \`types\` text NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`event_delivery_subscription_seq_idx\` ON \`event_delivery\` (\`subscription_id\`,\`seq\`);`,
      )
    })
  },
}

export default migration
