import { log, spinner } from "@clack/prompts"
import { ConnectionCheck } from "@opencode/schema/connection-check"
import { Effect, Option } from "effect"
import type { OpenCodeClient } from "@opencode/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, requireInteractive } from "../../../ui/prompt"
import { chooseIntegration } from "./account"
import { createClient, loadIntegrations, location, request } from "./shared"

export default Runtime.handler(
  Commands.commands.auth.commands.check,
  Effect.fn("cli.auth.check")(function* (input) {
    const target = Option.getOrUndefined(input.target)
    if (!target)
      yield* requireInteractive("Pass an integration ID or name when running without an interactive terminal")
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const integration = yield* chooseIntegration(yield* loadIntegrations(client), target)
    yield* checkConnection(client, integration.id)
  }, handlePromptErrors),
)

export const checkConnection = Effect.fn("cli.auth.check.remote")(function* (
  client: OpenCodeClient,
  integrationID: string,
) {
  const progress = spinner()
  progress.start("Testing remote API...")
  const report = yield* request((signal) => client.integration.check({ integrationID, location }, { signal })).pipe(
    Effect.tapCause(() => Effect.sync(() => progress.stop("Could not run remote API test", 1))),
  )
  progress.stop(report.ok ? "Remote API test passed" : "Remote API test failed", report.ok ? 0 : 1)
  log.info(ConnectionCheck.describe(report.requests))
  if (!report.ok) return yield* Effect.fail(new Error(report.message))
  log.success(report.message)
})
