import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261010150140_console_federation",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`console_federation_attempt\` (
          \`state_hash\` text PRIMARY KEY,
          \`browser_hash\` text NOT NULL,
          \`provider_id\` text NOT NULL,
          \`issuer\` text NOT NULL,
          \`client_id\` text NOT NULL,
          \`verifier\` text NOT NULL,
          \`nonce\` text NOT NULL,
          \`invite_hash\` text,
          \`session_hash\` text,
          \`expires_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`console_identity\` (
          \`issuer\` text NOT NULL,
          \`subject\` text NOT NULL,
          \`account_id\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`console_identity_pk\` PRIMARY KEY(\`issuer\`, \`subject\`),
          CONSTRAINT \`fk_console_identity_account_id_console_account_id_fk\` FOREIGN KEY (\`account_id\`) REFERENCES \`console_account\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
}

export default migration
