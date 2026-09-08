import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260908015235_goal_review_usage",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_goal_review\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`goal_id\` text NOT NULL,
          \`tokens\` integer NOT NULL,
          \`created\` integer NOT NULL,
          CONSTRAINT \`fk_session_goal_review_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_goal_review_session_goal_idx\` ON \`session_goal_review\` (\`session_id\`,\`goal_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
