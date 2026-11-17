import { Project } from "@opencode/core/project"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ProjectNotFoundError } from "@opencode/protocol/errors"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  handlers
    .handle("project.list", (ctx) => Project.Service.use((project) => project.list(ctx.query)))
    .handle("project.update", (ctx) =>
      Project.Service.use((project) =>
        project.update({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(
          Effect.mapError(
            () =>
              new ProjectNotFoundError({
                projectID: ctx.params.projectID,
                message: `Project not found: ${ctx.params.projectID}`,
              }),
          ),
        ),
      ),
    )
    .handle("project.remove", (ctx) =>
      Project.Service.use((project) =>
        project.remove({ projectID: ctx.params.projectID }).pipe(
          Effect.mapError(
            () =>
              new ProjectNotFoundError({
                projectID: ctx.params.projectID,
                message: `Project not found: ${ctx.params.projectID}`,
              }),
          ),
          Effect.as(HttpApiSchema.NoContent.make()),
        ),
      ),
    ),
)
