import { expect, test } from "bun:test"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { cp, mkdtemp, rm } from "node:fs/promises"
import { PNG } from "pngjs"

test("compiled image decoding and resizing use the embedded Photon WASM", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "redcode-photon-"))
  try {
    const dependency = path.join(directory, "photon")
    await cp(path.dirname(fileURLToPath(import.meta.resolve("@silvia-odwyer/photon-node"))), dependency, {
      recursive: true,
    })
    const png = new PNG({ width: 2, height: 1 })
    png.data.fill(255)
    await Bun.write(path.join(directory, "input.png"), PNG.sync.write(png))
    const source = path.join(directory, "probe.ts")
    await Bun.write(
      source,
      `import { make } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/image/photon.ts"))};
      import { Effect } from ${JSON.stringify(fileURLToPath(import.meta.resolve("effect")))};
      const content = Buffer.from(await Bun.file("input.png").bytes()).toString("base64");
      const resized = await Effect.runPromise(Effect.gen(function* () {
        const normalize = yield* make;
        return yield* normalize("input.png", {uri:"input.png",name:"input.png",content,encoding:"base64",mime:"image/png"}, {autoResize:true,maxWidth:1,maxHeight:1,maxBase64Bytes:1024});
      }));
      console.log(resized.content);`,
    )
    const executable = path.join(directory, process.platform === "win32" ? "probe.exe" : "probe")
    const compiled = await Bun.build({
      entrypoints: [source],
      target: "bun",
      minify: true,
      external: ["node-gyp"],
      plugins: [
        {
          name: "isolated-photon",
          setup(build) {
            build.onResolve({ filter: /^@silvia-odwyer\/photon-node(?:\/photon_rs_bg.wasm)?$/ }, (args) => ({
              path: path.join(dependency, args.path.endsWith(".wasm") ? "photon_rs_bg.wasm" : "photon_rs.js"),
            }))
          },
        },
      ],
      compile: { outfile: executable, autoloadPackageJson: false, autoloadBunfig: false, autoloadDotenv: false },
    })
    expect(compiled.success).toBe(true)
    // A source-tree WASM fallback must not mask a broken embedded asset path.
    await rm(dependency, { recursive: true, force: true })
    const child = Bun.spawn([executable], { cwd: directory, stdout: "pipe", stderr: "pipe" })
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000)
    try {
      const [code, output, error] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(code, error).toBe(0)
      const resized = PNG.sync.read(Buffer.from(output.trim(), "base64"))
      expect(resized.width).toBe(1)
      expect(resized.height).toBe(1)
    } finally {
      clearTimeout(timer)
      child.kill()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)
