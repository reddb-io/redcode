import { Worker } from "@opencode/schema/worker"
import { expect, test } from "bun:test"
import { WorkerPool } from "../src/workers/pool"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { isolatedEnv } from "./fixture/environment"
import { ConsoleForbiddenError } from "@opencode/protocol/console"

async function fixture(mode: "complete" | "waiting" | "lost" | "running" | "admission-lost" | "create-lost" = "complete") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "redcode-workers-"))
  const sessions = new Map<string, { id: string; location: { directory: string }; outcome?: "succeeded" }>()
  const admitted = new Set<string>()
  const diffs = [{ file: "../../escaped.txt", patch: "diff --git a/result.txt b/result.txt\n+worker result\n", additions: 1, deletions: 0, status: "added" as const }]
  const counts = { creates: 0, prompts: 0, wakes: 0, active: 0, peak: 0, rejected: 0, started: [] as number[], finished: [] as number[] }
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.headers.get("authorization") !== `Basic ${btoa("opencode:test-secret")}`) {
      counts.rejected++
      return Response.json({}, { status: 401 })
    }
    const route = new URL(request.url).pathname
    if (route === "/api/info") return Response.json({ version: "test", pid: 1, urls: [], paths: { tmp: directory } })
    if (route === "/api/session/active") return Response.json({ data: Object.fromEntries([...sessions].filter(([, session]) => !session.outcome).map(([id]) => [id, { type: "running" }])) })
    if (route === "/api/session" && request.method === "POST") {
      const input = await request.json() as { id: string; location: { directory: string } }
      counts.creates++
      if (mode === "create-lost" && counts.creates === 1) return Response.json({}, { status: 503 })
      if (!sessions.has(input.id)) sessions.set(input.id, input)
      return Response.json({ data: sessions.get(input.id) })
    }
    const match = /^\/api\/session\/([^/]+)(?:\/(.*))?$/.exec(route)
    const session = match ? sessions.get(match[1]!) : undefined
    if (!session) return Response.json({ _tag: "SessionNotFoundError", sessionID: match?.[1], message: "Session not found" }, { status: 404 })
    if (match?.[2] === "prompt") {
      const input = await request.json() as { id: string; resume?: boolean }
      counts.prompts++
      if (admitted.has(input.id)) return Response.json({ data: { id: input.id, type: "user" } })
      admitted.add(input.id)
      counts.started.push(Date.now())
      counts.active++
      counts.peak = Math.max(counts.peak, counts.active)
      if (mode === "admission-lost" && counts.prompts === 1) return Response.json({}, { status: 503 })
      if (mode === "complete" || mode === "create-lost" || mode === "admission-lost") setTimeout(() => { session.outcome = "succeeded"; counts.active--; counts.finished.push(Date.now()) }, 40)
      return Response.json({ data: { id: "msg_test", type: "user" } })
    }
    if (match?.[2] === "wake") {
      counts.wakes++
      if (!session.outcome) setTimeout(() => { session.outcome = "succeeded"; counts.active--; counts.finished.push(Date.now()) }, 40)
      return new Response(null, { status: 204 })
    }
    if (match?.[2] === "diff") {
      expect(new URL(request.url).searchParams.get("from")).toBeTruthy()
      return Response.json({ data: diffs })
    }
    if (match?.[2] === "message") return Response.json({ data: [{ type: "assistant", content: [{ type: "text", text: "remote result" }] }], cursor: {} })
    if (match?.[2] === "permission") return Response.json({ data: mode === "waiting" ? [{ id: "permission_test" }] : [] })
    if (match?.[2] === "form") return Response.json({ data: [] })
    if (mode === "lost" && counts.prompts) return Response.json({}, { status: 503 })
    return Response.json({ data: session })
  } })
  const config = path.join(directory, "workers.json")
  const manifest = path.join(directory, "tasks.json")
  const report = path.join(directory, "report.json")
  const worker: Worker.Registration = { id: "pi-a", url: server.url.origin, passwordEnv: "PI_PASSWORD", directories: ["/checkout/a"], tags: ["linux", "arm64"] }
  await WorkerPool.add(config, worker)
  await Bun.write(manifest, JSON.stringify({ tasks: [{ id: "one", prompt: "test", tags: ["arm64"] }, { id: "two", prompt: "test" }, { id: "three", prompt: "test" }] }))
  return { directory, server, sessions, counts, admitted, diffs, config, manifest, report, worker,
    run: (options: Partial<Parameters<typeof WorkerPool.run>[0]> = {}) => WorkerPool.run({ config, manifest, report, environment: { PI_PASSWORD: "test-secret" }, pollMs: 5, timeoutMs: 200, ...options }),
    async [Symbol.asyncDispose]() { server.stop(true); await rm(directory, { recursive: true, force: true }) },
  }
}

test("serializes tasks per checkout and collects remote output without storing credentials", async () => {
  await using host = await fixture()
  const report = await host.run()
  expect(report.tasks.map((entry) => entry.state)).toEqual(["succeeded", "succeeded", "succeeded"])
  expect(host.counts.peak).toBe(1)
  expect(host.counts.prompts).toBe(3)
  expect(report.tasks[0]?.text).toBe("remote result")
  expect(await Bun.file(host.config).text()).not.toContain("test-secret")
  expect(await Bun.file(host.report).text()).not.toContain("test-secret")
  await host.run()
  expect(host.counts.prompts).toBe(3)
})

test("asynchronous grant checks preserve unique admissions across parallel checkout slots", async () => {
  await using host = await fixture()
  await WorkerPool.remove(host.config, host.worker.id)
  await WorkerPool.add(host.config, { ...host.worker, directories: ["/checkout/a", "/checkout/b", "/checkout/c"] })
  const result = await host.run({
    authorize: async () => {
      await Bun.sleep(10)
    },
  })
  expect(result.tasks.every((entry) => entry.state === "succeeded")).toBe(true)
  expect(host.sessions.size).toBe(3)
  expect(host.counts.prompts).toBe(3)
  expect(host.admitted.size).toBe(3)
  expect(new Set(result.tasks.map((entry) => entry.sessionID)).size).toBe(3)
})

test("failed admission authorization does not create remote Sessions or deliver prompts", async () => {
  await using host = await fixture()
  const result = await host.run({
    authorize: async () => {
      throw new Error("Grant revoked")
    },
  })
  expect(result.tasks.map((entry) => entry.state)).toEqual(["failed", "failed", "failed"])
  expect(host.sessions.size).toBe(0)
  expect(host.counts.creates).toBe(0)
  expect(host.counts.prompts).toBe(0)
})

test("revocation after Session creation is rechecked before prompt admission", async () => {
  await using host = await fixture()
  const checks = { count: 0 }
  const result = await host.run({
    authorize: async () => {
      if (++checks.count > 1) throw new ConsoleForbiddenError({ message: "Grant revoked" })
    },
  })
  expect(result.tasks.every((entry) => entry.state === "failed")).toBe(true)
  expect(host.counts.creates).toBe(1)
  expect(host.counts.prompts).toBe(0)
})

test("explicit recovery resumes lost admission using the original worker and IDs", async () => {
  await using host = await fixture("admission-lost")
  const initial = await host.run()
  expect(initial.tasks[0]?.state).toBe("unknown")
  const recovered = await host.run({ recoverTask: "one" })
  expect(recovered.tasks.map((entry) => entry.state)).toEqual(["succeeded", "succeeded", "succeeded"])
  expect(recovered.tasks[0]?.sessionID).toBe(initial.tasks[0]?.sessionID)
  expect(recovered.tasks[0]?.messageID).toBe(initial.tasks[0]?.messageID)
  expect(host.counts.creates).toBe(3)
  expect(host.counts.wakes).toBe(1)
  expect(host.admitted.size).toBe(3)
  await expect(host.run({ recoverTask: "one" })).rejects.toThrow("unknown or dispatching")
})

test("explicit recovery recreates an unacknowledged missing Session with the journaled ID", async () => {
  await using host = await fixture("create-lost")
  const initial = await host.run()
  expect(initial.tasks[0]?.state).toBe("unknown")
  expect(host.counts.prompts).toBe(0)
  const recovered = await host.run({ recoverTask: "one" })
  expect(recovered.tasks[0]?.sessionID).toBe(initial.tasks[0]?.sessionID)
  expect(recovered.tasks.every((entry) => entry.state === "succeeded")).toBe(true)
  expect(host.admitted.size).toBe(3)
})

test("unreachable recovery retains its placement and does not dispatch the next task", async () => {
  await using host = await fixture("lost")
  const initial = await host.run()
  const recovered = await host.run({ recoverTask: "one" })
  expect(recovered.tasks.map((entry) => entry.state)).toEqual(["unknown", "queued", "queued"])
  expect(recovered.tasks[0]?.sessionID).toBe(initial.tasks[0]?.sessionID)
  expect(host.counts.prompts).toBe(1)
  expect(host.counts.wakes).toBe(0)
})

test("collect exports recorded task patches without interpreting remote filenames or overwriting outputs", async () => {
  await using host = await fixture()
  await host.run()
  const output = path.join(host.directory, "results", "one")
  const input = { config: host.config, manifest: host.manifest, report: host.report, task: "one", output, environment: { PI_PASSWORD: "test-secret" } }
  const artifact = await WorkerPool.collect(input)
  expect(artifact.files).toEqual(host.diffs)
  expect(await Bun.file(path.join(output, "changes.patch")).text()).toBe(host.diffs[0]!.patch)
  expect(await Bun.file(path.join(output, "response.txt")).text()).toBe("remote result")
  expect(await Bun.file(path.join(output, "result.json")).text()).not.toContain("test-secret")
  expect(await Bun.file(path.join(host.directory, "escaped.txt")).exists()).toBe(false)
  await expect(WorkerPool.collect(input)).rejects.toThrow()
})

test("collect refuses unfinished tasks and a Session restarted after completion", async () => {
  await using host = await fixture("waiting")
  const report = await host.run()
  const input = { config: host.config, manifest: host.manifest, report: host.report, task: "one", output: path.join(host.directory, "result"), environment: { PI_PASSWORD: "test-secret" } }
  await expect(WorkerPool.collect(input)).rejects.toThrow("terminal task")
  await Bun.write(host.report, JSON.stringify({ ...report, tasks: report.tasks.map((entry) => entry.id === "one" ? { ...entry, state: "succeeded" } : entry) }))
  await expect(WorkerPool.collect(input)).rejects.toThrow("must be idle")
  expect(await Bun.file(input.output).exists()).toBe(false)
})

test("different workers execute concurrently and tags determine placement", async () => {
  await using first = await fixture()
  await using second = await fixture()
  await WorkerPool.add(first.config, { ...second.worker, id: "pi-b", tags: ["linux", "x64"] })
  const report = await first.run()
  expect(report.tasks[0]?.worker).toBe("pi-a")
  expect(new Set(report.tasks.map((entry) => entry.worker))).toEqual(new Set(["pi-a", "pi-b"]))
  expect(first.counts.peak).toBe(1)
  expect(second.counts.peak).toBe(1)
  expect(first.counts.prompts + second.counts.prompts).toBe(3)
  expect(first.counts.started[0]!).toBeLessThan(second.counts.finished[0]!)
  expect(second.counts.started[0]!).toBeLessThan(first.counts.finished[0]!)
})

test("pending permissions keep the checkout reserved and require human input", async () => {
  await using host = await fixture("waiting")
  expect((await host.run()).tasks.map((entry) => entry.state)).toEqual(["waiting", "queued", "queued"])
  expect(host.counts.prompts).toBe(1)
  await host.run()
  expect(host.counts.prompts).toBe(1)
  await expect(host.run({ report: path.join(host.directory, "another-report.json") })).rejects.toThrow("unfinished batch")
})

test("lost observation never replays a prompt or releases its checkout", async () => {
  await using host = await fixture("lost")
  expect((await host.run()).tasks.map((entry) => entry.state)).toEqual(["unknown", "queued", "queued"])
  await host.run()
  expect(host.counts.creates).toBe(1)
  expect(host.counts.prompts).toBe(1)
})

test("unfinished worker execution survives the local observation deadline", async () => {
  await using host = await fixture("waiting")
  // No automatic approval; a pending request can be answered through the ordinary worker client.
  const report = await host.run()
  host.sessions.get(report.tasks[0]!.sessionID!)!.outcome = "succeeded"
  const resumed = await host.run()
  expect(resumed.tasks[0]?.state).toBe("succeeded")
  expect(resumed.tasks[1]?.state).toBe("waiting")
  expect(host.counts.prompts).toBe(2)
})

test("validates credentials, eligibility, journal identity and duplicate slots before dispatch", async () => {
  await using host = await fixture()
  await expect(host.run({ environment: {} })).rejects.toThrow("PI_PASSWORD")
  expect(host.counts.creates).toBe(0)
  await expect(WorkerPool.add(host.config, { ...host.worker, id: "duplicate" })).rejects.toThrow("already registered")
  expect(() => WorkerPool.address("http://user:secret@localhost:1")).toThrow()
  await Bun.write(host.manifest, JSON.stringify({ tasks: [{ id: "unmatched", prompt: "test", tags: ["windows"] }] }))
  await expect(host.run()).rejects.toThrow("No eligible worker")
  await Bun.write(host.manifest, JSON.stringify({ tasks: [{ id: "one", prompt: "test" }] }))
  await host.run()
  await Bun.write(host.manifest, JSON.stringify({ tasks: [{ id: "one", prompt: "changed" }] }))
  await expect(host.run()).rejects.toThrow("different batch")
})

test("observation timeout retains running work and a missing journal cannot reassign it", async () => {
  await using host = await fixture("running")
  expect((await host.run({ timeoutMs: 15 })).tasks.map((entry) => entry.state)).toEqual(["running", "queued", "queued"])
  await expect(WorkerPool.remove(host.config, "pi-a")).rejects.toThrow("unfinished batch")
  await rm(host.report)
  await expect(host.run()).rejects.toThrow("journal is missing")
  expect(host.counts.prompts).toBe(1)
})

test("offline workers leave unassigned tasks queued instead of claiming execution", async () => {
  await using host = await fixture()
  const result = await host.run({ environment: { PI_PASSWORD: "wrong-password" } })
  expect(result.tasks.every((entry) => entry.state === "queued" && !entry.sessionID)).toBe(true)
  expect(host.counts.creates).toBe(0)
  expect(host.counts.rejected).toBe(1)
})

test("worker CLI registers, dispatches, recovers, collects and removes through real commands", async () => {
  await using host = await fixture()
  const config = path.join(host.directory, "cli-workers.json")
  const manifest = path.join(host.directory, "cli-tasks.json")
  const report = path.join(host.directory, "cli-report.json")
  await Bun.write(manifest, JSON.stringify({ tasks: [{ id: "cli-task", prompt: "Run remote work" }] }))
  const command = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, "run", "src/index.ts", "workers", ...args], {
      cwd: path.resolve(import.meta.dir, ".."), env: isolatedEnv(host.directory, { PI_PASSWORD: "test-secret" }), stdout: "pipe", stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect({ code, stderr: code ? stderr : "" }).toEqual({ code: 0, stderr: "" })
    return stdout
  }
  await command(["add", "cli-pi", "--config", config, "--url", host.server.url.origin, "--directory", "/checkout/cli", "--password-env", "PI_PASSWORD", "--tag", "arm64"])
  const result = WorkerPool.Report.make(JSON.parse(await command(["run", manifest, "--config", config, "--report", report, "--timeout", "5"])))
  expect(result.tasks[0]?.state).toBe("succeeded")
  expect(host.counts.prompts).toBe(1)
  await Bun.write(report, JSON.stringify({ ...result, tasks: result.tasks.map((entry) => ({ ...entry, state: "unknown" })) }))
  const recovered = WorkerPool.Report.make(JSON.parse(await command(["recover", "cli-task", "--config", config, "--manifest", manifest, "--report", report, "--timeout", "5"])))
  expect(recovered.tasks[0]?.state).toBe("succeeded")
  expect(host.counts.prompts).toBe(1)
  const output = path.join(host.directory, "cli-result")
  await command(["collect", "cli-task", "--config", config, "--manifest", manifest, "--report", report, "--output", output])
  expect(await Bun.file(path.join(output, "changes.patch")).text()).toBe(host.diffs[0]!.patch)
  await command(["remove", "cli-pi", "--config", config])
  expect((await WorkerPool.readConfig(config)).workers).toEqual([])
}, 45_000)
