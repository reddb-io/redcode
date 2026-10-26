import { Photon } from "@opencode/core/image/photon"
import { Effect } from "effect"

const content = {
  uri: "file:///pixel.png",
  content: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  encoding: "base64" as const,
  mime: "image/png",
}
const result = await Effect.runPromise(
  Effect.gen(function* () {
    let started = 0
    const normalize = Photon.makeWith(Photon.spawnWorker().pipe(Effect.tap(() => Effect.sync(() => started++))))
    const normalized = yield* normalize("pixel", content, {
      autoResize: true,
      maxWidth: 10,
      maxHeight: 10,
      maxBase64Bytes: 1024,
    })
    if (started !== 1 || normalized.content !== content.content) throw new Error("Compiled image worker failed")
    return { worker: true, unchanged: true }
  }),
)
console.log(JSON.stringify(result))
