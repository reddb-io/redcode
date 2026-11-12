export * as CreatorComponents from "./component.js"

import { CreatorComponent } from "@opencode/schema/creator-component"
import { Design } from "@opencode/schema/design"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import path from "node:path"
import { Bus } from "../bus.js"
import { KV } from "../kv.js"
import { Location } from "../location.js"
import { DesignStore } from "../design/store.js"
import { DesignRenderer } from "../design/renderer.js"
import { SessionStore } from "../session/store.js"
import { DesignFiles } from "../design/files.js"
import { CreatorFrame } from "./frame.js"

export class Error extends Schema.TaggedError<Error>()("CreatorComponent.Error", {
  code: Schema.Literals(["not-found", "conflict", "invalid", "unavailable"]),
  message: Schema.String,
}) {}

const Stored = Schema.Struct({
  component: CreatorComponent.Info,
  blob: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
})

const make = Effect.gen(function* () {
  const kv = yield* KV.Service
  const location = yield* Location.Service
  const designs = yield* DesignStore.Service
  const sessions = yield* SessionStore.Service
  const renderer = yield* DesignRenderer.Service
  const bus = yield* Bus.Service
  const lock = yield* Semaphore.make(1)
  const prefix = `creator.components:${encodeURIComponent(JSON.stringify([location.directory, location.workspaceID ?? null]))}:`
  const key = (id: CreatorComponent.ID) => `${prefix}${id}`
  const decode = (value: unknown) =>
    Schema.decodeUnknownEffect(Stored)(value).pipe(
      Effect.mapError(() => new Error({ code: "invalid", message: "Stored Creator component metadata is invalid" })),
    )
  const list = Effect.fn("CreatorComponents.list")(function* () {
    const result: CreatorComponent.Info[] = []
    let after: string | undefined
    do {
      const page = yield* kv.scan({ prefix, after, limit: 1000 })
      result.push(
        ...(yield* Effect.forEach(page.entries, (entry) =>
          decode(entry.value).pipe(Effect.map((record) => record.component)),
        )),
      )
      after = page.next
    } while (after)
    return result.toSorted((a, b) => b.updated - a.updated || a.id.localeCompare(b.id))
  })
  const read = Effect.fn("CreatorComponents.read")(function* (id: CreatorComponent.ID) {
    const value = yield* kv.get(key(id))
    if (!value) return yield* new Error({ code: "not-found", message: "Creator component not found in this project" })
    return yield* decode(value)
  })
  const get = (id: CreatorComponent.ID) => read(id).pipe(Effect.map((record) => record.component))
  const checkOrigin = Effect.fn("CreatorComponents.checkOrigin")(function* (
    sessionID: CreatorComponent.Info["sessionID"],
  ) {
    const origin = yield* sessions.get(sessionID)
    if (
      !origin ||
      origin.location.directory !== location.directory ||
      origin.location.workspaceID !== location.workspaceID
    )
      return yield* new Error({
        code: "not-found",
        message: "Creator component source is not in this project location",
      })
  })
  // Once installed, the pinned project snapshot outlives its originating conversation.
  const prepare = Effect.fn("CreatorComponents.prepare")(function* (
    source: Pick<CreatorComponent.Info, "sessionID" | "designID" | "revision">,
  ) {
    const revision = yield* designs.revision(source.sessionID, source.designID, source.revision)
    const directory = yield* renderer.directory(revision)
    const { DesignPage } = yield* Effect.promise(() => import("../design/ui/page.js"))
    return yield* Effect.tryPromise({
      try: async () => {
        const html = CreatorFrame.html(await DesignPage.preview(revision, directory))
        const hash = DesignFiles.hash(html)
        const file = path.join(designs.blobs, hash)
        if (!(await Bun.file(file).exists())) await DesignFiles.atomic(file, html)
        return hash
      },
      catch: (cause) =>
        new Error({ code: "invalid", message: `Creator component cannot be packaged: ${String(cause)}` }),
    })
  })
  const publish = Effect.fn("CreatorComponents.publish")(function* (component: CreatorComponent.Info, blob: string) {
    const encoded = Schema.encodeSync(Stored)({ component, blob })
    yield* kv.set(key(component.id), encoded)
    yield* bus.publish(CreatorComponent.Event.Updated, { componentID: component.id }, { location })
    return component
  })
  const install = Effect.fn("CreatorComponents.install")(function* (input: CreatorComponent.Install) {
    const existing = (yield* list()).find(
      (item) => item.sessionID === input.sessionID && item.designID === input.designID,
    )
    if (existing) {
      if (existing.revision === input.revision) return existing
      return yield* new Error({
        code: "conflict",
        message: `This design is already installed as ${existing.id}; update it using its current version`,
      })
    }
    yield* checkOrigin(input.sessionID)
    const blob = yield* prepare(input)
    const now = Date.now()
    return yield* publish(
      {
        ...input,
        id: CreatorComponent.ID.create(),
        enabled: true,
        version: 1,
        created: now,
        updated: now,
      },
      blob,
    )
  }, lock.withPermits(1))
  const expected = (component: CreatorComponent.Info, version: number) =>
    component.version === version
      ? Effect.void
      : Effect.fail(
          new Error({
            code: "conflict",
            message: `Component changed (current version ${component.version}); reload before changing it`,
          }),
        )
  const update = Effect.fn("CreatorComponents.update")(function* (
    id: CreatorComponent.ID,
    input: CreatorComponent.Update,
  ) {
    const component = yield* get(id)
    yield* expected(component, input.expectedVersion)
    yield* checkOrigin(component.sessionID)
    const blob = yield* prepare({ ...component, revision: input.revision })
    return yield* publish(
      {
        ...component,
        revision: input.revision,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        version: component.version + 1,
        updated: Date.now(),
      },
      blob,
    )
  }, lock.withPermits(1))
  const control = Effect.fn("CreatorComponents.control")(function* (
    id: CreatorComponent.ID,
    input: CreatorComponent.Control,
  ) {
    const record = yield* read(id)
    const component = record.component
    yield* expected(component, input.expectedVersion)
    if (component.enabled === input.enabled) return component
    return yield* publish(
      { ...component, enabled: input.enabled, version: component.version + 1, updated: Date.now() },
      record.blob,
    )
  }, lock.withPermits(1))
  const remove = Effect.fn("CreatorComponents.remove")(function* (
    id: CreatorComponent.ID,
    input: CreatorComponent.Remove,
  ) {
    const component = yield* get(id)
    yield* expected(component, input.expectedVersion)
    yield* kv.remove(key(id))
    yield* bus.publish(CreatorComponent.Event.Updated, { componentID: id }, { location })
  }, lock.withPermits(1))
  const preview = Effect.fn("CreatorComponents.preview")(function* (id: CreatorComponent.ID) {
    const record = yield* read(id)
    const component = record.component
    if (!component.enabled) return yield* new Error({ code: "conflict", message: "This Creator component is disabled" })
    const html = new TextDecoder().decode(yield* designs.readBlob(record.blob))
    return { html, revision: component.revision, version: component.version }
  })
  const test = Effect.fn("CreatorComponents.test")(function* (input: CreatorComponent.Install) {
    yield* checkOrigin(input.sessionID)
    const blob = yield* prepare(input)
    const html = new TextDecoder().decode(yield* designs.readBlob(blob))
    return { html, revision: input.revision, version: 1 }
  })
  return { list, get, install, update, control, remove, preview, test }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/CreatorComponents") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [KV.node, Location.node, DesignStore.node, DesignRenderer.node, SessionStore.node, Bus.node],
})
