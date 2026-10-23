import { Git } from "@opencode/core/git"
import { Worktree } from "@opencode/core/worktree"
import { Project } from "@opencode/core/project"
import { ProjectNotFoundError } from "@opencode/protocol/errors"
import { WorktreeError } from "@opencode/protocol/groups/worktree"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import {
  inspectWorktree,
  integrateWorktree,
  checkpointWorktree,
  archiveWorktree,
  worktreeArchives,
  prepareIntegration,
  applyIntegration,
} from "../worktree-review"
import { ServerAccess } from "@opencode/protocol/server-access"
import { Harnesses } from "../harness"
import { SessionStore } from "@opencode/core/session/store"
import { SessionExecution } from "@opencode/core/session/execution"
import { AbsolutePath } from "@opencode/schema/schema"

export const WorktreeHandler = HttpApiBuilder.group(Api, "server.worktree", (handlers) =>
  Effect.gen(function* () {
    const worktrees = yield* Worktree.Service
    const harnesses = yield* Harnesses.Service
    return handlers
      .handle("worktree.list", (ctx) =>
        worktrees.list(ctx.query).pipe(Effect.catchTag("Project.NotFoundError", missingProject)),
      )
      .handle("worktree.create", (ctx) => worktrees.create(ctx.payload).pipe(badRequest))
      .handle("worktree.remove", (ctx) =>
        Effect.try({
          try: () => harnesses.assertCheckoutIdle(ctx.payload.directory),
          catch: (error) =>
            new Worktree.OperationError({
              message: error instanceof Error ? error.message : "Checkout has an attached harness",
            }),
        }).pipe(
          Effect.flatMap(() => worktrees.remove(ctx.payload)),
          badRequest,
          Effect.as(HttpApiSchema.NoContent.make()),
        ),
      )
      .handle("worktree.refresh", (ctx) =>
        worktrees.refresh(ctx.payload).pipe(badRequest, Effect.as(HttpApiSchema.NoContent.make())),
      )
  }),
)

export const WorktreeLifecycleHandler = HttpApiBuilder.group(Api, "server.worktreeLifecycle", (handlers) =>
  Effect.gen(function* () {
    const worktrees = yield* Worktree.Service
    const harnesses = yield* Harnesses.Service
    const sessions = yield* SessionStore.Service
    const execution = yield* SessionExecution.Service
    const operation = <A>(
      projectID: Project.ID,
      run: (inventory: Worktree.List) => Promise<A>,
      mutableDirectories: readonly AbsolutePath[] = [],
    ) =>
      Effect.gen(function* () {
        const principal = yield* ServerAccess.Current
        if (principal && principal.access.ownerRole !== "admin")
          return yield* Effect.fail(
            new WorktreeError({
              name: "WorktreeError",
              data: { message: "Use the host's trusted project connection for checkout operations" },
            }),
          )
        const inventory = yield* worktrees
          .list({ projectID })
          .pipe(Effect.catchTag("Project.NotFoundError", missingProject))
        const active = yield* execution.active
        for (const directory of mutableDirectories) {
          const stored = yield* sessions.list({ directory })
          if (stored.some((session) => active.has(session.id)))
            return yield* Effect.fail(
              new WorktreeError({
                name: "WorktreeError",
                data: { message: "Interrupt active native sessions before changing this checkout's Git state" },
              }),
            )
        }
        return yield* Effect.tryPromise({
          try: () => run(inventory),
          catch: (error) =>
            new WorktreeError({
              name: "WorktreeError",
              data: { message: error instanceof Error ? error.message : "Worktree operation failed" },
            }),
        })
      })
    return handlers
      .handle("worktreeLifecycle.archives", (ctx) => operation(ctx.query.projectID, worktreeArchives))
      .handle("worktreeLifecycle.archive", (ctx) =>
        operation(ctx.payload.projectID, (inventory) => {
          harnesses.assertCheckoutIdle(ctx.payload.directory)
          return archiveWorktree(ctx.payload, inventory)
        }).pipe(
          Effect.flatMap((archive) =>
            worktrees
              .remove({ projectID: ctx.payload.projectID, directory: ctx.payload.directory, force: false })
              .pipe(badRequest, Effect.as(archive)),
          ),
        ),
      )
      .handle("worktreeLifecycle.inspect", (ctx) =>
        operation(ctx.payload.projectID, (inventory) => inspectWorktree(ctx.payload, inventory)),
      )
      .handle("worktreeLifecycle.integrate", (ctx) =>
        operation(
          ctx.payload.projectID,
          (inventory) => {
            harnesses.assertCheckoutIdle(ctx.payload.directory)
            harnesses.assertCheckoutIdle(ctx.payload.target)
            return integrateWorktree(ctx.payload, inventory)
          },
          [ctx.payload.directory, ctx.payload.target],
        ),
      )
      .handle("worktreeLifecycle.checkpoint", (ctx) =>
        operation(
          ctx.payload.projectID,
          (inventory) => {
            harnesses.assertCheckoutIdle(ctx.payload.directory)
            return checkpointWorktree(ctx.payload, inventory)
          },
          [ctx.payload.directory],
        ),
      )
      .handle("worktreeLifecycle.prepareIntegration", (ctx) =>
        operation(ctx.payload.projectID, (inventory) => prepareIntegration(ctx.payload, inventory)),
      )
      .handle("worktreeLifecycle.applyIntegration", (ctx) =>
        operation(
          ctx.payload.projectID,
          (inventory) => {
            harnesses.assertCheckoutIdle(ctx.payload.target)
            ctx.payload.sources.forEach((source) => harnesses.assertCheckoutIdle(source.directory))
            return applyIntegration(ctx.payload, inventory)
          },
          [ctx.payload.target, ...ctx.payload.sources.map((source) => source.directory)],
        ),
      )
  }),
)

function badRequest<A, R>(effect: Effect.Effect<A, Worktree.Error, R>) {
  return effect.pipe(
    Effect.catchTag("Project.NotFoundError", missingProject),
    Effect.mapError((error) =>
      error instanceof ProjectNotFoundError
        ? error
        : new WorktreeError({
            name: "WorktreeError",
            data: {
              message: message(error),
              forceRequired:
                error instanceof Git.WorktreeError || error instanceof Worktree.OperationError
                  ? error.forceRequired
                  : undefined,
            },
          }),
    ),
  )
}

function missingProject(error: Project.NotFoundError) {
  return Effect.fail(
    new ProjectNotFoundError({ projectID: error.projectID, message: `Project not found: ${error.projectID}` }),
  )
}

function message(error: Exclude<Worktree.Error, Project.NotFoundError>) {
  if (error instanceof Worktree.SourceDirectoryNotFoundError)
    return error.directory
      ? `Worktree source not found: ${error.directory}`
      : `Worktree source not found for project: ${error.projectID}`
  if (error instanceof Worktree.DestinationExistsError) return `Worktree destination already exists: ${error.directory}`
  if (error instanceof Worktree.DirectoryUnavailableError) return `Worktree directory unavailable: ${error.directory}`
  if (error instanceof Worktree.InvalidDirectoryError) return `Invalid worktree directory: ${error.directory}`
  if (error instanceof Worktree.StrategyUnavailableError) return `Worktree strategy unavailable: ${error.strategy}`
  return error.message
}
