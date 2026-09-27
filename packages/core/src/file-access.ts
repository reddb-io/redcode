export * as FileAccess from "./file-access.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Array, Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { Location } from "./location.js"
import { Permission } from "./permission.js"
import { Project } from "./project.js"
import { AbsolutePath } from "./schema.js"
import type { SessionErrors } from "./session/error.js"
import type { Tool } from "./tool.js"

export const Kind = Schema.Literals(["file", "directory"])
export type Kind = typeof Kind.Type

export const ResolveInput = Schema.Struct({
  path: Schema.String,
  /** Selects the external approval boundary; it does not validate the target type. */
  kind: Kind.pipe(Schema.optional),
})
export type ResolveInput = typeof ResolveInput.Type

export interface ExternalDirectoryAuthorization {
  readonly action: "external_directory"
  /** Lexical directory used as the external approval boundary. */
  readonly directory: AbsolutePath
  readonly resource: string
  readonly save: string
}

export const externalDirectoryPermission = (input: ExternalDirectoryAuthorization) => ({
  action: input.action,
  resources: [input.resource],
  save: [input.save],
})

export interface Target {
  readonly absolute: AbsolutePath
  /** Location-relative for internal paths, absolute for external paths. */
  readonly resource: string
  readonly externalDirectory?: ExternalDirectoryAuthorization
}

export type Invocation = Pick<Tool.Context, "sessionID" | "agent" | "messageID" | "id">

export interface ReadOptions {
  /** A target already authorized by this invocation, used for filename recovery. */
  readonly siblingOf: Target
}

export interface Interface {
  /** Preserve the lexical target and resolve its physical approval boundary without requesting approval. */
  readonly resolve: (input: ResolveInput) => Effect.Effect<Target, FSUtil.Error>
  /** Approve external directories in one batch, preserving first-seen resource order. */
  readonly authorizeExternal: (
    targets: readonly Target[],
    context: Invocation,
    metadata?: Permission.AssertInput["metadata"],
  ) => Effect.Effect<void, Error | SessionErrors.NotFoundError>
  /** Resolve a read target and obtain external-directory approval before read approval. */
  readonly authorizeRead: (
    file: string,
    context: Invocation,
    options?: ReadOptions,
  ) => Effect.Effect<Target, FSUtil.Error | Error | SessionErrors.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileAccess") {}

/** Expand a leading ~ and normalize Windows shell paths before lexical resolution. */
export const resolvePath = (directory: string, input: string, home = Global.Path.home) => {
  const normalized = FSUtil.windowsPath(input)
  return path.resolve(
    directory,
    normalized === "~"
      ? home
      : normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))
        ? path.join(home, normalized.slice(2))
        : normalized,
  )
}

const slash = (value: string) => value.replaceAll("\\", "/")
const invocation = (context: Invocation) => ({
  sessionID: context.sessionID,
  agent: context.agent,
  source: { type: "tool" as const, messageID: context.messageID, id: context.id },
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const permission = yield* Permission.Service

    const resolve = Effect.fn("FileAccess.resolve")(function* (input: ResolveInput) {
      const absolute = AbsolutePath.make(resolvePath(location.directory, input.path))
      const physical = yield* realTarget(fs, absolute)
      const worktree = path.resolve(location.project.directory)
      const physicalDirectory = yield* realTarget(fs, location.directory)
      const physicalWorktree = worktree === path.parse(worktree).root ? worktree : yield* realTarget(fs, worktree)
      const lexicalInternal =
        FSUtil.contains(location.directory, absolute) ||
        (worktree !== path.parse(worktree).root && FSUtil.contains(worktree, absolute))
      const physicalInternal =
        FSUtil.contains(physicalDirectory, physical) ||
        (worktree !== path.parse(worktree).root && FSUtil.contains(physicalWorktree, physical))
      if (lexicalInternal && physicalInternal) {
        return {
          absolute,
          resource: slash(path.relative(location.directory, absolute) || "."),
        } satisfies Target
      }
      const external = physicalInternal ? absolute : physical
      const type =
        input.kind === "directory"
          ? "Directory"
          : input.kind === "file"
            ? "File"
            : (yield* fs.stat(external).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined)))
                ?.type
      const directory = AbsolutePath.make(type === "Directory" ? external : path.dirname(external))
      return {
        absolute,
        resource: lexicalInternal ? slash(path.relative(location.directory, absolute) || ".") : slash(absolute),
        externalDirectory: {
          action: "external_directory",
          directory,
          resource: slash(path.join(directory, "*")),
          save: slash(path.join((yield* Project.root(fs, directory)) ?? directory, "*")),
        },
      } satisfies Target
    })

    const authorizeExternal = Effect.fn("FileAccess.authorizeExternal")(function* (
      targets: readonly Target[],
      context: Invocation,
      metadata?: Permission.AssertInput["metadata"],
    ) {
      const external = Array.dedupeWith(
        targets.flatMap((target) => (target.externalDirectory ? [target.externalDirectory] : [])),
        (left, right) => left.resource === right.resource,
      )
      if (external.length === 0) return
      yield* permission.assert({
        action: "external_directory",
        resources: external.map((item) => item.resource),
        save: external.map((item) => item.save),
        ...(metadata === undefined ? {} : { metadata }),
        ...invocation(context),
      })
    })

    const authorizeRead = Effect.fn("FileAccess.authorizeRead")(function* (
      file: string,
      context: Invocation,
      options?: ReadOptions,
    ) {
      const target = yield* resolve({ path: file, kind: options ? "file" : undefined })
      const sibling = options && path.dirname(target.absolute) === path.dirname(options.siblingOf.absolute)

      // Filename recovery shares the directory approval, but checks the recovered file's own read rules.
      if (!sibling) yield* authorizeExternal([target], context)
      yield* permission.assert({
        action: "read",
        resources: [target.resource],
        save: ["*"],
        ...invocation(context),
      })
      return target
    })

    return Service.of({ resolve, authorizeExternal, authorizeRead })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node, Location.node, Permission.node] })

function realTarget(fs: FSUtil.Interface, target: string): Effect.Effect<string, FSUtil.Error> {
  return Effect.gen(function* () {
    // A patch can replace a file with a directory before the new child exists.
    const real = yield* fs.realPath(target).pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined),
      Effect.catchReason("PlatformError", "BadResource", () => Effect.undefined),
    )
    if (real !== undefined) return real
    const link = yield* fs.readLink(target).pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined),
      Effect.catchReason("PlatformError", "BadResource", () => Effect.undefined),
    )
    if (link !== undefined) return yield* realTarget(fs, path.resolve(path.dirname(target), link))
    const parent = path.dirname(target)
    if (parent === target) return target
    return path.join(yield* realTarget(fs, parent), path.basename(target))
  })
}
