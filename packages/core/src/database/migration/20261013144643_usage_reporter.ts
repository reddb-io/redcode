import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261013144643_usage_reporter",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`usage_reporter_config\` (
          \`id\` text PRIMARY KEY,
          \`instance_id\` text NOT NULL,
          \`enabled\` integer NOT NULL,
          \`transport\` text NOT NULL,
          \`url\` text NOT NULL,
          \`queue\` text NOT NULL,
          \`credential_id\` text,
          \`since\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`usage_reporter_delivery\` (
          \`id\` text PRIMARY KEY,
          \`status\` text NOT NULL,
          \`attempts\` integer DEFAULT 0 NOT NULL,
          \`next_attempt_at\` integer NOT NULL,
          \`lease\` text,
          \`lease_until\` integer,
          \`http_status\` integer,
          \`error\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`usage_reporter_record\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`created\` integer NOT NULL,
          \`data\` text NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`usage_reporter_delivery_due_idx\` ON \`usage_reporter_delivery\` (\`status\`,\`next_attempt_at\`);`,
      )
      yield* tx.run(`CREATE INDEX \`usage_reporter_record_session_idx\` ON \`usage_reporter_record\` (\`session_id\`);`)
    })
  },
}

export default migration
