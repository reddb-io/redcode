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
    HttpApiEndpoint.post("worktreeLifecycle.prepareIntegration", `${root}/integration/prepare`, {
      payload: Worktree.PrepareIntegrationInput,
      success: Worktree.IntegrationCandidate,
      error: [WorktreeError, ProjectNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "worktreeLifecycle.prepareIntegration",
        summary: "Prepare combined worktree results",
        description:
          "Merge ordered, pinned source revisions into a reproducible candidate without changing checkouts or refs. Returns conflicts explicitly. A ready candidate still requires verification and task acceptance.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("worktreeLifecycle.applyIntegration", `${root}/integration/apply`, {
      payload: Worktree.ApplyIntegrationInput,
      success: Worktree.IntegrationCandidate,
      error: [WorktreeError, ProjectNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "worktreeLifecycle.applyIntegration",
        summary: "Apply reviewed combined revision",
        description:
          "Rebuild and compare the candidate against its reviewed commit, then fast-forward the clean idle target. Does not run checks or accept tasks.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("worktreeLifecycle.checkpoint", `${root}/checkpoint`, {
      payload: Worktree.CheckpointInput,
      success: Schema.String,
      error: [WorktreeError, ProjectNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "worktreeLifecycle.checkpoint" })),
  )
