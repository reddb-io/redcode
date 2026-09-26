import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260926140214_redcode-legacy-state",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`redcode_session_context_epoch\` (
          \`session_id\` text PRIMARY KEY,
          \`baseline\` text NOT NULL,
          \`snapshot\` text NOT NULL,
          \`baseline_seq\` integer NOT NULL,
          \`replacement_seq\` integer,
          CONSTRAINT \`fk_redcode_session_context_epoch_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`redcode_session_input\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`admitted_seq\` integer NOT NULL,
          \`promoted_seq\` integer,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_redcode_session_input_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
}

export default migration
