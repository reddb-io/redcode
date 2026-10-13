export * as Worktree from "./worktree.js"

import { Schema } from "effect"
import { durable, ephemeral, inventory } from "./event.js"
import { AbsolutePath, optional } from "./schema.js"
import { Project } from "./project.js"

export const StrategyID = Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()), Schema.brand("Worktree.StrategyID"))
export type StrategyID = typeof StrategyID.Type

export const CreateInput = Schema.Struct({
  projectID: Project.ID,
  from: optional(AbsolutePath),
  branch: optional(Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()))),
  directory: optional(AbsolutePath).annotate({
    description:
      "Parent directory for the new worktree. Uses the project's canonical configuration, then defaults to the server's data directory under worktree/<first six project ID characters>.",
  }),
  name: optional(Schema.String),
}).annotate({ identifier: "Worktree.CreateInput" })
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

export const RemoveInput = Schema.Struct({
  projectID: Project.ID,
  directory: AbsolutePath,
  force: Schema.Boolean,
}).annotate({ identifier: "Worktree.RemoveInput" })
export interface RemoveInput extends Schema.Schema.Type<typeof RemoveInput> {}

export const Info = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "Worktree.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Directory = Schema.Struct({
  directory: AbsolutePath,
  strategy: optional(Schema.String),
}).annotate({ identifier: "Worktree.Directory" })
export interface Directory extends Schema.Schema.Type<typeof Directory> {}

export const ListEntry = Schema.Struct({
  directory: AbsolutePath,
  type: Schema.Literals(["root", "worktree"]),
}).annotate({ identifier: "Worktree.ListEntry" })
export interface ListEntry extends Schema.Schema.Type<typeof ListEntry> {}

export const InspectInput = Schema.Struct({
  projectID: Project.ID,
  directory: AbsolutePath,
  target: AbsolutePath,
}).annotate({ identifier: "Worktree.InspectInput" })
export interface InspectInput extends Schema.Schema.Type<typeof InspectInput> {}
export const Review = Schema.Struct({
  directory: AbsolutePath,
  target: AbsolutePath,
  branch: Schema.NullOr(Schema.String),
  head: Schema.String,
  targetHead: Schema.String,
  dirty: Schema.Boolean,
  targetDirty: Schema.Boolean,
  status: Schema.String,
  diff: Schema.String,
  truncated: Schema.Boolean,
  managed: Schema.Boolean,
}).annotate({ identifier: "Worktree.Review" })
export interface Review extends Schema.Schema.Type<typeof Review> {}
export const IntegrateInput = Schema.Struct({
  ...InspectInput.fields,
  head: Schema.String,
  targetHead: Schema.String,
}).annotate({ identifier: "Worktree.IntegrateInput" })
export interface IntegrateInput extends Schema.Schema.Type<typeof IntegrateInput> {}
export const CheckpointInput = Schema.Struct({
  projectID: Project.ID,
  directory: AbsolutePath,
  message: Schema.NonEmptyString,
}).annotate({ identifier: "Worktree.CheckpointInput" })
export interface CheckpointInput extends Schema.Schema.Type<typeof CheckpointInput> {}
export const ArchiveInput = Schema.Struct({
  projectID: Project.ID,
  directory: AbsolutePath,
  head: Schema.String,
}).annotate({ identifier: "Worktree.ArchiveInput" })
export interface ArchiveInput extends Schema.Schema.Type<typeof ArchiveInput> {}
export const Archive = Schema.Struct({
  reference: Schema.String,
  head: Schema.String,
  createdAt: Schema.String,
}).annotate({ identifier: "Worktree.Archive" })
export interface Archive extends Schema.Schema.Type<typeof Archive> {}

export class OperationError extends Schema.TaggedError<OperationError>()("Worktree.OperationError", {
  message: Schema.String,
  forceRequired: optional(Schema.Boolean),
}) {}

export const List = Schema.Array(Directory).annotate({ identifier: "Worktree.List" })
export type List = typeof List.Type

const Updated = ephemeral({
  type: "worktree.updated",
  schema: { projectID: Project.ID },
})

const Resolved = durable({
  type: "worktree.resolved",
  durable: { aggregate: "projectID", version: 1 },
  schema: {
    projectID: Project.ID,
    directory: AbsolutePath,
    previous: Project.ID,
    adopted: optional(Schema.Array(Project.ID)),
  },
})

export const Event = { Updated, Resolved, Definitions: inventory(Updated, Resolved) }

export function adopt(
  session: { readonly projectID: string; readonly directory: string; readonly workspaceID?: string },
  event: {
    readonly projectID: string
    readonly directory: string
    readonly previous: string
    readonly adopted?: ReadonlyArray<string>
  },
) {
  if (session.workspaceID) return
  if (
    session.projectID !== event.previous &&
    session.projectID !== Project.ID.global &&
    !event.adopted?.includes(session.projectID)
  )
    return
  if (session.projectID === event.projectID) return
  const normalize = (value: string) =>
    value
      .replaceAll("\\", "/")
      .split("/")
      .reduce((result, segment) => {
        if (!segment || segment === ".") return result
        if (segment === "..") return result.slice(0, result.lastIndexOf("/"))
        return `${result}/${segment}`
      }, "")
  const directory = normalize(session.directory)
  const root = normalize(event.directory)
  const windows = /^\/[a-z]:/i.test(root)
  const key = windows ? directory.toLowerCase() : directory
  const parent = windows ? root.toLowerCase() : root
  if (key !== parent && !key.startsWith(parent + "/")) return
  return {
    projectID: event.projectID,
    subpath: key === parent ? undefined : directory.slice(root.length + 1),
  }
}
