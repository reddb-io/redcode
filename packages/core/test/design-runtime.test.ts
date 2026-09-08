import { expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import { DesignRuntime } from "../src/design/runtime"
import { designDependencies } from "./fixture/design-dependencies"

test("loads checkout Design tools from real package files without a managed install", async () => {
  const vite = await DesignRuntime.load("vite")
  const playwright = await DesignRuntime.load("playwright-core")
  expect(typeof vite.build).toBe("function")
  expect(typeof playwright.chromium.launchServer).toBe("function")
  expect(await DesignRuntime.resolve("vite")).toContain("node_modules")
  const controller = new AbortController()
  controller.abort(new Error("cancelled Design setup"))
  await expect(DesignRuntime.load("vite", controller.signal)).rejects.toThrow("cancelled Design setup")
})

test("a compiled CLI loads cached Vite, plugins and browser resources outside the bundle", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "redcode-design-runtime-"))
  try {
    const fingerprint = Bun.hash(JSON.stringify(DesignRuntime.versions)).toString(16)
    const cache = path.join(directory, "home/.red/code/cache/design-runtime", fingerprint)
    await mkdir(cache, { recursive: true })
    // The fixture seeds a genuine package tree and rejects network access. The
    // binary must resolve these files instead of its original checkout path.
    await designDependencies(cache, Object.keys(DesignRuntime.versions))
    await Bun.write(path.join(cache, "package.json"), JSON.stringify({ dependencies: DesignRuntime.versions }))
    await Bun.write(
      path.join(cache, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: DesignRuntime.versions } } }),
    )
    const source = path.join(directory, "probe.ts")
    await Bun.write(
      source,
      `import { DesignRuntime } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/design/runtime.ts"))};
      const { build } = await DesignRuntime.load("vite");
      const { default: react } = await DesignRuntime.load("@vitejs/plugin-react");
      const { default: solid } = await DesignRuntime.load("vite-plugin-solid");
      const { chromium } = await DesignRuntime.load("playwright-core");
      const { AxeBuilder } = await DesignRuntime.load("@axe-core/playwright");
      await build({root: process.cwd(), configFile: false, logLevel: "silent", plugins: [react()], build: {lib: {entry: "input.ts", formats: ["es"], fileName: () => "output.js"}, outDir: "output"}});
      const child = Bun.spawn([process.execPath, "-e", "console.log('child-js-ok')"], {env: {...process.env, BUN_BE_BUN: "1"}, stdout: "pipe"});
      if (await child.exited) throw new Error("compiled JavaScript subprocess failed");
      if (!(await new Response(child.stdout).text()).includes("child-js-ok")) throw new Error("compiled CLI recursively launched itself");
      console.log(JSON.stringify({build: (await Bun.file("output/output.js").text()).includes("42"), browser: chromium.executablePath().includes("chrom"), solid: typeof solid, axe: typeof AxeBuilder, resolved: await DesignRuntime.resolve("vite")})); process.exit(0);`,
    )
    await Bun.write(path.join(directory, "input.ts"), "export const answer: number = 42")
    const compiled = await Bun.build({
      entrypoints: [source],
      target: "bun",
      minify: true,
      external: ["node-gyp"],
      define: { REDCODE_DESIGN_RUNTIME: "true" },
      compile: { outfile: path.join(directory, "probe"), autoloadPackageJson: true },
    })
    expect(compiled.success).toBe(true)
    const child = Bun.spawn([path.join(directory, "probe")], {
      cwd: directory,
      env: {
        ...process.env,
        REDCODE_TEST_HOME: path.join(directory, "home"),
        NPM_CONFIG_REGISTRY: "http://127.0.0.1:1",
        NPM_CONFIG_FETCH_RETRIES: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000)
    const output = await new Response(child.stdout).text()
    const error = await new Response(child.stderr).text()
    clearTimeout(timer)
    expect(await child.exited, error).toBe(0)
    expect(JSON.parse(output)).toMatchObject({ build: true, browser: true, solid: "function", axe: "function" })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)
