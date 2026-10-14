import { AgentTools } from "@opencode/schema/agent-tools"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"
import { ConsoleForbiddenError } from "../console.js"

const error = [InvalidRequestError, ConsoleForbiddenError]
export const AgentToolsGroup = HttpApiGroup.make("server.agentTools")
  .add(
    HttpApiEndpoint.get("agentTools.list", "/api/agent-tools", { success: AgentTools.Snapshot, error }).annotateMerge(
      OpenApi.annotations({ identifier: "agentTools.list" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("agentTools.configure", "/api/agent-tools/config", {
      payload: AgentTools.Configure,
      success: AgentTools.Status,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "agentTools.configure" })),
  )
  .add(
    HttpApiEndpoint.post("agentTools.install", "/api/agent-tools/:id/install", {
      params: { id: AgentTools.ID },
      success: AgentTools.Status,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "agentTools.install" })),
  )
  .add(
    HttpApiEndpoint.post("agentTools.probe", "/api/agent-tools/:id/probe", {
      params: { id: AgentTools.ID },
      success: AgentTools.Status,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "agentTools.probe" })),
  )
  .add(
    HttpApiEndpoint.post("agentTools.initialize", "/api/agent-tools/rift/initialize", {
      payload: AgentTools.Initialize,
      success: Schema.Json,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "agentTools.initialize" })),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "agentTools",
      description: "Optional host-owned agent capabilities. Requires infrastructure administration.",
    }),
  )
