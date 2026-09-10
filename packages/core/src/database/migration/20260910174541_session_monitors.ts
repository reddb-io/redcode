import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260910174541_session_monitors",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_monitor\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`owner\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_monitor_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_monitor_session_idx\` ON \`session_monitor\` (\`session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
