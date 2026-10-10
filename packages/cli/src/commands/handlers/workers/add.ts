import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { WorkerPool } from "../../../workers/pool"
import { Worker } from "@opencode/schema/worker"

export default Runtime.handler(Commands.commands.workers.commands.add, (input) =>
  Effect.tryPromise(async () => {
    const worker = Worker.Registration.make({
      id: input.id,
      url: input.url,
      passwordEnv: input.passwordEnv,
      directories: [input.directory],
      tags: input.tag,
    })
    await WorkerPool.add(input.config, worker)
    process.stdout.write(
      `Registered ${worker.id}. Run redcode workers list --config "${input.config}" to check connectivity.\n`,
    )
  }),
)
