import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261026223833_session_automations",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_automation_run\` (
          \`id\` text PRIMARY KEY,
          \`automation_id\` text NOT NULL,
          \`trigger\` text NOT NULL,
          \`scheduled_at\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`owner\` text NOT NULL,
          \`error\` text,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          CONSTRAINT \`fk_session_automation_run_automation_id_session_automation_id_fk\` FOREIGN KEY (\`automation_id\`) REFERENCES \`session_automation\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_automation\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`schedule\` text NOT NULL,
          \`enabled\` integer NOT NULL,
          \`next_at\` integer,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          CONSTRAINT \`fk_session_automation_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_automation_run_status_idx\` ON \`session_automation_run\` (\`status\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_automation_run_history_idx\` ON \`session_automation_run\` (\`automation_id\`,\`created_at\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_automation_due_idx\` ON \`session_automation\` (\`enabled\`,\`next_at\`);`)
      yield* tx.run(`CREATE INDEX \`session_automation_session_idx\` ON \`session_automation\` (\`session_id\`);`)
    })
  },
}

export default migration
