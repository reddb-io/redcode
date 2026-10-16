import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261016023802_worker_lease",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`worker_assignment\` (
          \`session_id\` text PRIMARY KEY,
          \`directory\` text NOT NULL,
          \`generation\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`worker_lease\` (
          \`directory\` text PRIMARY KEY,
          \`generation\` integer NOT NULL,
          \`owner\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`message_id\` text NOT NULL,
          \`expires_at\` integer NOT NULL,
          \`released\` integer DEFAULT false NOT NULL,
          \`operations\` text NOT NULL
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`execution_directory\` text;`)
    })
  },
}

export default migration
