import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { ServiceConfig } from "../../../services/service-config"

export const project = Effect.fn("cli.worktrees.project")(function* () {
  const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  const location = yield* Effect.promise(() => client.location.get({ location: { directory: process.cwd() } }))
  return { client, projectID: location.project.id }
})
