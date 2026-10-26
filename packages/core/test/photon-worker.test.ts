import { expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import type { Worker } from "node:worker_threads"
import { Photon } from "@opencode/core/image/photon"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const it = testEffect(Layer.empty)
const pixel = {
  uri: "file:///pixel.png",
  content: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  encoding: "base64" as const,
  mime: "image/png",
}
const limits = { autoResize: true, maxWidth: 10, maxHeight: 10, maxBase64Bytes: 1024 }

test("the compiled runtime resolves and runs its embedded image worker", async () => {
  await using directory = await tmpdir("photon-compiled-")
  const binary = `${directory.path}/photon${process.platform === "win32" ? ".exe" : ""}`
  const build = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
        const result = await Bun.build({
          entrypoints: ["test/fixture/photon-compiled.ts", "photon-worker.js"],
          files: { "photon-worker.js": 'import "./src/image/photon-worker.ts"' },
          target: "bun",
          splitting: true,
          compile: { outfile: process.argv[1] },
        })
        if (!result.success) throw new AggregateError(result.logs, "Worker build failed")
      `,
      binary,
    ],
    { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" },
  )
  const [buildCode, buildError] = await Promise.all([build.exited, new Response(build.stderr).text()])
  expect(buildError).toBe("")
  expect(buildCode).toBe(0)
  const child = Bun.spawn([binary], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(stderr).toBe("")
  expect(code).toBe(0)
  expect(JSON.parse(stdout)).toEqual({ worker: true, unchanged: true })
}, 15_000)

it.live("reuses the image worker and releases its heap when idle", () =>
  Effect.gen(function* () {
    const workers: Worker[] = []
    yield* Effect.addFinalizer(() => Effect.promise(() => Promise.all(workers.map((worker) => worker.terminate()))))
    const normalize = Photon.makeWith(
      Photon.spawnWorker().pipe(Effect.tap((worker) => Effect.sync(() => workers.push(worker)))),
      50,
    )
    expect(yield* normalize("pixel", pixel, limits)).toEqual(pixel)
    expect(yield* normalize("pixel", pixel, limits)).toEqual(pixel)
    expect(workers).toHaveLength(1)
    yield* Effect.promise(() => new Promise<void>((resolve) => workers[0]!.once("exit", () => resolve())))
    expect(workers[0]!.threadId).toBe(-1)
    expect(yield* normalize("pixel", pixel, limits)).toEqual(pixel)
    expect(workers).toHaveLength(2)
  }),
)

for (const failure of ["crash", "hang"] as const) {
  it.live(`discards a worker after ${failure} and processes the next image with a fresh worker`, () =>
    Effect.gen(function* () {
      const workers: Worker[] = []
      yield* Effect.addFinalizer(() => Effect.promise(() => Promise.all(workers.map((worker) => worker.terminate()))))
      const spawn = Effect.suspend(() =>
        Photon.spawnWorker(
          workers.length === 0 ? new URL(`./fixture/photon-${failure}-worker.ts`, import.meta.url) : undefined,
        ).pipe(Effect.tap((worker) => Effect.sync(() => workers.push(worker)))),
      )
      const normalize = Photon.makeWith(spawn)
      const failed = yield* normalize("pixel", pixel, limits).pipe(Effect.timeout("1 second"), Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      expect(yield* normalize("pixel", pixel, limits)).toEqual(pixel)
      expect(workers).toHaveLength(2)
    }),
  )
}

it.live("keeps typed image errors and falls back when worker startup is unavailable", () =>
  Effect.gen(function* () {
    const normalize = Photon.makeWith(Effect.fail(new Photon.WorkerUnavailableError({ cause: "unavailable" })))
    expect(yield* normalize("pixel", pixel, limits)).toEqual(pixel)
    const size = yield* normalize("pixel", pixel, { ...limits, autoResize: false, maxBase64Bytes: 1 }).pipe(Effect.flip)
    expect(size._tag).toBe("Image.SizeError")
    const decode = yield* normalize("broken", { ...pixel, content: "broken" }, limits).pipe(Effect.flip)
    expect(decode._tag).toBe("Image.DecodeError")
  }),
)
