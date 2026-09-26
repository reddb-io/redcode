import { EOL } from "node:os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { project } from "./shared"

export default Runtime.handler(
  Commands.commands.worktrees.commands.list,
  Effect.fn("cli.worktrees.list")(function* (args) {
    const context = yield* project()
    const entries = yield* Effect.promise(() => context.client.worktree.list({ projectID: context.projectID }))
    process.stdout.write(args.json
      ? JSON.stringify(entries, null, 2) + EOL
      : entries.map((entry) => `${entry.directory}${entry.strategy ? `  ${entry.strategy}` : ""}`).join(EOL) + EOL)
  }),
)
