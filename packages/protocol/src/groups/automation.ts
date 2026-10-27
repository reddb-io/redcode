import { Automation } from "@opencode/schema/automation"
import { Session } from "@opencode/schema/session"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { AutomationNotFoundError, InvalidRequestError, SessionNotFoundError } from "../errors.js"

export const makeAutomationGroup = <I extends HttpApiMiddleware.AnyId, S>(middleware: Context.Key<I, S>) => {
  const params = { sessionID: Session.ID, automationID: Automation.ID }
  const error = [AutomationNotFoundError, InvalidRequestError, SessionNotFoundError]
  return HttpApiGroup.make("server.automation")
    .add(
      HttpApiEndpoint.get("session.automation.list", "/api/session/:sessionID/automation", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(Automation.Info) }),
        error,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "session.automation.list", summary: "List conversation automations" }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.automation.create", "/api/session/:sessionID/automation", {
        params: { sessionID: Session.ID },
        payload: Automation.Input,
        success: Schema.Struct({ data: Automation.Info }),
        error,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "session.automation.create", summary: "Schedule a conversation prompt" }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.automation.control", "/api/session/:sessionID/automation/:automationID/control", {
        params,
        payload: Schema.Struct({ enabled: Schema.Boolean }),
        success: Schema.Struct({ data: Automation.Info }),
        error,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "session.automation.control", summary: "Pause or resume an automation" }),
      ),
    )
    .add(
      HttpApiEndpoint.post("session.automation.run", "/api/session/:sessionID/automation/:automationID/run", {
        params,
        payload: Schema.Struct({ id: Automation.RunID }),
        success: Schema.Struct({ data: Automation.Run }),
        error,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "session.automation.run", summary: "Admit an automation prompt now" }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session.automation.history", "/api/session/:sessionID/automation/:automationID/history", {
        params,
        success: Schema.Struct({ data: Schema.Array(Automation.Run) }),
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.automation.history",
          summary: "Inspect the latest 50 automation admissions",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.delete("session.automation.remove", "/api/session/:sessionID/automation/:automationID", {
        params,
        success: HttpApiSchema.NoContent,
        error,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "session.automation.remove",
          summary: "Delete an automation and its admission history",
        }),
      ),
    )
    .middleware(middleware)
}
