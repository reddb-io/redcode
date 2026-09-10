import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260910022338_task-tracking",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`todo_history\` (
          \`session_id\` text NOT NULL,
          \`task_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`data\` text NOT NULL,
          \`created\` integer NOT NULL,
          CONSTRAINT \`todo_history_pk\` PRIMARY KEY(\`session_id\`, \`task_id\`, \`revision\`),
          CONSTRAINT \`fk_todo_history_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`ALTER TABLE \`todo\` ADD \`task_id\` text;`)
      yield* tx.run(`ALTER TABLE \`todo\` ADD \`revision\` integer DEFAULT 1 NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`todo\` ADD \`reason\` text;`)
      yield* tx.run(`ALTER TABLE \`todo\` ADD \`legacy_status\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
