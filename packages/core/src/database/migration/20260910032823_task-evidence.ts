import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260910032823_task-evidence",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`todo\` ADD \`details\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
