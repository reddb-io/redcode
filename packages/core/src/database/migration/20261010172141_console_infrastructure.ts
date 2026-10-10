import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261010172141_console_infrastructure",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`console_infrastructure_grant\` (
          \`id\` text PRIMARY KEY,
          \`resource_id\` text NOT NULL,
          \`workspace_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          CONSTRAINT \`fk_console_infrastructure_grant_resource_id_console_infrastructure_resource_id_fk\` FOREIGN KEY (\`resource_id\`) REFERENCES \`console_infrastructure_resource\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_console_infrastructure_grant_workspace_id_console_workspace_id_fk\` FOREIGN KEY (\`workspace_id\`) REFERENCES \`console_workspace\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_infrastructure_audit\` (
          \`id\` text PRIMARY KEY,
          \`owner_id\` text NOT NULL,
          \`actor_id\` text NOT NULL,
          \`action\` text NOT NULL,
          \`resource_id\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_console_infrastructure_audit_owner_id_console_infrastructure_owner_id_fk\` FOREIGN KEY (\`owner_id\`) REFERENCES \`console_infrastructure_owner\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_infrastructure_member\` (
          \`owner_id\` text NOT NULL,
          \`account_id\` text NOT NULL,
          \`role\` text NOT NULL,
          CONSTRAINT \`console_infrastructure_member_pk\` PRIMARY KEY(\`owner_id\`, \`account_id\`),
          CONSTRAINT \`fk_console_infrastructure_member_owner_id_console_infrastructure_owner_id_fk\` FOREIGN KEY (\`owner_id\`) REFERENCES \`console_infrastructure_owner\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_console_infrastructure_member_account_id_console_account_id_fk\` FOREIGN KEY (\`account_id\`) REFERENCES \`console_account\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_infrastructure_owner\` (
          \`id\` text PRIMARY KEY,
          \`name\` text NOT NULL,
          \`created_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_infrastructure_resource\` (
          \`id\` text PRIMARY KEY,
          \`owner_id\` text NOT NULL,
          \`name\` text NOT NULL,
          CONSTRAINT \`fk_console_infrastructure_resource_owner_id_console_infrastructure_owner_id_fk\` FOREIGN KEY (\`owner_id\`) REFERENCES \`console_infrastructure_owner\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`console_infrastructure_directory\` ON \`console_infrastructure_grant\` (\`resource_id\`,\`directory\`);`,
      )
    })
  },
}

export default migration
