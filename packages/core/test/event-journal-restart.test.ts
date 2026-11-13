import { expect, test } from "bun:test"
import path from "node:path"
import { Effect, Layer, Stream } from "effect"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { tmpdir } from "./fixture/tmpdir"

const layer = (directory: string) =>
    AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
      Global.node.replace(
        Layer.succeed(
          Global.Service,
          Global.Service.of(
            Global.make({
              home: directory,
              data: directory,
              cache: directory,
              config: directory,
              state: directory,
              tmp: directory,
              bin: directory,
              log: directory,
              repos: directory,
            }),
          ),
        ),
      ),
      Database.node.replace(Database.configured({ path: path.join(directory, "events.db") })),
      Bus.node.replace(Bus.configured({ persist: true })),
    ])

test("a retained durable aggregate log survives closing and reopening the runtime", async () => {
  await using directory = await tmpdir("redcode-event-restart-")
  const sessionID = Session.ID.make("ses_restart_journal")
  const published = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        return yield* bus.publish(SessionEvent.Renamed, { sessionID, title: "retained event" })
      }).pipe(Effect.provide(layer(directory.path))),
    ),
  )
  const replayed = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        return Array.from(yield* bus.log({ aggregateID: sessionID, follow: false }).pipe(Stream.runCollect))
      }).pipe(Effect.provide(layer(directory.path))),
    ),
  )
  expect(replayed.filter((entry) => !Bus.isSynced(entry))).toEqual([published])
})

test("a retained aggregate event survives abrupt process termination after commit", async () => {
  await using directory = await tmpdir("redcode-event-crash-")
  const worker = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/event-journal-worker.ts"), directory.path], {
    stdout: "pipe",
    stderr: "inherit",
  })
  const reader = worker.stdout.getReader()
  let published: unknown
  try {
    const output = await Promise.race([
      (async () => {
        let text = ""
        while (!text.split("\n").some((line) => line.startsWith("EVENT_READY:"))) {
          const chunk = await reader.read()
          if (chunk.done) throw new Error("Worker exited before committing the event")
          text += new TextDecoder().decode(chunk.value)
        }
        while (!text.slice(text.indexOf("EVENT_READY:")).includes("\n")) {
          const chunk = await reader.read()
          if (chunk.done) throw new Error("Worker exited before reporting the event")
          text += new TextDecoder().decode(chunk.value)
        }
        return text
      })(),
      Bun.sleep(45_000).then(() => { throw new Error("Worker did not commit the event in time") }),
    ])
    const line = output.split("\n").find((item) => item.startsWith("EVENT_READY:"))
    if (!line) throw new Error(`Worker returned unexpected output: ${output}`)
    published = JSON.parse(line.slice("EVENT_READY:".length))
  } finally {
    worker.kill()
    await worker.exited
    reader.releaseLock()
  }

  const replayed = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        return Array.from(yield* bus.log({ aggregateID: "ses_restart_journal", follow: false }).pipe(Stream.runCollect))
      }).pipe(Effect.provide(layer(directory.path))),
    ),
  )
  expect([published]).toEqual(replayed.filter((entry) => !Bus.isSynced(entry)))
}, 50_000)
