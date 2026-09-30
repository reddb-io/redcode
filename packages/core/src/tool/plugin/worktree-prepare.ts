export * as WorktreePrepareTool from "./worktree-prepare.js"

import path from "node:path"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { TuiEvent } from "@opencode/schema/tui-event"
import { AppProcess } from "@opencode/util/process"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { KeyedMutex } from "../../effect/keyed-mutex.js"
import { FileAccess } from "../../file-access.js"
import { Git } from "../../git.js"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"
import { AbsolutePath } from "../../schema.js"
import { Session } from "../../session.js"
import { SessionTaskFacts } from "../../session/task-facts.js"
import { Worktree } from "../../worktree.js"
import { WorktreePlacement } from "../../worktree/placement.js"
import { SessionEvidence } from "../session-evidence.js"

const preparing = KeyedMutex.makeUnsafe<Session.ID>()

/** Read-only utility agents never prepare a Session's worktree. */
const readers = ["question", "explore", "title", "summary", "compaction"]

export const Plugin = {
  id: "redcode.tool.worktree-prepare",
  effect: Effect.fn("WorktreePrepareTool.Plugin")(function* (ctx: Context) {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const location = yield* Location.Service
    const permission = yield* Permission.Service
    const processes = yield* AppProcess.Service
    const sessions = yield* Session.Service
    const worktrees = yield* Worktree.Service

    const run = Effect.fn("WorktreePrepare.git")(function* (directory: string, args: ReadonlyArray<string>) {
      const result = yield* processes.run(
        ChildProcess.make("git", ["-C", directory, ...args], {
          stdin: "ignore",
          env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"))),
          extendEnv: false,
        }),
        { timeout: "15 seconds", maxOutputBytes: 8_000, maxErrorBytes: 2_000 },
      )
      if (result.exitCode !== 0)
        return yield* new ToolFailure({
          message: `git ${args[0]} failed in ${directory}: ${result.stderr.toString().slice(0, 1000)}`,
        })
      return result.stdout.toString().trimEnd()
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: "worktree_prepare",
          options: { codemode: false },
          description:
            "Prepare or reuse a linked Git worktree for this writing Session, show source and worktree status, and move the Session there at the next safe boundary. Existing changes in the source checkout remain in place. A non-Git directory or a repository without commits stays where it is. Repeat file mutations after the move; do not run destination-dependent tools in the same execute call.",
          input: Schema.Struct({
            name: Schema.optional(Schema.String).annotate({
              description:
                "Short task description that names a new worktree and its branch (default: the Session title)",
            }),
          }),
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              let root = yield* sessions.get(context.sessionID)
              while (root.parentID) {
                const parent = yield* sessions.get(root.parentID).pipe(Effect.orElseSucceed(() => undefined))
                if (!parent) break
                root = parent
              }
              return yield* preparing.withLock(root.id)(
                Effect.gen(function* () {
                  if (readers.includes(context.agent))
                    return yield* new ToolFailure({
                      message: "Worktree preparation is available in Build, Design and Plan",
                    })
                  const session = yield* sessions.get(context.sessionID)
                  const repository = yield* git.repo.discover(AbsolutePath.make(session.location.directory))
                  if (!repository) {
                    const output = `Non-Git directory: ${session.location.directory}. No worktree required.`
                    return { output, content: output }
                  }
                  if (repository.gitDirectory !== repository.commonDirectory) {
                    const status = yield* run(repository.worktree, ["status", "--short", "--branch"])
                    const output = `Session already uses linked worktree ${repository.worktree}.\n${status}`
                    return { output, content: output, metadata: { directory: repository.worktree } }
                  }
                  const settings = Config.latest(yield* config.entries(), "worktree")
                  const environment = WorktreePlacement.environment(
                    yield* sessions.environment({ sessionID: root.id }),
                    process.env,
                  )
                  if (!WorktreePlacement.automatic(settings, environment)) {
                    const status = yield* run(repository.worktree, ["status", "--short", "--branch"])
                    const output = `Automatic worktrees are disabled. Session remains in ${session.location.directory}.\n${status}`
                    return { output, content: output }
                  }
                  if (!(yield* git.history.head(repository))) {
                    const output = `Repository ${repository.worktree} has no commits yet, so there is no HEAD to branch a worktree from. Session remains in ${session.location.directory}.`
                    return { output, content: output }
                  }
                  yield* permission.assert({
                    action: "worktree_prepare",
                    resources: [location.directory],
                    save: [location.directory],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.messageID, id: context.id },
                  })
                  const parent = AbsolutePath.make(
                    WorktreePlacement.parent({ root: repository.worktree, settings, environment }),
                  )
                  // Worktrees prepared before ownership markers used this branch name.
                  const legacy = `redcode-${SessionEvidence.hash(root.id).slice(0, 12)}`
                  // Include worktrees created outside this process before deciding which one the Session owns.
                  yield* worktrees.refresh({ projectID: session.projectID })
                  const listed = yield* worktrees.list({ projectID: session.projectID })
                  const existing = (yield* Effect.forEach(listed, (item) =>
                    git.repo.discover(item.directory).pipe(
                      Effect.flatMap((entry) =>
                        entry && entry.gitDirectory !== entry.commonDirectory
                          ? Effect.all({
                              owner: fs
                                .readFileStringSafe(path.join(entry.gitDirectory, WorktreePlacement.OWNER))
                                .pipe(Effect.orElseSucceed(() => undefined)),
                              branch: git.history.branch(entry),
                            })
                          : Effect.succeed(undefined),
                      ),
                      Effect.map((found) => ({
                        directory: item.directory,
                        owner: found?.owner?.trim(),
                        branch: found?.branch,
                      })),
                    ),
                  )).find((entry) => entry.owner === root.id || (entry.branch !== undefined && entry.branch === legacy))
                  // A nested worktree must stay out of the primary checkout's status; a temporary one is not inside it.
                  if (!existing && parent === path.join(repository.worktree, ".red", "worktrees")) {
                    const exclude = path.join(repository.commonDirectory, "info", "exclude")
                    const current = yield* Effect.promise(() =>
                      Bun.file(exclude)
                        .text()
                        .catch(() => ""),
                    )
                    if (!current.split(/\r?\n/).some((line) => line.trim() === "/.red/worktrees/"))
                      yield* Effect.tryPromise({
                        try: () =>
                          Bun.write(
                            exclude,
                            `${current}${current && !current.endsWith("\n") ? "\n" : ""}/.red/worktrees/\n`,
                          ),
                        catch: (error) =>
                          new ToolFailure({ message: `Cannot exclude managed worktrees: ${String(error)}` }),
                      })
                  }
                  const prepared = existing
                    ? { directory: existing.directory, branch: existing.branch ?? path.basename(existing.directory) }
                    : yield* Effect.gen(function* () {
                        const name = WorktreePlacement.slug(root.title || input.name || "")
                        // Worktree.create suffixes a taken directory; the branch sharing its name must also be new.
                        // Only this name and its numbered variants can collide, so the branch listing stays small.
                        const branches = new Set(
                          (yield* run(repository.worktree, [
                            "for-each-ref",
                            "--format=%(refname:short)",
                            `refs/heads/${name}`,
                            `refs/heads/${name}-*`,
                          ]))
                            .split("\n")
                            .map((line) => line.trim()),
                        )
                        const created = yield* worktrees.create({
                          projectID: session.projectID,
                          from: repository.worktree,
                          name: WorktreePlacement.nextName(name, branches),
                          directory: parent,
                        })
                        // The branch takes the directory's name, suffixed only if that branch already exists.
                        const branch = WorktreePlacement.nextName(path.basename(created.directory), branches)
                        yield* run(created.directory, ["switch", "-c", branch])
                        const linked = yield* git.repo.discover(created.directory)
                        if (!linked)
                          return yield* new ToolFailure({
                            message: `Created worktree ${created.directory} could not be opened`,
                          })
                        yield* fs.writeWithDirs(path.join(linked.gitDirectory, WorktreePlacement.OWNER), `${root.id}\n`)
                        return { directory: created.directory, branch }
                      })
                  const relativeDestination = AbsolutePath.make(
                    path.join(prepared.directory, path.relative(repository.worktree, session.location.directory)),
                  )
                  const destination = (yield* fs.isDir(relativeDestination)) ? relativeDestination : prepared.directory
                  const pendingMove = (yield* sessions.inbox(context.sessionID)).find((item) => item.type === "move")
                  if (pendingMove?.type === "move" && pendingMove.payload.location.directory !== destination)
                    return yield* new ToolFailure({
                      message: "Another Session move is pending; finish it before preparing this worktree",
                    })
                  const moving = destination !== session.location.directory && !pendingMove
                  if (moving)
                    yield* sessions.move({ sessionID: context.sessionID, directory: destination, delivery: "steer" })
                  // One notice per worktree: its creation or the Session's move into it.
                  if (!existing || moving) {
                    const inside = path.relative(repository.worktree, prepared.directory)
                    const label =
                      inside && !inside.startsWith("..") && !path.isAbsolute(inside)
                        ? `worktree ${inside.replaceAll("\\", "/")}`
                        : WorktreePlacement.temporary(prepared.directory)
                          ? `temporary worktree ${prepared.directory}`
                          : `worktree ${prepared.directory}`
                    yield* bus.publish(
                      TuiEvent.ToastShow,
                      {
                        message: `Working in ${label} (branch ${prepared.branch}). Uncommitted changes in the primary checkout stay there.`,
                        variant: "info",
                        duration: 6_000,
                      },
                      { location: session.location },
                    )
                  }
                  const [sourceStatus, worktreeStatus] = yield* Effect.all([
                    run(repository.worktree, ["status", "--short", "--branch"]),
                    run(prepared.directory, ["status", "--short", "--branch"]),
                  ])
                  const output = [
                    `Worktree: ${prepared.directory}`,
                    `Branch: ${prepared.branch}`,
                    `Session destination: ${destination} (move at the next safe boundary)`,
                    `Source checkout: ${repository.worktree}`,
                    `Source status:\n${sourceStatus}`,
                    `Worktree status:\n${worktreeStatus}`,
                    "Uncommitted source changes remain in the source checkout; inspect them before copying anything into the worktree.",
                    ...(destination !== relativeDestination
                      ? [
                          `The source subdirectory ${session.location.directory} is absent from HEAD; the Session will open at the worktree root.`,
                        ]
                      : []),
                  ].join("\n")
                  return {
                    output,
                    content: output,
                    metadata: { directory: prepared.directory, branch: prepared.branch },
                  }
                }),
              )
            }).pipe(
              Effect.mapError(
                (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error), error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        if (readers.includes(event.agent)) return
        if (!["write", "edit", "patch", "shell", "design_document"].includes(event.tool)) return
        if (event.tool === "shell" && SessionTaskFacts.readOnly(event.input)) return
        if (typeof event.input !== "object" || event.input === null) return
        const input = event.input as Record<string, unknown>
        if (event.tool === "design_document" && input.action !== "create") return
        if (event.tool === "shell" && typeof input.command !== "string") return
        if (event.tool === "patch" && typeof input.patchText !== "string") return
        if ((event.tool === "write" || event.tool === "edit") && typeof input.path !== "string") return
        const target =
          event.tool === "shell"
            ? input.workdir
            : ["patch", "design_document"].includes(event.tool)
              ? undefined
              : input.path
        if (target !== undefined && typeof target !== "string") return
        const session = yield* sessions.get(event.sessionID)
        const repository = yield* git.repo.discover(AbsolutePath.make(session.location.directory))
        if (!repository) return
        const absolute = FileAccess.resolvePath(session.location.directory, target ?? ".")
        if (repository.gitDirectory !== repository.commonDirectory) {
          if (path.basename(repository.commonDirectory) !== ".git") return
          const primary = path.dirname(repository.commonDirectory)
          const fromPrimary = path.relative(primary, absolute)
          const fromWorktree = path.relative(repository.worktree, absolute)
          const inside = (relative: string) =>
            relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
          if (inside(fromPrimary) && !inside(fromWorktree))
            return yield* new ToolFailure({ message: "Source checkout writes are blocked from a linked worktree" })
          if (
            (event.tool === "shell" && typeof input.command === "string" && input.command.includes(primary)) ||
            (event.tool === "patch" && typeof input.patchText === "string" && input.patchText.includes(primary))
          )
            return yield* new ToolFailure({
              message: "Command targets the source checkout; use the linked worktree path",
            })
          return
        }
        const settings = Config.latest(yield* config.entries(), "worktree")
        const environment = WorktreePlacement.environment(
          yield* sessions.environment({ sessionID: event.sessionID }),
          process.env,
        )
        if (!WorktreePlacement.automatic(settings, environment)) return
        const relative = path.relative(repository.worktree, absolute)
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return
        if (relative === ".git" || relative.startsWith(`.git${path.sep}`))
          return yield* new ToolFailure({ message: "Direct edits to Git metadata are not allowed" })
        const tool = (yield* ctx.tool.list()).find((item) => item.id === "worktree_prepare")
        if (!tool) return yield* new ToolFailure({ message: "Worktree preparation tool is unavailable" })
        const prepared = yield* tool.execute(
          {},
          {
            sessionID: event.sessionID,
            agent: event.agent,
            messageID: event.messageID,
            id: event.id,
            progress: () => Effect.void,
          },
        )
        const directory = prepared.metadata?.directory
        // No worktree applies here (automatic worktrees are off for the Session, or HEAD has no commit yet).
        if (typeof directory !== "string" || directory === repository.worktree) return
        return yield* new ToolFailure({
          message: `Session is moving to ${directory}. Repeat ${event.tool} after the next safe boundary so it uses the worktree's Location, permissions, and filesystem; the source checkout is unchanged.`,
        })
      }).pipe(
        Effect.mapError(
          (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error), error }),
        ),
      ),
    )
  }),
}
