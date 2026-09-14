import { describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import { Effect } from "effect"
import { DesignBrowser } from "../../src/design/browser"

const url = "http://127.0.0.1:4096/design/session/ses_browser/review"

// Real processes, so exit and error observation is exercised without launching a browser.
type Outcome = number | "linger" | "missing" | "reject"
const child = (outcome: Outcome) => {
  if (outcome === "linger") return spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" })
  if (outcome === "missing") return spawn("/nonexistent/redcode-browser", [], { stdio: "ignore" })
  return spawn(process.execPath, ["-e", `process.exit(${outcome === "reject" ? 1 : outcome})`], { stdio: "ignore" })
}

function fixture(
  input: {
    found?: string[]
    bundles?: string[]
    wsl?: boolean
    grace?: number
    outcome?: (browser: string) => Outcome
  } = {},
) {
  const calls: string[] = []
  const args: (readonly string[])[] = []
  const children: ChildProcess[] = []
  const outcome = input.outcome ?? (() => 0)
  const track = (process: ChildProcess) => {
    children.push(process)
    return process
  }
  const options = (platform: NodeJS.Platform, env: Record<string, string | undefined> = {}) => ({
    platform,
    env,
    grace: input.grace ?? 300,
    home: "/Users/tester",
    wsl: () => input.wsl ?? false,
    exists: (file: string) => input.bundles?.includes(file) ?? false,
    which: (command: string) => ([...(input.found ?? []), "xdg-open"].includes(command) ? `/usr/bin/${command}` : null),
    spawn: (command: string, list: readonly string[]) => {
      calls.push(`spawn:${command}`)
      args.push(list)
      return track(child(outcome(command)))
    },
    load: async () => ({
      apps: { chrome: "chrome" },
      open: (target: string, options?: { app: { name: string } }) => {
        const browser = options?.app.name ?? "default"
        calls.push(`open:${browser}`)
        expect(target).toBe(url)
        if (outcome(browser) === "reject") return Promise.reject(new Error("launch failed"))
        return Promise.resolve(track(child(outcome(browser))))
      },
    }),
  })
  const cleanup = () => children.forEach((item) => item.kill())
  return { calls, args, options, cleanup }
}

const run = (options: DesignBrowser.Options) => Effect.runPromise(DesignBrowser.open(url, options))

describe("DesignBrowser.open", () => {
  test("REDCODE_DESIGN_BROWSER=default uses the system browser", async () => {
    const linux = fixture({ found: ["google-chrome"] })
    expect(await run(linux.options("linux", { REDCODE_DESIGN_BROWSER: "default" }))).toBe(true)
    expect(linux.calls).toEqual(["spawn:/usr/bin/xdg-open"])
    const mac = fixture({ bundles: ["/Applications/Google Chrome.app"] })
    await run(mac.options("darwin", { REDCODE_DESIGN_BROWSER: "default" }))
    expect(mac.calls).toEqual(["open:default"])
  })

  test("REDCODE_DESIGN_BROWSER is resolved on Linux and passed to open elsewhere", async () => {
    const named = fixture({ found: ["brave"] })
    await run(named.options("linux", { REDCODE_DESIGN_BROWSER: "brave" }))
    expect(named.calls).toEqual(["spawn:/usr/bin/brave"])
    const file = fixture({ bundles: ["/opt/brave/brave"] })
    await run(file.options("linux", { REDCODE_DESIGN_BROWSER: "/opt/brave/brave" }))
    expect(file.calls).toEqual(["spawn:/opt/brave/brave"])
    const mac = fixture()
    await run(mac.options("darwin", { REDCODE_DESIGN_BROWSER: "Brave Browser" }))
    expect(mac.calls).toEqual(["open:Brave Browser"])
  })

  test("an unresolvable REDCODE_DESIGN_BROWSER is skipped for the system browser", async () => {
    const browser = fixture({ found: ["google-chrome"] })
    expect(await run(browser.options("linux", { REDCODE_DESIGN_BROWSER: "chrome --incognito" }))).toBe(true)
    expect(browser.calls).toEqual(["spawn:/usr/bin/xdg-open"])
  })

  test("Linux spawns the first Chrome or Chromium path found on PATH with the URL", async () => {
    const browser = fixture({ found: ["chromium", "chromium-browser"] })
    await run(browser.options("linux"))
    expect(browser.calls).toEqual(["spawn:/usr/bin/chromium"])
    expect(browser.args).toEqual([[url]])
  })

  test("a browser that exits non-zero falls back to the next candidate, then the system browser", async () => {
    const browser = fixture({
      found: ["google-chrome", "chromium"],
      outcome: (name) => (name.endsWith("xdg-open") ? 0 : 1),
    })
    expect(await run(browser.options("linux"))).toBe(true)
    expect(browser.calls).toEqual([
      "spawn:/usr/bin/google-chrome",
      "spawn:/usr/bin/chromium",
      "spawn:/usr/bin/xdg-open",
    ])
  })

  test("a missing executable reports ENOENT to the launcher and falls back", async () => {
    const browser = fixture({
      found: ["google-chrome"],
      outcome: (name) => (name.endsWith("xdg-open") ? 0 : "missing"),
    })
    expect(await run(browser.options("linux"))).toBe(true)
    expect(browser.calls).toEqual(["spawn:/usr/bin/google-chrome", "spawn:/usr/bin/xdg-open"])
  })

  test("a browser still running after the grace window counts as opened", async () => {
    const browser = fixture({ found: ["google-chrome"], outcome: () => "linger" })
    expect(await run(browser.options("linux"))).toBe(true)
    expect(browser.calls).toEqual(["spawn:/usr/bin/google-chrome"])
    browser.cleanup()
  })

  test("WSL skips the Chrome search and opens the Windows default browser", async () => {
    const browser = fixture({ found: ["google-chrome"], wsl: true })
    await run(browser.options("linux"))
    expect(browser.calls).toEqual(["open:default"])
  })

  test("macOS opens Chrome only when its app bundle is installed", async () => {
    const installed = fixture({ bundles: ["/Users/tester/Applications/Google Chrome.app"] })
    await run(installed.options("darwin"))
    expect(installed.calls).toEqual(["open:google chrome"])
    const missing = fixture()
    await run(missing.options("darwin"))
    expect(missing.calls).toEqual(["open:default"])
  })

  test("macOS falls back when open rejects", async () => {
    const browser = fixture({
      bundles: ["/Applications/Google Chrome.app"],
      outcome: (name) => (name === "default" ? 0 : "reject"),
    })
    expect(await run(browser.options("darwin"))).toBe(true)
    expect(browser.calls).toEqual(["open:google chrome", "open:default"])
  })

  test("Windows falls back when Chrome exits non-zero", async () => {
    const browser = fixture({ outcome: (name) => (name === "default" ? 0 : 1) })
    await run(browser.options("win32"))
    expect(browser.calls).toEqual(["open:chrome", "open:default"])
  })

  test("Windows needs an exit code: still running after the window is not success", async () => {
    const browser = fixture({ outcome: (name) => (name === "default" ? 0 : "linger") })
    expect(await run(browser.options("win32"))).toBe(true)
    expect(browser.calls).toEqual(["open:chrome", "open:default"])
    browser.cleanup()
  })

  test("never throws when nothing opens or open cannot load", async () => {
    const failing = fixture({ found: ["google-chrome"], outcome: () => 2 })
    await expect(run(failing.options("linux"))).resolves.toBe(false)
    expect(failing.calls).toEqual(["spawn:/usr/bin/google-chrome", "spawn:/usr/bin/xdg-open"])
    await expect(
      run({
        platform: "linux",
        env: {},
        load: async () => {
          throw new Error("missing open")
        },
      }),
    ).resolves.toBe(false)
  })

  // Production shape: the real `open` module passed through unwrapped by DesignBrowser, in its own
  // process, because an uncaught ENOENT in bun:test is not reliably attributed to a test.
  test.skipIf(process.platform === "win32")(
    "a nonexistent browser does not crash the production launcher",
    async () => {
      const browser = JSON.stringify(path.resolve(import.meta.dir, "../../src/design/browser.ts"))
      const script = `
        import { spawn } from "node:child_process"
        import { Effect } from "effect"
        import { DesignBrowser } from ${browser}
        const url = ${JSON.stringify(url)}
        const scenario = async (env, which) => {
          const calls = []
          const result = await Effect.runPromise(
            DesignBrowser.open(url, {
              platform: "linux",
              env,
              wsl: () => false,
              grace: 500,
              which,
              spawn: (command, args, options) => {
                calls.push(command)
                if (command === "/usr/bin/xdg-open") return spawn(process.execPath, ["-e", "0"], { stdio: "ignore" })
                return spawn(command, args, options)
              },
            }),
          )
          return { result, calls }
        }
        const configured = await scenario({ REDCODE_DESIGN_BROWSER: "definitely-not-a-browser-xyz" }, (command) =>
          command === "xdg-open" ? "/usr/bin/xdg-open" : null,
        )
        const broken = await scenario({}, (command) =>
          command === "google-chrome" ? "/nonexistent/google-chrome" : command === "xdg-open" ? "/usr/bin/xdg-open" : null,
        )
        await new Promise((resolve) => setTimeout(resolve, 500))
        console.log(JSON.stringify({ configured, broken }))
      `
      const proc = Bun.spawn([process.execPath, "-e", script], {
        cwd: path.resolve(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      })
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      expect(stderr).not.toContain("Executable not found")
      expect(stderr).not.toContain("ENOENT")
      expect(code).toBe(0)
      expect(JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
        configured: { result: true, calls: ["/usr/bin/xdg-open"] },
        broken: { result: true, calls: ["/nonexistent/google-chrome", "/usr/bin/xdg-open"] },
      })
    },
    30_000,
  )
})
