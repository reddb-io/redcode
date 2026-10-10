import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { WorkerPool } from "../../../workers/pool"

export default Runtime.handler(Commands.commands.workers.commands.remove, (input) =>
  Effect.tryPromise(async () => {
    await WorkerPool.remove(input.config, input.id)
    process.stdout.write(`Removed ${input.id}. Its server and Sessions remain on the worker.\n`)
  }),
)
