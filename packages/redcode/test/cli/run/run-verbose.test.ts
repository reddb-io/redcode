// `redcode run --verbose` has no screen, so the whole trace goes to stderr in order: the boot
// phases first, the summary once the session exists, then the activity of the turn itself.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { reply } from "../../lib/llm-server"
import { cliIt } from "../../lib/cli-process"

describe("redcode run --verbose", () => {
  cliIt.withIntelligence(
    "prints the boot trace, then the activity trace, and never a credential",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("before").tool("bash", { command: "printf traced", description: "Print deterministic output" }),
        )
        yield* llm.text("after")

        // A titled session makes no title request, so every provider call is the turn's.
        const result = yield* opencode.run("trace me", {
          extraArgs: ["--verbose", "--dangerously-skip-permissions", "--title", "Traced run"],
        })
        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("before\nafter\n")

        const lines = result.stderr.split(/\r?\n/)
        const boot = lines.filter((line) => /^boot\s+\d+ms\s+\+\d+ms\s/.test(line))
        const phases = boot.map((line) => line.replace(/^boot\s+\d+ms\s+\+\d+ms\s+/, "").split(" ")[0])
        // Every phase between the process and the prompt, in the order they happen.
        for (const phase of [
          "process.start",
          "cli.parsed",
          "runtime.ready",
          "instance.boot",
          "config.loaded",
          "plugins.loaded",
          "plugins.ready",
          "lsp.ready",
          "instance.services",
          "instance.ready",
          "models.catalog",
          "providers.ready",
          "session.ready",
        ]) {
          expect(phases).toContain(phase)
        }
        expect(phases.indexOf("cli.parsed")).toBeGreaterThan(phases.indexOf("process.start"))
        expect(phases.indexOf("instance.ready")).toBeGreaterThan(phases.indexOf("config.loaded"))
        expect(phases.indexOf("session.ready")).toBeGreaterThan(phases.indexOf("instance.ready"))
        expect(boot.find((line) => line.includes(" cli.parsed "))).toContain("command=run")
        expect(boot.find((line) => line.includes(" providers.ready "))).toMatch(/ ids=(\S+,)?test(,|\s|$)/)
        if (process.env.REDCODE_TEST_DUMP_BOOT) console.error(boot.join("\n"))

        const summary = lines.findIndex((line) => /^boot complete in \d+ ms; log at .*boot-.*\.log$/.test(line))
        expect(summary).toBeGreaterThan(0)

        // The activity trace follows the summary and describes the turn without quoting it.
        const activity = lines.filter((line) => line.startsWith("verbose "))
        const events = activity.map((line) => line.replace(/^verbose\s+\d+ms\s+/, "").split(" ")[0])
        expect(lines.findIndex((line) => line.startsWith("verbose ")) > summary).toBe(true)
        expect(events.filter((event) => event === "provider.request").length).toBeGreaterThanOrEqual(2)
        expect(events.filter((event) => event === "provider.response").length).toBeGreaterThanOrEqual(2)
        expect(events).toContain("tool.start")
        expect(events).toContain("tool.end")
        // The turn's own request carries the preflight estimate it was sized by; the title
        // request is not sized by the loop and carries none.
        const request = activity.find((line) => line.includes(" provider.request ") && line.includes("agent=build"))!
        expect(request).toContain("providerID=test")
        expect(request).toContain("modelID=test-model")
        expect(request).toMatch(/estimatedTokens=\d+/)
        const end = activity.find((line) => line.includes(" tool.end "))!
        expect(end).toContain("tool=bash")
        expect(end).toContain("ok=true")
        expect(end).toMatch(/ ms=\d+/)
        expect(end).toMatch(/bytes=\d+/)

        // Nothing the model or the tool said, and no key, reaches the trace. (The run's own tool
        // display on stderr shows the command; the trace lines never do.)
        const traced = [...boot, ...activity].join("\n")
        expect(result.stderr).not.toContain("test-key")
        expect(traced).not.toContain("printf traced")
        expect(traced).not.toContain("trace me")
      }),
    60_000,
  )

  cliIt.withIntelligence(
    "a permission ask names the program, never the command a credential may be in",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const command = 'curl -H "Authorization: Bearer x" https://user:pw@example.com/secret?token=abc'
        yield* llm.tool("bash", { command, description: "Call an API" })
        yield* llm.text("done")
        // No --dangerously-skip-permissions: the run asks, and auto-rejects. `--dir home` keeps
        // the tool out of the runner's own checkout, where the worktree guard would refuse it
        // before anything was asked.
        const result = yield* opencode.run("call the api", {
          permission: { bash: "ask" },
          extraArgs: ["--verbose", "--title", "Permission trace", "--dir", home],
        })
        opencode.expectExit(result, 0)

        const lines = result.stderr.split(/\r?\n/)
        const traced = lines.filter((line) => /^(boot\s+\d+ms|verbose\s+\d+ms)/.test(line)).join("\n")
        // The run's own report that it asked and auto-rejected, then the trace's record of it.
        expect(result.stderr).toContain("permission requested: bash")
        const ask = lines.find((line) => line.includes(" permission.ask "))
        if (!ask) throw new Error("no permission.ask line in the trace; stderr was:\n" + result.stderr)
        expect(ask).toContain("permission=bash")
        expect(ask).toContain("patterns=1")
        expect(ask).toContain("program=curl")
        expect(lines.find((line) => line.includes(" permission.reply "))).toContain("reply=reject")
        for (const secret of ["Authorization", "Bearer", "user:pw", "token=abc", "example.com"])
          expect(traced).not.toContain(secret)
      }),
    60_000,
  )

  cliIt.withIntelligence(
    "the trace's environment never reaches a process the bash tool spawns",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const vars = [
          "REDCODE_VERBOSE",
          "REDCODE_BOOT_START",
          "REDCODE_VERBOSE_BOOT_FILE",
          "REDCODE_VERBOSE_NO_STDERR",
          "REDCODE_LOG_LEVEL",
        ]
        yield* llm.tool("bash", {
          command: `printf 'ENV[%s]' "${vars.map((name) => "$" + name).join("|")}"`,
          description: "Print the trace variables",
        })
        yield* llm.text("done")
        const result = yield* opencode.run("show env", {
          extraArgs: ["--verbose", "--dangerously-skip-permissions", "--title", "Environment trace", "--dir", home],
          env: { REDCODE_VERBOSE: "1" },
        })
        opencode.expectExit(result, 0)
        expect(result.stderr).toMatch(/^verbose\s+\d+ms tool\.end .*tool=bash/m)
        // The tool's output goes back to the model: that is where the child's view of it is.
        expect(JSON.stringify(yield* llm.inputs)).toContain("ENV[||||]")
      }),
    60_000,
  )

  cliIt.withIntelligence(
    "REDCODE_VERBOSE=1 enables the same trace as the flag, and a stricter log level does not hide it",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("ok")
        const result = yield* opencode.run("say ok", {
          env: { REDCODE_VERBOSE: "1" },
          extraArgs: ["--log-level", "ERROR"],
        })
        opencode.expectExit(result, 0)
        expect(result.stderr).toMatch(/^boot\s+\d+ms\s+\+\d+ms process\.start/m)
        expect(result.stderr).toMatch(/^boot complete in \d+ ms; log at /m)
        expect(result.stderr).toMatch(/^verbose\s+\d+ms provider\.request /m)
      }),
    60_000,
  )
})
