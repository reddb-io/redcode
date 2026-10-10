import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { WorkerPool } from "../../../workers/pool"

export default Runtime.handler(Commands.commands.workers.commands.collect, (input) =>
  Effect.tryPromise({
    try: async (signal) => {
      const artifact = await WorkerPool.collect({ ...input, signal })
      process.stdout.write(JSON.stringify(artifact, null, 2) + "\n")
    },
    catch: (cause) => cause,
  }),
)
