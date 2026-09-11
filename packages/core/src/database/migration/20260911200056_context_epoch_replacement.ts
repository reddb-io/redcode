import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260911200056_context_epoch_replacement",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_context_epoch\` ADD \`replacement_seq\` integer;`)
    })
  },
} satisfies DatabaseMigration.Migration
