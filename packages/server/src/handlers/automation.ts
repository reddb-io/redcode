import { AutomationRuntime } from "@opencode/core/automation"
import { Session } from "@opencode/core/session"
import { AutomationNotFoundError, InvalidRequestError, SessionNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const AutomationHandler = HttpApiBuilder.group(Api, "server.automation", (handlers) =>
  handlers
    .handle("session.automation.list", (ctx) =>
      AutomationRuntime.Service.use((service) => service.list(ctx.params.sessionID)).pipe(
        Effect.map((data) => ({ data })),
      ),
    )
    .handle("session.automation.create", (ctx) =>
      errors(AutomationRuntime.Service.use((service) => service.create(ctx.params.sessionID, ctx.payload))).pipe(
        Effect.map((data) => ({ data })),
      ),
    )
    .handle("session.automation.control", (ctx) =>
      errors(
        AutomationRuntime.Service.use((service) =>
          service.control(ctx.params.sessionID, ctx.params.automationID, ctx.payload.enabled),
        ),
      ).pipe(Effect.map((data) => ({ data }))),
    )
    .handle("session.automation.run", (ctx) =>
      errors(
        AutomationRuntime.Service.use((service) =>
          service.run(ctx.params.sessionID, ctx.params.automationID, ctx.payload.id),
        ),
      ).pipe(Effect.map((data) => ({ data }))),
    )
    .handle("session.automation.history", (ctx) =>
      errors(
        AutomationRuntime.Service.use((service) => service.history(ctx.params.sessionID, ctx.params.automationID)),
      ).pipe(Effect.map((data) => ({ data }))),
    )
    .handle("session.automation.remove", (ctx) =>
      errors(AutomationRuntime.Service.use((service) => service.remove(ctx.params.sessionID, ctx.params.automationID))),
    ),
)

function errors<A, R>(
  effect: Effect.Effect<A, AutomationRuntime.NotFound | AutomationRuntime.Invalid | Session.NotFoundError, R>,
) {
  return effect.pipe(
    Effect.catchTags({
      "Automation.NotFound": (error) => new AutomationNotFoundError({ message: error.message }),
      "Automation.Invalid": (error) => new InvalidRequestError({ message: error.message }),
      "Session.NotFoundError": (error) =>
        new SessionNotFoundError({ sessionID: error.sessionID, message: "Conversation not found" }),
    }),
  )
}
