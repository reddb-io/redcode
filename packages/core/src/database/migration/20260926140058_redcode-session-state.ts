import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260926140058_redcode-session-state",
  up(tx) {
    return Effect.gen(function* () {
      // V1 Redcode stores these names against `session`. Keep those rows for the
      // session importer; V2 owns the same names against `session_v2`.
      if (yield* tx.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`)) {
        if (yield* tx.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_share'`))
          yield* tx.run(`ALTER TABLE \`session_share\` RENAME TO \`redcode_v1_session_share\`;`)
        if (yield* tx.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'todo'`)) {
          yield* tx.run(`DROP INDEX IF EXISTS \`todo_session_idx\`;`)
          yield* tx.run(`ALTER TABLE \`todo\` RENAME TO \`redcode_v1_todo\`;`)
        }
      }
      yield* tx.run(`
        CREATE TABLE \`session_goal_review\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`goal_id\` text NOT NULL,
          \`tokens\` integer NOT NULL,
          \`created\` integer NOT NULL,
          CONSTRAINT \`fk_session_goal_review_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_goal\` (
          \`session_id\` text PRIMARY KEY,
          \`goal_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`owner\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_goal_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
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
      yield* tx.run(`
        CREATE TABLE \`session_plan\` (
          \`session_id\` text NOT NULL,
          \`revision\` text NOT NULL,
          \`created\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`session_plan_pk\` PRIMARY KEY(\`session_id\`, \`revision\`),
          CONSTRAINT \`fk_session_plan_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_share\` (
          \`session_id\` text PRIMARY KEY,
          \`id\` text NOT NULL,
          \`secret\` text NOT NULL,
          \`url\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_share_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`todo_history\` (
          \`session_id\` text NOT NULL,
          \`task_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`data\` text NOT NULL,
          \`created\` integer NOT NULL,
          CONSTRAINT \`todo_history_pk\` PRIMARY KEY(\`session_id\`, \`task_id\`, \`revision\`),
          CONSTRAINT \`fk_todo_history_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`todo\` (
          \`session_id\` text NOT NULL,
          \`content\` text NOT NULL,
          \`status\` text NOT NULL,
          \`priority\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`task_id\` text,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`reason\` text,
          \`legacy_status\` text,
          \`details\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`todo_pk\` PRIMARY KEY(\`session_id\`, \`position\`),
          CONSTRAINT \`fk_todo_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_goal_review_session_goal_idx\` ON \`session_goal_review\` (\`session_id\`,\`goal_id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_guard_trip_session_idx\` ON \`session_guard_trip\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_guard_trip_created_idx\` ON \`session_guard_trip\` (\`time_created\`);`)
      yield* tx.run(`CREATE INDEX \`todo_session_idx\` ON \`todo\` (\`session_id\`);`)
    })
  },
}

export default migration
