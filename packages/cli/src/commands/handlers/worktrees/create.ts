import { EOL } from "node:os"
import path from "node:path"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { project } from "./shared"

export default Runtime.handler(
  Commands.commands.worktrees.commands.create,
  Effect.fn("cli.worktrees.create")(function* (args) {
    const context = yield* project()
    const created = yield* Effect.promise(() => context.client.worktree.create({
      projectID: context.projectID,
      branch: Option.getOrUndefined(args.branch),
      name: Option.getOrUndefined(args.name),
      from: Option.map(args.from, path.resolve).pipe(Option.getOrUndefined),
      directory: Option.map(args.directory, path.resolve).pipe(Option.getOrUndefined),
    }))
    process.stdout.write(created.directory + EOL)
  }),
)
