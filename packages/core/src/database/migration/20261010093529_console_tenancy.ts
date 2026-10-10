import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261010093529_console_tenancy",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`console_account\` (
          \`id\` text PRIMARY KEY,
          \`email\` text NOT NULL UNIQUE,
          \`name\` text NOT NULL,
          \`password_hash\` text NOT NULL,
          \`created_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_audit\` (
          \`id\` text PRIMARY KEY,
          \`organization_id\` text NOT NULL,
          \`actor_id\` text NOT NULL,
          \`action\` text NOT NULL,
          \`resource_id\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_console_audit_organization_id_console_organization_id_fk\` FOREIGN KEY (\`organization_id\`) REFERENCES \`console_organization\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_invite\` (
          \`id\` text PRIMARY KEY,
          \`organization_id\` text NOT NULL,
          \`email\` text NOT NULL,
          \`role\` text NOT NULL,
          \`token_hash\` text NOT NULL UNIQUE,
          \`expires_at\` integer NOT NULL,
          CONSTRAINT \`fk_console_invite_organization_id_console_organization_id_fk\` FOREIGN KEY (\`organization_id\`) REFERENCES \`console_organization\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_key\` (
          \`id\` text PRIMARY KEY,
          \`workspace_id\` text NOT NULL,
          \`account_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`prefix\` text NOT NULL,
          \`token_hash\` text NOT NULL UNIQUE,
          \`created_at\` integer NOT NULL,
          \`expires_at\` integer,
          CONSTRAINT \`fk_console_key_workspace_id_console_workspace_id_fk\` FOREIGN KEY (\`workspace_id\`) REFERENCES \`console_workspace\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_console_key_account_id_console_account_id_fk\` FOREIGN KEY (\`account_id\`) REFERENCES \`console_account\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_member\` (
          \`organization_id\` text NOT NULL,
          \`account_id\` text NOT NULL,
          \`role\` text NOT NULL,
          CONSTRAINT \`console_member_pk\` PRIMARY KEY(\`organization_id\`, \`account_id\`),
          CONSTRAINT \`fk_console_member_organization_id_console_organization_id_fk\` FOREIGN KEY (\`organization_id\`) REFERENCES \`console_organization\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_console_member_account_id_console_account_id_fk\` FOREIGN KEY (\`account_id\`) REFERENCES \`console_account\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_organization\` (
          \`id\` text PRIMARY KEY,
          \`name\` text NOT NULL,
          \`created_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_session\` (
          \`token_hash\` text PRIMARY KEY,
          \`account_id\` text NOT NULL,
          \`expires_at\` integer NOT NULL,
          CONSTRAINT \`fk_console_session_account_id_console_account_id_fk\` FOREIGN KEY (\`account_id\`) REFERENCES \`console_account\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_workspace\` (
          \`id\` text PRIMARY KEY,
          \`organization_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_console_workspace_organization_id_console_organization_id_fk\` FOREIGN KEY (\`organization_id\`) REFERENCES \`console_organization\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`console_invite_email\` ON \`console_invite\` (\`organization_id\`,\`email\`);`,
      )
    })
  },
}

export default migration
