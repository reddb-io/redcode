import { randomUUID } from "node:crypto"
import { Effect, Option } from "effect"
import { AbsolutePath } from "@opencode/schema/schema"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { client } from "./shared"

export default Runtime.handler(Commands.commands.environments.commands.run, (input) =>
  Effect.gen(function* () {
    if (!input.yes)
      return yield* Effect.fail(
        new Error("Review the saved recipe with environments list, then use --yes to run it on this host"),
      )
    const api = yield* client(input.server)
    const directory = AbsolutePath.make(input.directory)
    const requestID = Option.getOrElse(input.requestID, randomUUID)
    process.stderr.write(`Environment request: ${requestID}\n`)
    const result = yield* Effect.tryPromise((signal) =>
      api.run(
        {
          directory,
          recipeID: input.id,
          action: input.action,
          revision: input.revision,
          requestID,
          confirmReconciled: input.confirmReconciled,
        },
        { signal },
      ),
    )
    const current = { info: result }
    while (current.info.state === "working") {
      yield* Effect.sleep("1 second")
      const snapshot = yield* Effect.tryPromise((signal) => api.list({ directory }, { signal }))
      const found = snapshot.environments.find((item) => item.id === result.id)
      if (!found || found.requestID !== requestID)
        return yield* Effect.fail(
          new Error("Operation changed. Inspect the recorded environment state before continuing."),
        )
      current.info = found
    }
    process.stdout.write(JSON.stringify(current.info, null, 2) + "\n")
    if (current.info.state === "failed" || current.info.state === "reconcile") process.exitCode = 1
  }),
)
