import { EOL } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { project } from "./shared"

export default Runtime.handler(
  Commands.commands.worktrees.commands.remove,
  Effect.fn("cli.worktrees.remove")(function* (args) {
    const context = yield* project()
    const directory = path.resolve(args.directory)
    const relative = path.relative(directory, process.cwd())
    if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)))
      return yield* Effect.fail(new Error(`Cannot remove the current worktree: ${directory}`))
    yield* Effect.promise(() => context.client.worktree.remove({
      projectID: context.projectID,
      directory,
      force: args.force,
    }))
    process.stdout.write(`Removed ${directory}${EOL}`)
  }),
)
