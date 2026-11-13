import { expect, test } from "bun:test"
import path from "node:path"
import { unlink, access } from "node:fs/promises"
import { Deferred, Effect, Exit, Layer, Schema } from "effect"
import { Event } from "@opencode/schema/event"
import { EventJournal } from "@opencode/core/event/journal"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { tmpdir } from "./fixture/tmpdir"
import { location } from "./fixture/location"

const Message = Event.ephemeral({ type: "journal.test", schema: { text: Schema.String } })
const key = new Uint8Array(32).fill(7)
const event = (text: string) => ({ id: Event.ID.create(), type: Message.type, created: 1, data: { text } })
const database = (directory: string) => Database.layer({ path: path.join(directory, "events.db") }).pipe(
  Layer.provide(Layer.succeed(Global.Service, Global.Service.of(Global.make({
    home: directory, data: directory, cache: directory, config: directory, state: directory,
    tmp: directory, bin: directory, log: directory, repos: directory,
  })))),
)
const busLayer = (directory: string) => AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
  Global.node.replace(Layer.succeed(Global.Service, Global.Service.of(Global.make({
    home: directory, data: directory, cache: directory, config: directory,
    state: directory, tmp: directory, bin: directory, log: directory, repos: directory,
  })))),
  Database.node.replace(Database.configured({ path: path.join(directory, "events.db") })),
])

test("reopens an unacknowledged encrypted delivery and removes it only after acknowledgement", async () => {
  await using directory = await tmpdir("redcode-delivery-")
  const sent = event("sensitive session content")
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { db } = yield* Database.Service
    const journal = EventJournal.make(db, key)
    yield* journal.register("consumer", [Message])
    yield* db.transaction(() => journal.enqueue(sent, Message)).pipe(Effect.orDie)
    const rows = yield* db.all<{ payload: string }>("SELECT payload FROM event_delivery")
    expect(Buffer.from(rows[0]!.payload, "base64").includes(Buffer.from(sent.data.text))).toBe(false)
    expect((yield* journal.next("consumer", [Message]))?.event).toEqual(sent)
  }).pipe(Effect.provide(database(directory.path)))))
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { db } = yield* Database.Service
    const journal = EventJournal.make(db, key)
    yield* journal.register("consumer", [Message])
    const delivery = yield* journal.next("consumer", [Message])
    expect(delivery?.event).toEqual(sent)
    if (!delivery) throw new Error("Missing delivery")
    yield* delivery.ack
    expect(yield* journal.next("consumer", [Message])).toBeUndefined()
  }).pipe(Effect.provide(database(directory.path)))))
})

test("one subscriber cannot acknowledge another subscriber's delivery", async () => {
  await using directory = await tmpdir("redcode-delivery-fanout-")
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { db } = yield* Database.Service
    const journal = EventJournal.make(db, key)
    yield* journal.register("first", [Message])
    yield* journal.register("second", [Message])
    const sent = event("broadcast")
    yield* db.transaction(() => journal.enqueue(sent, Message)).pipe(Effect.orDie)
    const first = yield* journal.next("first", [Message])
    if (!first) throw new Error("Missing first delivery")
    yield* first.ack
    expect(yield* journal.next("first", [Message])).toBeUndefined()
    expect((yield* journal.next("second", [Message]))?.event).toEqual(sent)
    const wrongKey = EventJournal.make(db, new Uint8Array(32).fill(8))
    expect(Exit.isFailure(yield* wrongKey.next("second", [Message]).pipe(Effect.exit))).toBe(true)
    expect((yield* journal.next("second", [Message]))?.event).toEqual(sent)
  }).pipe(Effect.provide(database(directory.path)))))
})

test("a bounded batch keeps every event until its acknowledgement succeeds", async () => {
  await using directory = await tmpdir("redcode-delivery-batch-")
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { db } = yield* Database.Service
    const journal = EventJournal.make(db, key)
    yield* journal.register("batch", [Message])
    const sent = Array.from({ length: 40 }, (_, index) => event(`event-${index}`))
    yield* db.transaction(() => Effect.forEach(sent, (item) => journal.enqueue(item, Message), { discard: true })).pipe(Effect.orDie)
    const first = yield* journal.nextBatch("batch", [Message])
    expect(first?.events).toEqual(sent.slice(0, 32))
    expect((yield* journal.nextBatch("batch", [Message]))?.events).toEqual(sent.slice(0, 32))
    if (!first) throw new Error("Missing first batch")
    yield* first.ack
    const second = yield* journal.nextBatch("batch", [Message])
    expect(second?.events).toEqual(sent.slice(32))
    if (!second) throw new Error("Missing second batch")
    yield* second.ack
    expect(yield* journal.nextBatch("batch", [Message])).toBeUndefined()
  }).pipe(Effect.provide(database(directory.path)))))
})

test("persists filtered subscriptions without retaining unrelated events or plaintext filter values", async () => {
  await using directory = await tmpdir("redcode-delivery-filter-")
  const filter = { type: Message.type, field: "text", value: "private-filter-value" }
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { db } = yield* Database.Service
    const journal = EventJournal.make(db, key)
    yield* journal.register("filtered", [Message], undefined, filter)
    yield* db.transaction(() => Effect.gen(function* () {
      yield* journal.enqueue(event("other"), Message)
      yield* journal.enqueue(event(filter.value), Message)
    })).pipe(Effect.orDie)
    const subscriptions = yield* db.all<{ filter: string }>("SELECT filter FROM event_subscription")
    expect(subscriptions[0]?.filter).not.toContain(filter.value)
    expect(yield* db.all("SELECT seq FROM event_delivery")).toHaveLength(1)
    const incompatible = yield* journal.register("filtered", [Message], undefined, { ...filter, value: "different" }).pipe(Effect.exit)
    expect(Exit.isFailure(incompatible)).toBe(true)
    expect(((yield* journal.next("filtered", [Message]))?.event.data as { text: string }).text).toBe(filter.value)
    const wrongKey = EventJournal.make(db, new Uint8Array(32).fill(8))
    expect(Exit.isFailure(yield* db.transaction(() => wrongKey.enqueue(event("other"), Message)).pipe(Effect.exit))).toBe(true)
    expect(yield* db.all("SELECT seq FROM event_delivery")).toHaveLength(1)
  }).pipe(Effect.provide(database(directory.path)))))
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { db } = yield* Database.Service
    const journal = EventJournal.make(db, key)
    yield* journal.register("filtered", [Message], undefined, filter)
    const delivery = yield* journal.next("filtered", [Message])
    expect((delivery?.event.data as { text: string }).text).toBe(filter.value)
    if (!delivery) throw new Error("Missing filtered delivery")
    yield* delivery.ack
    expect(yield* journal.next("filtered", [Message])).toBeUndefined()
  }).pipe(Effect.provide(database(directory.path)))))
})

test("a basename filter retains matching paths across reopening", async () => {
  await using directory = await tmpdir("redcode-delivery-basename-")
  const filter = { type: Message.type, field: "text", value: "HEAD", projection: "basename" as const }
  const wanted = event(path.join(directory.path, ".git", "HEAD"))
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { db } = yield* Database.Service
    const journal = EventJournal.make(db, key)
    yield* journal.register("branch", [Message], undefined, filter)
    yield* db.transaction(() => Effect.gen(function* () {
      yield* journal.enqueue(event(path.join(directory.path, ".git", "config")), Message)
      yield* journal.enqueue(wanted, Message)
    })).pipe(Effect.orDie)
    expect(yield* db.all("SELECT seq FROM event_delivery")).toHaveLength(1)
  }).pipe(Effect.provide(database(directory.path)))))
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { db } = yield* Database.Service
    const journal = EventJournal.make(db, key)
    yield* journal.register("branch", [Message], undefined, filter)
    expect((yield* journal.next("branch", [Message]))?.event).toEqual(wanted)
  }).pipe(Effect.provide(database(directory.path)))))
})

test("an unacknowledged delivery survives abrupt termination of the consumer process", async () => {
  await using directory = await tmpdir("redcode-delivery-crash-")
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/delivery-worker.ts"), directory.path], {
    stdout: "pipe", stderr: "inherit",
  })
  const reader = child.stdout.getReader()
  let sent: unknown
  try {
    const line = await Promise.race([
      (async () => {
        let output = ""
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) throw new Error("Worker exited before reporting its delivery")
          output += new TextDecoder().decode(chunk.value)
          const ready = output.split("\n").find((item) => item.startsWith("DELIVERY_READY:") && item.endsWith("}"))
          if (ready) return ready
        }
      })(),
      Bun.sleep(45_000).then(() => { throw new Error("Worker did not report a delivery") }),
    ])
    sent = JSON.parse(line.slice("DELIVERY_READY:".length))
  } finally {
    child.kill()
    await child.exited
    reader.releaseLock()
  }
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const bus = yield* Bus.Service
    const { db } = yield* Database.Service
    const received = yield* Deferred.make<Event.Payload>()
    const consume = yield* bus.consume("consumer", [Message], (event) => Deferred.succeed(received, event).pipe(Effect.asVoid))
    yield* consume.pipe(Effect.forkScoped({ startImmediately: true }))
    expect(sent).toEqual(yield* Deferred.await(received).pipe(Effect.timeout("5 seconds")))
    while ((yield* db.all("SELECT seq FROM event_delivery")).length) yield* Effect.sleep("20 millis")
  }).pipe(Effect.provide(busLayer(directory.path)))))
}, 50_000)

test("a missing key prevents restart without replacing the key or deleting pending events", async () => {
  await using directory = await tmpdir("redcode-delivery-missing-key-")
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const bus = yield* Bus.Service
    yield* bus.consume("consumer", [Message], () => Effect.void)
    yield* bus.publish(Message, { text: "pending" })
  }).pipe(Effect.provide(busLayer(directory.path)))))
  const keyFile = path.join(directory.path, "event-journal", "key")
  await unlink(keyFile)
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const bus = yield* Bus.Service
    const { db } = yield* Database.Service
    const exit = yield* bus.consume("consumer", [Message], () => Effect.void).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    const publication = yield* bus.publish(Message, { text: "must not be accepted" }).pipe(Effect.exit)
    expect(Exit.isFailure(publication)).toBe(true)
    expect(yield* db.all("SELECT seq FROM event_delivery")).toHaveLength(1)
  }).pipe(Effect.provide(busLayer(directory.path)))))
  await expect(access(keyFile)).rejects.toThrow()
}, 30_000)

test("named location consumers recover only their own pending events after reopening", async () => {
  await using directory = await tmpdir("redcode-delivery-location-")
  const a = Location.Ref.make({ directory: AbsolutePath.make("/project-a") })
  const b = Location.Ref.make({ directory: AbsolutePath.make("/project-b") })
  const published = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const bus = yield* Bus.Service
    yield* bus.consume("location.consumer", [Message], () => Effect.void).pipe(
      Effect.provideService(Location.Service, location(a)),
    )
    yield* bus.consume("location.consumer", [Message], () => Effect.void).pipe(
      Effect.provideService(Location.Service, location(b)),
    )
    const local = yield* bus.publish(Message, { text: "only-a" }, { location: a })
    const global = yield* bus.publish(Message, { text: "both" }, { global: true })
    return { local, global }
  }).pipe(Effect.provide(busLayer(directory.path)))))
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const bus = yield* Bus.Service
    const first: Event.Payload[] = []
    const second: Event.Payload[] = []
    const finished = yield* Deferred.make<void>()
    let markers = 0
    const watch = (ref: Location.Ref, seen: Event.Payload[]) =>
      bus.consume("location.consumer", [Message], (event) => Effect.sync(() => {
        seen.push(event)
        if (event.data.text === "both" && ++markers === 2) Deferred.doneUnsafe(finished, Effect.void)
      })).pipe(Effect.provideService(Location.Service, location(ref)))
    const runA = yield* watch(a, first)
    const runB = yield* watch(b, second)
    yield* runA.pipe(Effect.forkScoped({ startImmediately: true }))
    yield* runB.pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(finished).pipe(Effect.timeout("5 seconds"))
    expect(first).toEqual([published.local, published.global])
    expect(second).toEqual([published.global])
  }).pipe(Effect.provide(busLayer(directory.path)))))
}, 30_000)


test("a full database rejects a delivery and rolls back the producer transaction", async () => {
  await using directory = await tmpdir("redcode-delivery-full-")
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { db } = yield* Database.Service
    const journal = EventJournal.make(db, key)
    yield* journal.register("consumer", [Message])
    yield* db.run("CREATE TABLE delivery_probe (value text NOT NULL)")
    const pages = yield* db.get<{ page_count: number }>("PRAGMA page_count")
    if (!pages) throw new Error("Missing page count")
    yield* db.run(`PRAGMA max_page_count = ${pages.page_count}`)
    const result = yield* db.transaction(() => Effect.gen(function* () {
      yield* db.run("INSERT INTO delivery_probe VALUES ('committed')").pipe(Effect.orDie)
      yield* journal.enqueue(event("x".repeat(4 * 1024 * 1024)), Message)
    })).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    expect(yield* db.all("SELECT * FROM delivery_probe")).toEqual([])
    expect(yield* journal.next("consumer", [Message])).toBeUndefined()
  }).pipe(Effect.provide(database(directory.path)))))
})
