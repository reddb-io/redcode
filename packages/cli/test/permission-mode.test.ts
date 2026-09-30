import { NodeServices } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { Commands } from "../src/commands/commands"
import { applyYoloFlag, permissionMode } from "../src/permission-mode"

test.each([
  { args: [], auto: false, yolo: false },
  { args: ["--auto"], auto: true, yolo: false },
  { args: ["--yolo"], auto: true, yolo: true },
  { args: ["--dangerously-skip-permissions"], auto: true, yolo: true },
  { args: ["--auto", "--yolo"], auto: true, yolo: true },
])("run parses permission flags: $args", async ({ args, auto, yolo }) => {
  const received: { auto: boolean; yolo: boolean }[] = []
  const command = Commands.commands.run.spec.pipe(
    Command.withHandler((input) => Effect.sync(() => void received.push(permissionMode(input)))),
  )
  await Effect.runPromise(Command.runWith(command, { version: "test" })(args).pipe(Effect.provide(NodeServices.layer)))
  expect(received).toEqual([{ auto, yolo }])
})

test("--yolo marks the environment the server reads; --auto leaves it alone", () => {
  const env: Record<string, string | undefined> = {}
  applyYoloFlag(false, env)
  expect(env.REDCODE_YOLO).toBeUndefined()
  applyYoloFlag(true, env)
  expect(env.REDCODE_YOLO).toBe("1")
})
