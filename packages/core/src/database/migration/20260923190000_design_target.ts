import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260923190000_design_target",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`design_document\` ADD \`target\` text DEFAULT 'web' NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`design_document\` ADD \`platform\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
