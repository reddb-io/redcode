import { EOL } from "node:os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { project } from "./shared"

export default Runtime.handler(
  Commands.commands.worktrees.commands.refresh,
  Effect.fn("cli.worktrees.refresh")(function* () {
    const context = yield* project()
    yield* Effect.promise(() => context.client.worktree.refresh({ projectID: context.projectID }))
    process.stdout.write(`Worktrees refreshed${EOL}`)
  }),
)
