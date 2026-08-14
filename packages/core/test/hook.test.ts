import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { HookV2 } from "@opencode-ai/core/hook"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"

function hookLayer(directory: string, state: string) {
  return AppNodeBuilder.build(HookV2.node, [
    [
      Location.node,
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location({ directory: AbsolutePath.make(directory) }, { projectDirectory: AbsolutePath.make(directory) }),
        ),
      ),
    ],
    [Global.node, Global.layerWith({ config: path.join(directory, "global"), state })],
  ])
}

const run = <A, E>(effect: Effect.Effect<A, E, HookV2.Service>, directory: string, state: string) =>
  Effect.runPromise(effect.pipe(Effect.provide(hookLayer(directory, state)), Effect.scoped))

describe("HookV2", () => {
  test("requires trust, runs all matching handlers in parallel, and deny wins", async () => {
    await using project = await tmpdir()
    const config = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash|Write",
            hooks: [
              {
                type: "command",
                command: `${process.execPath} -e "process.stdout.write(JSON.stringify({continue:true,additionalContext:'ok'}))"`,
              },
              {
                type: "command",
                command: `${process.execPath} -e "process.stderr.write('blocked');process.exit(2)"`,
              },
            ],
          },
        ],
        Setup: [{ hooks: [{ type: "prompt", prompt: "unsupported" }] }],
      },
    }
    await fs.writeFile(path.join(project.path, "opencode.json"), JSON.stringify(config))

    const before = await run(
      HookV2.Service.use((hooks) => hooks.status()),
      project.path,
      path.join(project.path, "state"),
    )
    expect(before.trust.trusted).toBe(false)
    expect(before.definitions.filter((item) => item.support === "untrusted")).toHaveLength(2)
    expect(before.definitions.find((item) => item.event === "Setup")?.support).toBe("unsupported")

    const output = await run(
      Effect.gen(function* () {
        const hooks = yield* HookV2.Service
        yield* hooks.trust()
        return yield* hooks.run({ event: "PreToolUse", matcher: "Bash", tool_name: "Bash" })
      }),
      project.path,
      path.join(project.path, "state"),
    )
    expect(output.continue).toBe(false)
    expect(output.decision).toBe("deny")
    expect(output.reason).toBe("blocked")
  })

  test("changing executable definitions invalidates project trust", async () => {
    await using project = await tmpdir()
    const state = path.join(project.path, "state")
    const filepath = path.join(project.path, "opencode.json")
    await fs.writeFile(
      filepath,
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "true" }] }] } }),
    )
    await run(
      HookV2.Service.use((hooks) => hooks.trust()),
      project.path,
      state,
    )
    await fs.writeFile(
      filepath,
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "false" }] }] } }),
    )

    const status = await run(
      HookV2.Service.use((hooks) => hooks.status()),
      project.path,
      state,
    )
    expect(status.trust.trusted).toBe(false)
    expect(status.definitions[0]?.support).toBe("untrusted")
  })

  test("imports Claude project hooks explicitly and preserves surrounding JSONC", async () => {
    await using project = await tmpdir()
    await fs.mkdir(path.join(project.path, ".claude"))
    await fs.writeFile(
      path.join(project.path, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo checked" }] }],
        },
      }),
    )
    await fs.writeFile(path.join(project.path, "opencode.jsonc"), '{\n  // keep me\n  "model": "test/model"\n}\n')

    const result = await run(
      HookV2.Service.use((hooks) => hooks.importClaude()),
      project.path,
      path.join(project.path, "state"),
    )
    const written = await fs.readFile(path.join(project.path, "opencode.jsonc"), "utf8")
    expect(result.imported).toBe(1)
    expect(result.restart_required).toBe(true)
    expect(written).toContain("// keep me")
    expect(written).toContain('"PreToolUse"')
  })

  test("never imports project hooks into the global config", async () => {
    await using project = await tmpdir()
    await fs.mkdir(path.join(project.path, ".claude"))
    await fs.mkdir(path.join(project.path, "global"))
    await fs.writeFile(
      path.join(project.path, ".claude", "settings.json"),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "true" }] }] } }),
    )
    const global = path.join(project.path, "global", "opencode.json")
    await fs.writeFile(global, JSON.stringify({ model: "global/model" }))

    const result = await run(
      HookV2.Service.use((hooks) => hooks.importClaude()),
      project.path,
      path.join(project.path, "state"),
    )
    expect(result.target).toBe(path.join(project.path, "opencode.json"))
    expect(await fs.readFile(global, "utf8")).toBe(JSON.stringify({ model: "global/model" }))
  })
})
