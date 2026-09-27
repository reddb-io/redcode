import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260927170000_redcode-worktrees",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        INSERT OR IGNORE INTO \`worktree\` (\`project_id\`, \`directory\`, \`strategy\`, \`time_created\`)
        SELECT
          \`project_id\`,
          \`directory\`,
          CASE
            WHEN \`strategy\` = 'git_worktree' THEN 'git'
            WHEN \`strategy\` IS NOT NULL THEN \`strategy\`
            WHEN \`type\` = 'git_worktree' THEN 'git'
          END,
          \`time_created\`
        FROM \`project_directory\`;
      `)
    })
  },
}

export default migration
