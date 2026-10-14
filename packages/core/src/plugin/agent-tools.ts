export * as AgentToolsPlugin from "./agent-tools.js"

import path from "node:path"
import { Effect, Schema, Stream } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { AgentTools } from "../agent-tools.js"
import { Mcp } from "../mcp/index.js"
import { WorktreeStrategies } from "../worktree/strategies.js"
import { Worktree } from "@opencode/schema/worktree"
import { AbsolutePath } from "@opencode/schema/schema"
import { Skill } from "@opencode/schema/skill"
import { Agent } from "../agent.js"
import { Permission } from "../permission.js"

export const Plugin = define({
  id: "redcode.agent-tools",
  effect: Effect.fn(function* (ctx) {
    // Explicit placements use their own Environment; host-cache commands are not portable into it.
    if (ctx.location.workspaceID) return
    const tools = yield* AgentTools.Service
    const mcp = yield* Mcp.Service
    const worktrees = yield* WorktreeStrategies.Service
    const loaded = { tools: (yield* tools.list()).tools }
    // Host settings change all active locations; registrations leave with their owning plugin scope.
    yield* tools.changes().pipe(
      Stream.runForEach(() =>
        tools.list().pipe(
          Effect.tap((snapshot) => Effect.sync(() => (loaded.tools = snapshot.tools))),
          Effect.andThen(
            Effect.all([mcp.reload(), worktrees.reload(), ctx.skill.reload(), ctx.agent.reload()], {
              concurrency: "unbounded",
            }),
          ),
          Effect.catchCause((cause) => Effect.logError("failed to reload agent tools", { cause })),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    loaded.tools = (yield* tools.list()).tools
    yield* mcp.transform((editor) => {
      for (const item of loaded.tools) {
        if (item.id === "rift" || !item.settings.enabled || !item.supported || !item.command) continue
        editor.set(`redcode_${item.id.replaceAll("-", "_")}`, {
          type: "local",
          command: [...item.command],
          timeout: { startup: 30_000, execution: item.settings.timeout ?? 120_000 },
        })
      }
    })
    yield* worktrees.transform((editor) => {
      const item = loaded.tools.find((tool) => tool.id === "rift")
      if (!item?.settings.enabled || !item.supported || !item.command) return
      editor.add({
        id: Worktree.StrategyID.make("rift"),
        create: (input) =>
          Effect.gen(function* () {
            if (input.branch)
              return yield* Effect.fail(
                new Worktree.OperationError({
                  message: "Rift snapshots preserve the source state and do not accept a starting ref",
                }),
              )
            const value = yield* tools
              .rift({
                command: "create",
                from: input.sourceDirectory,
                into: path.dirname(input.directory),
                name: path.basename(input.directory),
                copyAll: item.settings.copyAll ?? false,
                hooks: false,
              })
              .pipe(Effect.mapError((error) => new Worktree.OperationError({ message: error.message })))
            return {
              directory: yield* Schema.decodeUnknownEffect(ResponsePath)(value).pipe(
                Effect.mapError(
                  () => new Worktree.OperationError({ message: "Rift returned an invalid workspace path" }),
                ),
              ),
            }
          }),
        remove: (input) =>
          Effect.gen(function* () {
            const children = yield* tools
              .rift({ command: "list", of: input.directory })
              .pipe(Effect.mapError((error) => new Worktree.OperationError({ message: error.message })))
            const paths = yield* Schema.decodeUnknownEffect(Schema.Array(ResponsePath))(children).pipe(
              Effect.mapError(
                () => new Worktree.OperationError({ message: "Rift returned an invalid workspace inventory" }),
              ),
            )
            if (paths.length)
              return yield* Effect.fail(new Worktree.OperationError({ message: "Remove child Rift workspaces first" }))
            yield* tools
              .rift({ command: "remove", at: input.directory, hooks: false })
              .pipe(Effect.mapError((error) => new Worktree.OperationError({ message: error.message })))
          }),
        list: (directory) =>
          Effect.gen(function* () {
            const value = yield* tools
              .rift({ command: "descendants", of: directory })
              .pipe(
                Effect.catch((error) =>
                  /workspace_not_initialized|initialization_required/.test(error.message)
                    ? Effect.succeed([])
                    : Effect.fail(new Worktree.OperationError({ message: error.message })),
                ),
              )
            const paths = yield* Schema.decodeUnknownEffect(Schema.Array(ResponsePath))(value).pipe(
              Effect.mapError(
                () => new Worktree.OperationError({ message: "Rift returned an invalid workspace inventory" }),
              ),
            )
            return [
              { directory, type: "root" as const },
              ...paths.map((directory) => ({ directory, type: "worktree" as const })),
            ]
          }),
      })
    })
    yield* ctx.skill.transform((editor) => {
      for (const item of loaded.tools) {
        if (!item.settings.enabled || !item.supported || !item.command) continue
        editor.add(
          Skill.Info.make({
            id: Skill.ID.make(`redcode-${item.id}`),
            name: Skill.Name.make(item.id),
            description: `Use ${item.id} on the connected execution host.`,
            path: AbsolutePath.make(`/builtin/redcode-${item.id}.md`),
            content: instructions(item.id, item.extensionDirectory),
          }),
        )
      }
    })
    // These actions control the user's existing apps; ask by default. Explicit user policies still apply later.
    yield* ctx.agent.transform((editor) => {
      for (const agent of editor.list())
        editor.update(agent.id, (item) => {
          for (const tool of loaded.tools) {
            if (!tool.settings.enabled || tool.id === "rift") continue
            const action = `redcode_${tool.id.replaceAll("-", "_")}_*`
            item.permissions.push({
              action,
              resource: "*",
              effect:
                item.id === Agent.ID.make("plan") ||
                Permission.evaluate(action, "*", item.permissions).effect === "deny"
                  ? "deny"
                  : "ask",
            })
          }
        })
    })
  }),
})

const ResponsePath = AbsolutePath.check(
  Schema.makeFilter((value) => path.isAbsolute(value), { expected: "absolute host path" }),
)

function instructions(id: AgentTools.ID, extensionDirectory?: string) {
  const host =
    "This capability runs on the connected server's machine. A remote worker does not have access to the client's desktop or browser. Use only the configured MCP tools; observe the target before taking action and preserve user-owned sessions."
  if (id === "rift")
    return "Create isolated copy-on-write workspaces through the worktree API. Initialize the selected source explicitly before creation. Snapshots preserve that source's current edits and index; they cannot select a different starting ref. Hooks are disabled. Review results before integration, and remove child snapshots before their parent."
  if (id === "browser-control")
    return `${host}\nFirst call the Browser Control MCP skill tool and follow the package's exact workflow. Discover and inspect the browser session before running Playwright. Use a consistent session ID across calls. Browser login and extension installation belong to the user. The extension directory is ${extensionDirectory ?? "available in Agent tools settings after installation"}.`
  if (id === "terminal-control")
    return `${host}\nList existing terminal sessions, inspect the visible screen, then send exact input to the chosen session. Wait for the expected state and capture evidence. Test small and large viewports. Stop only sessions created for this task; leave the user's terminals running.`
  return `${host}\nSelect the intended application and refresh its accessibility state before clicking or typing. Verify the resulting state. Let the user complete login, authentication and operating-system permission steps. Do not submit messages or publish changes without authorization.`
}
