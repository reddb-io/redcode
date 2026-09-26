export * as ConfigWorktree from "./worktree.js"

import { Schema } from "effect"

export const Info = Schema.Struct({
  directory: Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()), Schema.optional).annotate({
    description: "Parent directory for new worktrees, relative to the project's primary checkout when not absolute",
  }),
  auto: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Move a writing session into its own worktree before its first source edit or build command (default: true)",
  }),
  location: Schema.Literals(["repo", "tmp"]).pipe(Schema.optional).annotate({
    description: "Place automatic worktrees inside the repository or under the temporary directory",
  }),
  tmpdir: Schema.String.pipe(Schema.optional).annotate({
    description: "Temporary parent directory for automatic worktrees when location is tmp",
  }),
}).annotate({ identifier: "Config.Worktree" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
