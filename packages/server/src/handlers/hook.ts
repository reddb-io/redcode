import { HookV2 } from "@opencode-ai/core/hook"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const HookHandler = HttpApiBuilder.group(Api, "server.hook", (handlers) =>
  handlers
    .handle("hook.status", () => response(HookV2.Service.use((hooks) => hooks.status())))
    .handle("hook.trust", () => response(HookV2.Service.use((hooks) => hooks.trust())))
    .handle("hook.revoke", () => response(HookV2.Service.use((hooks) => hooks.revoke())))
    .handle("hook.import", () =>
      response(
        HookV2.Service.use((hooks) => hooks.importClaude()).pipe(
          Effect.mapError((error) => new InvalidRequestError({ message: error.message, kind: "hook_import" })),
        ),
      ),
    ),
)
