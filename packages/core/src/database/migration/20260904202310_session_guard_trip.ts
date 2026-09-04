import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260904202310_session_guard_trip",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_guard_trip\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`guard\` text NOT NULL,
          \`action\` text NOT NULL,
          \`subject\` text,
          \`detail\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_guard_trip_session_idx\` ON \`session_guard_trip\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_guard_trip_created_idx\` ON \`session_guard_trip\` (\`time_created\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
