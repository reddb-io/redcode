import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { WorkerPool } from "../../../workers/pool"

export default Runtime.handler(Commands.commands.workers.commands.run, (input) =>
  Effect.tryPromise({
    try: async (signal) => {
      const report = await WorkerPool.run({ config: input.config, manifest: input.manifest, report: input.report, timeoutMs: input.timeout * 1_000, signal,
        onUpdate: (entry) => process.stderr.write(`${entry.id}: ${entry.state}${entry.worker ? ` on ${entry.worker}` : ""}${entry.detail ? ` — ${entry.detail}` : ""}\n`),
      })
      process.stdout.write(JSON.stringify(report, null, 2) + "\n")
      if (report.tasks.some((task) => task.state !== "succeeded")) process.exitCode = 1
    },
    catch: (cause) => cause,
  }),
)
