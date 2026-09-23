export * as AutoWorktree from "./auto-worktree"

import path from "path"
import { DateTime, Effect, Option } from "effect"
import { RepositoryGuard } from "@reddb-io/redcode-core/repository-guard"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { Location } from "@reddb-io/redcode-core/location"
import { AbsolutePath, RelativePath } from "@reddb-io/redcode-core/schema"
import type { EventV2 } from "@reddb-io/redcode-core/event"
import { InstanceState } from "@/effect/instance-state"
import { TuiEvent } from "@/server/tui-event"
import { Session } from "./session"
import type { SessionID } from "./schema"

/**
 * The harness, not the model, gives a writing session its own worktree. The first source write or
 * build command a session makes in the primary checkout creates `<root>/.red/worktrees/<slug>`,
 * moves the session tree there and runs the action against the same relative path in it.
 */
export type Input = {
  readonly sessions: Session.Interface
  readonly events: EventV2.Interface
  readonly sessionID: SessionID
  readonly agent: string
}

/** Agents that never author source: plan and design keep their own placement, the rest only read. */
const READERS = new Set(["plan", "design", "explore", "question", "title", "summary", "compaction", "goal_judge"])

/** The path a write should use: inside the session worktree when `target` lies in the primary checkout. */
export const route = Effect.fn("AutoWorktree.route")(function* (input: Input, target: string) {
  if (READERS.has(input.agent)) return target
  const repository = yield* Effect.promise(() => RepositoryGuard.inspect(target).catch(() => undefined))
  if (!repository || repository.linked) return target
  const claim = yield* ensure(input)
  if (!claim) return target
  return yield* Effect.promise(() => RepositoryGuard.relocate(claim, target))
})

/** The working directory a shell command should use; read-only commands stay in the primary checkout. */
export const workdir = Effect.fn("AutoWorktree.workdir")(function* (input: Input, cwd: string, command: string) {
  if (RepositoryGuard.forbidden(command) || RepositoryGuard.readOnly(command)) return cwd
  return yield* route(input, cwd)
})

/** Creates or reuses the session tree's worktree for the current instance and moves the sessions into it. */
export const ensure = Effect.fn("AutoWorktree.ensure")(function* (input: Input) {
  if (READERS.has(input.agent)) return undefined
  const instance = yield* InstanceState.context
  const current = Option.getOrUndefined(yield* input.sessions.get(input.sessionID).pipe(Effect.option))
  const root = current ? yield* rootSession(input.sessions, current) : undefined
  const name = root ? yield* sessionName(input.sessions, root) : ""
  const claim = yield* Effect.promise(() =>
    RepositoryGuard.claim({ directory: instance.directory, session: root?.id ?? input.sessionID, name }),
  )
  if (!claim) return undefined
  const moved = yield* Effect.forEach(
    [root, current].filter((session, index, all): session is Session.Info =>
      Boolean(session && all.findIndex((item) => item?.id === session.id) === index),
    ),
    (session) => move(input.events, session, claim),
  )
  // One notice per worktree: its creation or the root session's move into it, not each subagent's.
  if (claim.created || moved[0])
    yield* input.events
      .publish(TuiEvent.ToastShow, {
        message: `Working in worktree ${RepositoryGuard.WORKTREES}/${path.basename(claim.worktree)} (branch ${claim.branch})`,
        variant: "info",
        duration: 6_000,
      })
      .pipe(Effect.ignore)
  return claim
})

/** Subagents share their parent's worktree, so the whole session tree is keyed on its root. */
const rootSession = Effect.fnUntraced(function* (sessions: Session.Interface, session: Session.Info) {
  let root = session
  while (root.parentID) {
    const parent = Option.getOrUndefined(yield* sessions.get(root.parentID).pipe(Effect.option))
    if (!parent) return root
    root = parent
  }
  return root
})

/** The session title once generated, else the first thing the user asked. */
const sessionName = Effect.fnUntraced(function* (sessions: Session.Interface, session: Session.Info) {
  if (!Session.isDefaultTitle(session.title)) return session.title
  const messages = Option.getOrUndefined(yield* sessions.messages({ sessionID: session.id }).pipe(Effect.option))
  return (
    messages
      ?.find((message) => message.info.role === "user")
      ?.parts.flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
      .join(" ") ?? ""
  )
})

/** Publishes the session's move into the worktree unless it already works there. */
const move = Effect.fnUntraced(function* (
  events: EventV2.Interface,
  session: Session.Info,
  claim: RepositoryGuard.Claim,
) {
  const directory = yield* Effect.promise(() => RepositoryGuard.relocate(claim, session.directory))
  if (directory === session.directory) return false
  yield* events.publish(SessionEvent.Moved, {
    sessionID: session.id,
    location: Location.Ref.make({
      directory: AbsolutePath.make(directory),
      ...(session.workspaceID ? { workspaceID: session.workspaceID } : {}),
    }),
    subdirectory: RelativePath.make(path.relative(claim.worktree, directory).replaceAll("\\", "/")),
    timestamp: yield* DateTime.now,
  })
  return true
})
