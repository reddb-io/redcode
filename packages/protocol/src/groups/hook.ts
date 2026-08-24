import { Hook } from "@reddb-io/redcode-schema/hook"
import { Location } from "@reddb-io/redcode-schema/location"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const HookGroup = HttpApiGroup.make("server.hook")
  .add(
    HttpApiEndpoint.get("hook.status", "/api/hook", {
      query: LocationQuery,
      success: Location.response(Hook.Status),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.hook.status",
          summary: "List hooks",
          description: "List declarative hooks, support state, and project trust.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("hook.trust", "/api/hook/trust", {
      query: LocationQuery,
      success: Location.response(Hook.Trust),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.hook.trust", summary: "Trust project hooks" })),
  )
  .add(
    HttpApiEndpoint.delete("hook.revoke", "/api/hook/trust", {
      query: LocationQuery,
      success: Location.response(Hook.Trust),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.hook.revoke", summary: "Revoke project hook trust" })),
  )
  .add(
    HttpApiEndpoint.post("hook.import", "/api/hook/import/claude", {
      query: LocationQuery,
      success: Location.response(Hook.ImportResult),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.hook.import", summary: "Import Claude hooks" })),
  )
  .annotateMerge(OpenApi.annotations({ title: "hooks", description: "Declarative lifecycle hooks and project trust." }))
