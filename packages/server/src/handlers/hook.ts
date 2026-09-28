import { HookRuntime } from "@opencode/core/hook"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const HookHandler = HttpApiBuilder.group(Api, "server.hook", (handlers) =>
  handlers
    .handle("hook.status", () => response(HookRuntime.Service.use((hooks) => hooks.status())))
    .handle("hook.trust", () => response(HookRuntime.Service.use((hooks) => hooks.trust())))
    .handle("hook.revoke", () => response(HookRuntime.Service.use((hooks) => hooks.revoke())))
    .handle("hook.import", () =>
      response(
        HookRuntime.Service.use((hooks) => hooks.importClaude()).pipe(
          Effect.mapError((error) => new InvalidRequestError({ message: error.message })),
        ),
      ),
    ),
)
