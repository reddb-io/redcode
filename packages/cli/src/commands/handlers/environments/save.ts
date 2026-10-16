import { Effect, Schema } from "effect"
import { AbsolutePath } from "@opencode/schema/schema"
import { ProjectEnvironment } from "@opencode/schema/project-environment"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { client } from "./shared"

export default Runtime.handler(Commands.commands.environments.commands.save, (input) =>
  Effect.gen(function* () {
    const api = yield* client(input.server)
    const definition = yield* Effect.try(() =>
      Schema.decodeUnknownSync(ProjectEnvironment.Definition)({
        id: input.id,
        name: input.name,
        backend: input.backend,
        composeFile: input.composeFile,
        prepare: input.prepare,
        start: input.start,
        stop: input.stop,
        validate: input.validate,
        timeoutSeconds: input.timeout,
        secrets: Object.fromEntries(
          input.secret.map((binding) => {
            const index = binding.indexOf("=")
            if (index < 1) throw new Error("Use --secret VARIABLE=vault-name; do not pass secret values")
            return [binding.slice(0, index), binding.slice(index + 1)]
          }),
        ),
      }),
    )
    const result = yield* Effect.tryPromise((signal) =>
      api.save(
        { directory: AbsolutePath.make(input.directory), expectedRevision: input.revision, definition },
        { signal },
      ),
    )
    process.stdout.write(JSON.stringify(result, null, 2) + "\n")
  }),
)
