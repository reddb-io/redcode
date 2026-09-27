export * as WorktreePrepareTool from "./worktree-prepare.js"

import os from "node:os"
import path from "node:path"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { AppProcess } from "@opencode/util/process"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
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
import { SessionEvidence } from "../session-evidence.js"

const preparing = KeyedMutex.makeUnsafe<Session.ID>()

export const Plugin = {
  id: "redcode.tool.worktree-prepare",
  effect: Effect.fn("WorktreePrepareTool.Plugin")(function* (ctx: Context) {
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
            "Prepare or reuse a linked Git worktree for this writing Session, show source and worktree status, and move the Session there at the next safe boundary. Existing changes in the source checkout remain in place. A non-Git directory stays where it is. Repeat file mutations after the move; do not run destination-dependent tools in the same execute call.",
          input: Schema.Struct({}),
          output: Schema.String,
          execute: (_input, context) =>
            Effect.gen(function* () {
              let root = yield* sessions.get(context.sessionID)
              while (root.parentID) {
                const parent = yield* sessions.get(root.parentID).pipe(Effect.orElseSucceed(() => undefined))
                if (!parent) break
                root = parent
              }
              return yield* preparing.withLock(root.id)(Effect.gen(function* () {
                if (["plan", "design", "question", "explore", "title", "summary", "compaction"].includes(context.agent))
                  return yield* new ToolFailure({ message: "Worktree preparation is available to writing agents in Build" })
                yield* permission.assert({
                  action: "worktree_prepare",
                  resources: [location.directory],
                  save: [location.directory],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, id: context.id },
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
                if (settings?.auto === false || process.env.REDCODE_AUTO_WORKTREE === "0") {
                  const status = yield* run(repository.worktree, ["status", "--short", "--branch"])
                  const output = `Automatic worktrees are disabled. Session remains in ${session.location.directory}.\n${status}`
                  return { output, content: output }
                }
                const branch = `redcode-${SessionEvidence.hash(root.id).slice(0, 12)}`
                const parent = AbsolutePath.make(
                  settings?.directory
                    ? path.resolve(repository.worktree, settings.directory)
                    : (process.env.REDCODE_WORKTREE_LOCATION ?? settings?.location) === "tmp"
                      ? path.join(
                          settings?.tmpdir || os.tmpdir(),
                          "redcode-worktrees",
                          `${path.basename(repository.worktree)}-${SessionEvidence.hash(repository.worktree).slice(0, 8)}`,
                        )
                      : path.join(repository.worktree, ".red", "worktrees"),
                )
                // Include worktrees created outside this process before deciding that the branch is unused.
                yield* worktrees.refresh({ projectID: session.projectID })
                const listed = yield* worktrees.list({ projectID: session.projectID })
                const existing = (yield* Effect.forEach(listed, (item) =>
                  git.repo.discover(item.directory).pipe(
                    Effect.flatMap((entry) =>
                      entry && entry.gitDirectory !== entry.commonDirectory
                        ? git.history.branch(entry)
                        : Effect.succeed(undefined),
                    ),
                    Effect.map((name) => ({ item, name })),
                  ),
                )).find((entry) => entry.name === branch)?.item
                if (!existing && parent === path.join(repository.worktree, ".red", "worktrees")) {
                  const exclude = path.join(repository.commonDirectory, "info", "exclude")
                  const current = yield* Effect.promise(() => Bun.file(exclude).text().catch(() => ""))
                  if (!current.split(/\r?\n/).some((line) => line.trim() === "/.red/worktrees/"))
                    yield* Effect.tryPromise({
                      try: () => Bun.write(exclude, `${current}${current && !current.endsWith("\n") ? "\n" : ""}/.red/worktrees/\n`),
                      catch: (error) => new ToolFailure({ message: `Cannot exclude managed worktrees: ${String(error)}` }),
                    })
                }
                const directory = existing?.directory ?? (yield* worktrees.create({
                  projectID: session.projectID,
                  from: repository.worktree,
                  name: branch,
                  directory: parent,
                })).directory
                if (!existing) {
                  const branchExists = (yield* run(repository.worktree, ["branch", "--list", branch])).trim().length > 0
                  yield* run(directory, ["switch", ...(branchExists ? [] : ["-c"]), branch])
                }
                const relativeDestination = AbsolutePath.make(
                  path.join(directory, path.relative(repository.worktree, session.location.directory)),
                )
                const destination = (yield* fs.isDir(relativeDestination)) ? relativeDestination : directory
                const pendingMove = (yield* sessions.inbox(context.sessionID)).find((item) => item.type === "move")
                if (pendingMove?.type === "move" && pendingMove.payload.location.directory !== destination)
                  return yield* new ToolFailure({ message: "Another Session move is pending; finish it before preparing this worktree" })
                if (destination !== session.location.directory && !pendingMove)
                  yield* sessions.move({ sessionID: context.sessionID, directory: destination, delivery: "steer" })
                const [sourceStatus, worktreeStatus] = yield* Effect.all([
                  run(repository.worktree, ["status", "--short", "--branch"]),
                  run(directory, ["status", "--short", "--branch"]),
                ])
                const output = [
                  `Worktree: ${directory}`,
                  `Branch: ${branch}`,
                  `Session destination: ${destination} (move at the next safe boundary)`,
                  `Source checkout: ${repository.worktree}`,
                  `Source status:\n${sourceStatus}`,
                  `Worktree status:\n${worktreeStatus}`,
                  "Uncommitted source changes remain in the source checkout; inspect them before copying anything into the worktree.",
                  ...(destination !== relativeDestination ? [`The source subdirectory ${session.location.directory} is absent from HEAD; the Session will open at the worktree root.`] : []),
                ].join("\n")
                return { output, content: output, metadata: { directory, branch } }
              }))
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error), error }))),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        if (["plan", "design", "question", "explore", "title", "summary", "compaction"].includes(event.agent)) return
        if (!["write", "edit", "patch", "shell"].includes(event.tool)) return
        if (event.tool === "shell" && SessionTaskFacts.readOnly(event.input)) return
        if (typeof event.input !== "object" || event.input === null) return
        const input = event.input as Record<string, unknown>
        if (event.tool === "shell" && typeof input.command !== "string") return
        if (event.tool === "patch" && typeof input.patchText !== "string") return
        if ((event.tool === "write" || event.tool === "edit") && typeof input.path !== "string") return
        const target = event.tool === "shell" ? input.workdir : event.tool === "patch" ? undefined : input.path
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
          if ((event.tool === "shell" && typeof input.command === "string" && input.command.includes(primary)) ||
              (event.tool === "patch" && typeof input.patchText === "string" && input.patchText.includes(primary)))
            return yield* new ToolFailure({ message: "Command targets the source checkout; use the linked worktree path" })
          return
        }
        const settings = Config.latest(yield* config.entries(), "worktree")
        if (settings?.auto === false || process.env.REDCODE_AUTO_WORKTREE === "0") return
        const relative = path.relative(repository.worktree, absolute)
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return
        if (relative === ".git" || relative.startsWith(`.git${path.sep}`))
          return yield* new ToolFailure({ message: "Direct edits to Git metadata are not allowed" })
        const tool = (yield* ctx.tool.list()).find((item) => item.id === "worktree_prepare")
        if (!tool) return yield* new ToolFailure({ message: "Worktree preparation tool is unavailable" })
        const prepared = yield* tool.execute({}, {
          sessionID: event.sessionID,
          agent: event.agent,
          messageID: event.messageID,
          id: event.id,
          progress: () => Effect.void,
        })
        const directory = prepared.metadata?.directory
        if (typeof directory !== "string" || directory === repository.worktree)
          return yield* new ToolFailure({ message: "The session worktree was not prepared; the source checkout is unchanged" })
        return yield* new ToolFailure({
          message: `Session is moving to ${directory}. Repeat ${event.tool} after the next safe boundary so it uses the worktree's Location, permissions, and filesystem; the source checkout is unchanged.`,
        })
      }).pipe(Effect.mapError((error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error), error }))),
    )
  }),
}
