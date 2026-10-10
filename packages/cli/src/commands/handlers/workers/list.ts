import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { WorkerPool } from "../../../workers/pool"

export default Runtime.handler(Commands.commands.workers.commands.list, (input) =>
  Effect.tryPromise(async () => {
    const config = await WorkerPool.readConfig(input.config)
    const workers = await Promise.all(config.workers.map(async (worker) => ({
      ...worker,
      health: await WorkerPool.health(worker).then(
        (system) => ({ status: "online", system }),
        (error: unknown) => ({ status: "offline", detail: error instanceof Error ? error.message : "Worker rejected the connection" }),
      ),
    })))
    process.stdout.write(JSON.stringify({ workers }, null, 2) + "\n")
  }),
)
