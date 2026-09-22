import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260922120923_intelligence-attempts",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`intelligence_evaluation_fingerprint_idx\`;`)
      yield* tx.run(
        `CREATE INDEX \`intelligence_evaluation_fingerprint_lookup_idx\` ON \`intelligence_evaluation\` (\`fingerprint\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
