import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260907054831_design_studio",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`design_asset\` (
          \`id\` text PRIMARY KEY,
          \`design_id\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_design_asset_design_id_design_document_id_fk\` FOREIGN KEY (\`design_id\`) REFERENCES \`design_document\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`design_document\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`data\` text NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`design_feedback\` (
          \`id\` text PRIMARY KEY,
          \`design_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`admitted\` integer DEFAULT false NOT NULL,
          CONSTRAINT \`fk_design_feedback_design_id_design_document_id_fk\` FOREIGN KEY (\`design_id\`) REFERENCES \`design_document\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`design_render_job\` (
          \`id\` text PRIMARY KEY,
          \`design_id\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_design_render_job_design_id_design_document_id_fk\` FOREIGN KEY (\`design_id\`) REFERENCES \`design_document\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`design_revision\` (
          \`id\` text PRIMARY KEY,
          \`design_id\` text NOT NULL,
          \`created\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_design_revision_design_id_design_document_id_fk\` FOREIGN KEY (\`design_id\`) REFERENCES \`design_document\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`design_document_session_idx\` ON \`design_document\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`design_revision_document_idx\` ON \`design_revision\` (\`design_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
