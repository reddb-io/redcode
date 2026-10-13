import { Worktree } from "@opencode/schema/worktree"
import { Project } from "@opencode/schema/project"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorktreeError } from "./worktree.js"
import { ProjectNotFoundError } from "../errors.js"
const root = "/api/worktree"
export const WorktreeLifecycleGroup = HttpApiGroup.make("server.worktreeLifecycle")
  .add(
    HttpApiEndpoint.post("worktreeLifecycle.archive", `${root}/archive`, {
      payload: Worktree.ArchiveInput,
      success: Worktree.Archive,
      error: [WorktreeError, ProjectNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "worktreeLifecycle.archive" })),
  )
  .add(
    HttpApiEndpoint.get("worktreeLifecycle.archives", `${root}/archives`, {
      query: Schema.Struct({ projectID: Project.ID }),
      success: Schema.Array(Worktree.Archive),
      error: [WorktreeError, ProjectNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "worktreeLifecycle.archives" })),
  )
  .add(
    HttpApiEndpoint.post("worktreeLifecycle.inspect", `${root}/inspect`, {
      payload: Worktree.InspectInput,
      success: Worktree.Review,
      error: [WorktreeError, ProjectNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "worktreeLifecycle.inspect" })),
  )
  .add(
    HttpApiEndpoint.post("worktreeLifecycle.integrate", `${root}/integrate`, {
      payload: Worktree.IntegrateInput,
      success: Worktree.Review,
      error: [WorktreeError, ProjectNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "worktreeLifecycle.integrate" })),
  )
  .add(
    HttpApiEndpoint.post("worktreeLifecycle.checkpoint", `${root}/checkpoint`, {
      payload: Worktree.CheckpointInput,
      success: Schema.String,
      error: [WorktreeError, ProjectNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "worktreeLifecycle.checkpoint" })),
  )
