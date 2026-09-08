import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260908001613_session_goals_plans",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_goal\` (
          \`session_id\` text PRIMARY KEY,
          \`goal_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`owner\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_goal_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_plan\` (
          \`session_id\` text NOT NULL,
          \`revision\` text NOT NULL,
          \`created\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`session_plan_pk\` PRIMARY KEY(\`session_id\`, \`revision\`),
          CONSTRAINT \`fk_session_plan_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
