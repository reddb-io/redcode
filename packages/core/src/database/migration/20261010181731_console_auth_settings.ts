import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261010181731_console_auth_settings",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`console_auth_provider\` (
          \`id\` text PRIMARY KEY,
          \`scope_kind\` text NOT NULL,
          \`scope_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`issuer\` text NOT NULL,
          \`client_id\` text NOT NULL,
          \`token_auth_method\` text NOT NULL,
          \`credential_id\` text,
          \`enabled\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_auth_setting\` (
          \`id\` text PRIMARY KEY,
          \`public_url\` text NOT NULL
        );
      `)
      yield* tx.run(`ALTER TABLE \`console_federation_attempt\` ADD \`scope_kind\` text;`)
      yield* tx.run(`ALTER TABLE \`console_federation_attempt\` ADD \`scope_id\` text;`)
    })
  },
}

export default migration
