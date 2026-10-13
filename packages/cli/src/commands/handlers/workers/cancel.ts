import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { WorkerPool } from "../../../workers/pool"

export default Runtime.handler(Commands.commands.workers.commands.cancel, (input) =>
  Effect.tryPromise({
    try: async (signal) => {
      await WorkerPool.control({ ...input, signal }, { kind: "cancel", task: input.task })
      process.stdout.write(await Bun.file(input.report).text())
    },
    catch: (cause) => cause,
  }),
)
