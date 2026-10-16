import { ProjectEnvironment } from "@opencode/schema/project-environment"
import { AbsolutePath } from "@opencode/schema/schema"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"
import { ConsoleForbiddenError } from "../console.js"

const errors = [InvalidRequestError, ConsoleForbiddenError] as const
export const ProjectEnvironmentsGroup = HttpApiGroup.make("server.projectEnvironments")
  .add(
    HttpApiEndpoint.get("projectEnvironments.list", "/api/project-environments", {
      query: { directory: AbsolutePath },
      success: ProjectEnvironment.Snapshot,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.put("projectEnvironments.save", "/api/project-environments/recipes", {
      payload: ProjectEnvironment.Save,
      success: ProjectEnvironment.Recipe,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("projectEnvironments.run", "/api/project-environments/run", {
      payload: ProjectEnvironment.Run,
      success: ProjectEnvironment.Info,
      error: errors,
    }),
  )
  .annotateMerge(OpenApi.annotations({ title: "projectEnvironments" }))
