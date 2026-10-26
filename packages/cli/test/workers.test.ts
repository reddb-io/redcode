import { OpenCode } from "@opencode/client/promise"
import { createHash } from "node:crypto"
import { Worker } from "@opencode/schema/worker"
import { expect, test } from "bun:test"
import { WorkerPool } from "../src/workers/pool"
import { mkdtemp, rm, stat } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { isolatedEnv } from "./fixture/environment"
import { ConsoleForbiddenError } from "@opencode/protocol/console"
import { HostResources } from "@opencode/schema/host-resources"
import type { WorkerLease } from "@opencode/schema/worker-lease"

async function fixture(
  mode:
    | "complete"
    | "waiting"
    | "lost"
    | "running"
    | "admission-lost"
    | "create-lost"
    | "admission-missing"
    | "idle-admission" = "complete",
  measurement?: () => HostResources.Snapshot | undefined,
  modern = true,
  fenced = true,
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "redcode-workers-"))
  const sessions = new Map<
    string,
    { id: string; location: { directory: string }; outcome?: "succeeded"; pending?: string; started?: boolean }
  >()
  const admitted = new Set<string>()
  const receipts = new Map<string, string>()
  const leases = new Map<string, WorkerLease.Info>()
  const released = new Set<string>()
  const leaseState = { denyRenewal: false, acquisitions: 0, renewals: 0, releases: 0 }
  const diffs = [
    {
      file: "../../escaped.txt",
      patch: "diff --git a/result.txt b/result.txt\n+worker result\n",
      additions: 1,
      deletions: 0,
      status: "added" as const,
    },
  ]
  const counts = {
    creates: 0,
    prompts: 0,
    wakes: 0,
    active: 0,
    peak: 0,
    rejected: 0,
    started: [] as number[],
    finished: [] as number[],
    observations: 0,
    sessionReads: 0,
    permissionReads: 0,
    formReads: 0,
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.headers.get("authorization") !== `Basic ${btoa("opencode:test-secret")}`) {
        counts.rejected++
        return Response.json({}, { status: 401 })
      }
      const route = new URL(request.url).pathname
      if (route === "/api/info")
        return Response.json({
          version: "test",
          pid: 1,
          urls: [],
          paths: { tmp: directory },
          capabilities: { sessionObservation: modern, workerLease: fenced },
        })
      if (route === "/api/worker-lease/acquire") {
        leaseState.acquisitions++
        const input = (await request.json()) as WorkerLease.Acquire
        const old = leases.get(input.directory)
        if (old && !released.has(old.sessionID) && (old.owner !== input.owner || old.sessionID !== input.sessionID))
          return Response.json({ state: "busy" })
        if (old && old.owner === input.owner && old.sessionID === input.sessionID && released.has(old.sessionID))
          return Response.json({ state: "released", lease: old })
        if (old && old.owner === input.owner && old.sessionID === input.sessionID) {
          if (input.recover && (old.generation !== input.recover.generation || old.holder !== input.recover.holder))
            return Response.json({ _tag: "ConflictError", message: "Stale fence" }, { status: 409 })
          if (!input.recover || old.expiresAt > Date.now()) {
            if (input.recover && old.holder !== input.holder) return Response.json({ state: "busy" })
            return Response.json({
              state: old.holder === input.holder ? "acquired" : "held",
              lease: { ...old, remainingMs: Math.max(0, old.expiresAt - Date.now()) },
            })
          }
        }
        const lease = {
          directory: input.directory,
          owner: input.owner,
          holder: input.holder,
          sessionID: input.sessionID,
          messageID: input.messageID,
          generation: (old?.generation ?? 0) + 1,
          expiresAt: Date.now() + 60_000,
          remainingMs: 60_000,
        }
        leases.set(input.directory, lease)
        return Response.json({ state: "acquired", lease })
      }
      if (route === "/api/worker-lease/renew" || route === "/api/worker-lease/release") {
        const input = (await request.json()) as WorkerLease.Info
        const old = leases.get(input.directory)
        if (
          !old ||
          old.owner !== input.owner ||
          old.holder !== input.holder ||
          old.generation !== input.generation ||
          leaseState.denyRenewal
        )
          return Response.json({ _tag: "ConflictError", message: "Worker lease lost" }, { status: 409 })
        if (route.endsWith("/renew")) {
          leaseState.renewals++
          const lease = { ...old, expiresAt: Date.now() + 60_000, remainingMs: 60_000 }
          leases.set(input.directory, lease)
          return Response.json(lease)
        }
        leaseState.releases++
        released.add(old.sessionID)
        return new Response(null, { status: 204 })
      }
      if (route.startsWith("/api/session") && request.method !== "GET") {
        const fence = request.headers.get("x-redcode-worker-fence")
        if (!fence) return Response.json({ _tag: "ConflictError", message: "Missing worker fence" }, { status: 409 })
      }
      if (route === "/api/resources") {
        const sample = measurement?.()
        return sample ? Response.json(sample) : Response.json({}, { status: 404 })
      }
      if (route === "/api/session/active")
        return Response.json({
          data: Object.fromEntries(
            [...sessions]
              .filter(([, session]) => session.started && !session.outcome)
              .map(([id]) => [id, { type: "running" }]),
          ),
        })
      if (route === "/api/session" && request.method === "POST") {
        const input = (await request.json()) as { id: string; location: { directory: string } }
        counts.creates++
        if (mode === "create-lost" && counts.creates === 1) return Response.json({}, { status: 503 })
        if (!sessions.has(input.id)) sessions.set(input.id, input)
        return Response.json({ data: sessions.get(input.id) })
      }
      const match = /^\/api\/session\/([^/]+)(?:\/(.*))?$/.exec(route)
      const session = match ? sessions.get(match[1]!) : undefined
      if (!session)
        return Response.json(
          { _tag: "SessionNotFoundError", sessionID: match?.[1], message: "Session not found" },
          { status: 404 },
        )
      if (match?.[2] === "prompt") {
        const input = (await request.json()) as { id: string; resume?: boolean }
        counts.prompts++
        if (mode === "admission-missing" && counts.prompts === 1) return Response.json({}, { status: 503 })
        if (admitted.has(input.id)) return Response.json({ data: { id: input.id, type: "user" } })
        admitted.add(input.id)
        receipts.set(input.id, session.id)
        if (input.resume === false || (mode === "idle-admission" && counts.prompts === 1)) {
          session.pending = input.id
          return Response.json({ data: { id: input.id, type: "user" } })
        }
        session.started = true
        counts.started.push(Date.now())
        counts.active++
        counts.peak = Math.max(counts.peak, counts.active)
        if (mode === "admission-lost" && counts.prompts === 1) return Response.json({}, { status: 503 })
        if (["complete", "create-lost", "admission-lost", "admission-missing", "idle-admission"].includes(mode))
          setTimeout(() => {
            session.outcome = "succeeded"
            counts.active--
            counts.finished.push(Date.now())
          }, 40)
        return Response.json({ data: { id: "msg_test", type: "user" } })
      }
      if (match?.[2] === "wake") {
        counts.wakes++
        if (session.pending) session.outcome = undefined
        if (!session.outcome) {
          session.pending = undefined
          if (!session.started) {
            session.started = true
            counts.active++
            counts.started.push(Date.now())
          }
          setTimeout(() => {
            session.outcome = "succeeded"
            counts.active--
            counts.finished.push(Date.now())
          }, 40)
        }
        return new Response(null, { status: 204 })
      }
      if (mode === "lost" && counts.prompts) return Response.json({}, { status: 503 })
      if (match?.[2] === "observation") {
        counts.observations++
        const messageID = new URL(request.url).searchParams.get("messageID")!
        return Response.json({
          data: {
            sessionID: session.id,
            messageID,
            directory: session.location.directory,
            admission:
              receipts.get(messageID) !== session.id
                ? "missing"
                : session.pending === messageID
                  ? "pending"
                  : "delivered",
            pending: !!session.pending,
            execution: session.started && !session.outcome ? "running" : "idle",
            outcome: session.outcome,
            waiting: mode === "waiting" && !session.outcome,
          },
        })
      }
      if (match?.[2] === "inbox")
        return Response.json({ data: session.pending ? [{ id: session.pending, type: "user" }] : [] })
      if (match?.[2]?.startsWith("message/")) {
        const id = match[2].slice("message/".length)
        return receipts.get(id) === session.id && session.pending !== id
          ? Response.json({ data: { id, type: "user" } })
          : Response.json(
              { _tag: "MessageNotFoundError", messageID: id, message: "Message not found" },
              { status: 404 },
            )
      }
      if (match?.[2] === "diff") {
        expect(new URL(request.url).searchParams.get("from")).toBeTruthy()
        return Response.json({ data: diffs })
      }
      if (match?.[2] === "message")
        return Response.json({
          data: [{ type: "assistant", content: [{ type: "text", text: "remote result" }] }],
          cursor: {},
        })
      if (match?.[2] === "permission") {
        counts.permissionReads++
        return Response.json({ data: mode === "waiting" ? [{ id: "permission_test" }] : [] })
      }
      if (match?.[2] === "form") {
        counts.formReads++
        return Response.json({ data: [] })
      }
      counts.sessionReads++
      return Response.json({ data: session })
    },
  })
  const config = path.join(directory, "workers.json")
  const manifest = path.join(directory, "tasks.json")
  const report = path.join(directory, "report.json")
  const worker: Worker.Registration = {
    id: "pi-a",
    url: server.url.origin,
    passwordEnv: "PI_PASSWORD",
    directories: ["/checkout/a"],
    tags: ["linux", "arm64"],
  }
  await WorkerPool.add(config, worker)
  await Bun.write(
    manifest,
    JSON.stringify({
      tasks: [
        { id: "one", prompt: "test", tags: ["arm64"] },
        { id: "two", prompt: "test" },
        { id: "three", prompt: "test" },
      ],
    }),
  )
  return {
    leases,
    leaseState,
    directory,
    server,
    sessions,
    counts,
    admitted,
    diffs,
    config,
    manifest,
    report,
    worker,
    run: (options: Partial<Parameters<typeof WorkerPool.run>[0]> = {}) =>
      WorkerPool.run({
        config,
        manifest,
        report,
        environment: { PI_PASSWORD: "test-secret" },
        pollMs: 5,
        timeoutMs: 200,
        ...options,
      }),
    async [Symbol.asyncDispose]() {
      server.stop(true)
      await rm(directory, { recursive: true, force: true })
    },
  }
}

const gib = 1024 ** 3
test("an older worker stays queued until checkout fencing is supported", async () => {
  await using host = await fixture("complete", undefined, true, false)
  const result = await host.run()
  expect(result.tasks.every((entry) => entry.state === "queued" && entry.queueReason === "lease-unsupported")).toBe(
    true,
  )
  expect(host.counts.creates).toBe(0)
  expect(host.counts.prompts).toBe(0)
})

test("independent coordinator registries cannot dispatch into the same reserved checkout", async () => {
  await using host = await fixture("running")
  await Bun.write(host.manifest, JSON.stringify({ tasks: [{ id: "one", prompt: "Keep working" }] }))
  const first = await host.run()
  const other = {
    config: path.join(host.directory, "other-workers.json"),
    manifest: path.join(host.directory, "other-tasks.json"),
    report: path.join(host.directory, "other-report.json"),
    environment: { PI_PASSWORD: "test-secret" },
    timeoutMs: 20,
    pollMs: 5,
  }
  await WorkerPool.add(other.config, host.worker)
  await Bun.write(other.manifest, JSON.stringify({ tasks: [{ id: "other", prompt: "Competing work" }] }))
  const blocked = await WorkerPool.run(other)
  expect(blocked.tasks).toEqual([{ id: "other", state: "queued", queueReason: "lease-busy" }])
  expect(host.counts.creates).toBe(1)
  expect(host.counts.prompts).toBe(1)
  expect(first.tasks[0]?.lease?.generation).toBe(1)
  host.sessions.get(first.tasks[0]!.sessionID!)!.outcome = "succeeded"
  const finished = await host.run()
  expect(finished.tasks[0]?.leaseReleased).toBe(true)
  const second = await WorkerPool.run(other)
  expect(second.tasks[0]?.state).toBe("running")
  expect(second.tasks[0]?.lease?.generation).toBe(2)
})

test("lost renewal keeps original placement and explicit recovery advances its fence without a new prompt", async () => {
  await using host = await fixture("running")
  await Bun.write(host.manifest, JSON.stringify({ tasks: [{ id: "one", prompt: "Keep working" }] }))
  const first = await host.run()
  const entry = first.tasks[0]!
  const expired = { ...entry.lease!, expiresAt: 1 }
  host.leases.set(entry.directory!, expired)
  await Bun.write(host.report, JSON.stringify({ ...first, tasks: [{ ...entry, lease: expired, leaseRenewAt: 1 }] }))
  host.leaseState.denyRenewal = true
  const lost = await host.run()
  expect(lost.tasks[0]).toMatchObject({
    state: "unknown",
    recoveryReason: "lease-lost",
    sessionID: entry.sessionID,
    messageID: entry.messageID,
  })
  expect(host.counts.prompts).toBe(1)
  host.leaseState.denyRenewal = false
  const recovered = await host.run({ recoverTask: "one" })
  expect(recovered.tasks[0]).toMatchObject({
    state: "succeeded",
    sessionID: entry.sessionID,
    messageID: entry.messageID,
    leaseReleased: true,
  })
  expect(recovered.tasks[0]?.lease?.generation).toBe(2)
  expect(host.admitted.size).toBe(1)
})

test("a restarted coordinator waits for its predecessor and recovers observation without replaying work", async () => {
  await using host = await fixture("running")
  await Bun.write(host.manifest, JSON.stringify({ tasks: [{ id: "one", prompt: "Keep working" }] }))
  const first = await host.run({ coordinator: "runtime-one" })
  const waiting = await host.run({ coordinator: "runtime-two" })
  expect(waiting.tasks[0]?.recoveryReason).toBe("lease-lost")
  expect(host.counts.prompts).toBe(1)
  const entry = first.tasks[0]!
  const expired = { ...entry.lease!, expiresAt: 1 }
  host.leases.set(entry.directory!, expired)
  await Bun.write(host.report, JSON.stringify({ ...first, tasks: [{ ...entry, lease: expired }] }))
  const recovered = await host.run({ coordinator: "runtime-two" })
  expect(recovered.tasks[0]?.lease).toMatchObject({ holder: "runtime-two", generation: 2 })
  expect(recovered.tasks[0]?.state).toBe("running")
  expect(host.counts.prompts).toBe(1)
  expect(host.counts.wakes).toBe(0)
  const stale = await host.run({ coordinator: "runtime-one" })
  expect(stale.tasks[0]?.recoveryReason).toBe("lease-lost")
  expect(host.counts.prompts).toBe(1)
})

test("renewal scheduling does not compare the worker's absolute clock with the coordinator clock", async () => {
  await using host = await fixture("running")
  await Bun.write(host.manifest, JSON.stringify({ tasks: [{ id: "one", prompt: "Keep working" }] }))
  const report = await host.run()
  const entry = report.tasks[0]!
  await Bun.write(
    host.report,
    JSON.stringify({ ...report, tasks: [{ ...entry, lease: { ...entry.lease!, expiresAt: 1 } }] }),
  )
  expect((await host.run()).tasks[0]?.state).toBe("running")
  expect(host.leaseState.renewals).toBe(0)
  expect(host.counts.prompts).toBe(1)
})

function resources(memory: number, cpu = 4, utilization: number | null = 0.1): HostResources.Snapshot {
  return {
    sampledAt: Date.now(),
    platform: "linux arm64",
    cpu: { count: cpu, utilization },
    memory: { totalBytes: 8 * gib, freeBytes: memory * gib },
    process: { pid: 123, residentBytes: 128 * 1024 ** 2 },
  }
}

test("resource admission selects a fitting worker and keeps a large task from blocking a smaller task", async () => {
  await using low = await fixture("complete", () => resources(1))
  await using high = await fixture("complete", () => resources(4))
  await WorkerPool.add(low.config, { ...high.worker, id: "pi-b" })
  await Bun.write(
    low.manifest,
    JSON.stringify({
      tasks: [
        { id: "large", prompt: "Large", resources: { cpu: 1, memoryBytes: 6 * gib } },
        { id: "fits", prompt: "Fits", resources: { cpu: 1, memoryBytes: 2 * gib } },
      ],
    }),
  )
  const result = await low.run()
  expect(result.tasks.map((entry) => entry.state)).toEqual(["queued", "succeeded"])
  expect(result.tasks[0]?.queueReason).toBe("memory-capacity")
  expect(result.tasks[0]?.sessionID).toBeUndefined()
  expect(result.tasks[1]?.worker).toBe("pi-b")
  expect(low.counts.creates).toBe(0)
  expect(high.counts.creates).toBe(1)
})

test("the CLI cancels an impossible unassigned task and releases the registry without creating a Session", async () => {
  await using host = await fixture("complete", () => resources(1))
  await Bun.write(
    host.manifest,
    JSON.stringify({ tasks: [{ id: "blocked", prompt: "Too large", resources: { cpu: 1, memoryBytes: 2 * gib } }] }),
  )
  expect((await host.run()).tasks[0]?.state).toBe("queued")
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "src/index.ts",
      "workers",
      "cancel",
      "blocked",
      "--config",
      host.config,
      "--manifest",
      host.manifest,
      "--report",
      host.report,
    ],
    {
      cwd: path.resolve(import.meta.dir, ".."),
      env: isolatedEnv(host.directory),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ code, stderr: code ? stderr : "" }).toEqual({ code: 0, stderr: "" })
  expect(WorkerPool.Report.make(JSON.parse(stdout)).tasks[0]).toMatchObject({
    id: "blocked",
    state: "interrupted",
    detail: "Cancelled before assignment",
  })
  expect(host.counts.creates).toBe(0)
  expect(await Bun.file(`${host.config}.batch.json`).exists()).toBe(false)
  await WorkerPool.remove(host.config, host.worker.id)
}, 30_000)

test("declared budgets are shared across registrations at the same origin and survive lost observation", async () => {
  await using host = await fixture("lost", () => resources(2))
  await WorkerPool.add(host.config, { ...host.worker, id: "pi-alias", directories: ["/checkout/b"] })
  await Bun.write(
    host.manifest,
    JSON.stringify({
      tasks: [
        { id: "one", prompt: "One", resources: { cpu: 1, memoryBytes: 1.25 * gib } },
        { id: "two", prompt: "Two", resources: { cpu: 1, memoryBytes: 1.25 * gib } },
      ],
    }),
  )
  const first = await host.run()
  expect(first.tasks.map((entry) => entry.state)).toEqual(["unknown", "queued"])
  expect(first.tasks[1]?.queueReason).toBe("memory-capacity")
  await expect(
    WorkerPool.control(
      { config: host.config, manifest: host.manifest, report: host.report },
      { kind: "cancel", task: "one" },
    ),
  ).rejects.toThrow("unassigned queued")
  expect(host.counts.creates).toBe(1)
  const resumed = await host.run()
  expect(resumed.tasks[0]?.sessionID).toBe(first.tasks[0]?.sessionID)
  expect(resumed.tasks[1]?.state).toBe("queued")
  expect(host.counts.creates).toBe(1)
  expect(host.counts.prompts).toBe(1)
})

test("unknown or busy CPU and an older server keep constrained tasks queued until a measured host is available", async () => {
  const state = { sample: undefined as HostResources.Snapshot | undefined }
  await using host = await fixture("complete", () => state.sample)
  await Bun.write(
    host.manifest,
    JSON.stringify({
      tasks: [{ id: "one", prompt: "One", resources: { cpu: 1, memoryBytes: gib, maxCpuUtilization: 0.8 } }],
    }),
  )
  expect((await host.run()).tasks[0]?.queueReason).toBe("resources-unavailable")
  state.sample = resources(4, 4, null)
  expect((await host.run()).tasks[0]?.queueReason).toBe("cpu-load-unavailable")
  state.sample = resources(4, 4, 0.95)
  expect((await host.run()).tasks[0]?.queueReason).toBe("cpu-load")
  expect(host.counts.creates).toBe(0)
  state.sample = resources(4, 4, 0.2)
  expect((await host.run()).tasks[0]?.state).toBe("succeeded")
  await host.run()
  expect(host.counts.creates).toBe(1)
  expect(host.counts.prompts).toBe(1)
})

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

for (const modern of [true, false]) {
  for (const mode of ["admission-missing", "idle-admission"] as const) {
    test(`${modern ? "current" : "older"} worker retains ${mode} until explicit recovery confirms the original admission`, async () => {
      await using host = await fixture(mode, undefined, modern)
      const initial = await host.run()
      expect(initial.tasks[0]?.state).toBe("unknown")
      const resumed = await host.run()
      expect(resumed.tasks[0]).toMatchObject({
        state: "unknown",
        recoveryReason: mode === "admission-missing" ? "admission-missing" : "execution-idle",
      })
      expect(resumed.tasks[0]?.sessionID).toBe(initial.tasks[0]?.sessionID)
      expect(resumed.tasks[0]?.messageID).toBe(initial.tasks[0]?.messageID)
      expect(host.counts.creates).toBe(1)
      expect(host.counts.prompts).toBe(1)
      expect(host.counts.wakes).toBe(0)
      const recovered = await host.run({ recoverTask: "one" })
      expect(recovered.tasks.map((entry) => entry.state)).toEqual(["succeeded", "succeeded", "succeeded"])
      expect(recovered.tasks[0]?.sessionID).toBe(initial.tasks[0]?.sessionID)
      expect(recovered.tasks[0]?.messageID).toBe(initial.tasks[0]?.messageID)
      expect(recovered.tasks[0]?.recoveryReason).toBeUndefined()
      expect(host.admitted.size).toBe(3)
      expect(host.counts.wakes).toBe(1)
      if (modern) {
        expect(host.counts.observations).toBeGreaterThan(0)
        expect(host.counts.sessionReads).toBe(1) // explicit recovery checks placement
        expect(host.counts.permissionReads + host.counts.formReads).toBe(0)
      }
    })
  }
}

test("recovery refuses an assigned Session moved to another checkout", async () => {
  await using host = await fixture("admission-missing")
  const initial = await host.run()
  host.sessions.get(initial.tasks[0]!.sessionID!)!.location.directory = "/different-checkout"
  const recovered = await host.run({ recoverTask: "one" })
  expect(recovered.tasks[0]).toMatchObject({ state: "unknown", recoveryReason: "placement-changed" })
  expect(host.counts.prompts).toBe(1)
  expect(host.counts.wakes).toBe(0)
  expect(host.counts.creates).toBe(1)
})

test("an old terminal outcome cannot release a checkout whose original task was never admitted", async () => {
  await using host = await fixture("admission-missing")
  const initial = await host.run()
  host.sessions.get(initial.tasks[0]!.sessionID!)!.outcome = "succeeded"
  const observed = await host.run()
  expect(observed.tasks[0]).toMatchObject({ state: "unknown", recoveryReason: "admission-missing" })
  expect(host.counts.creates).toBe(1)
  expect(host.counts.prompts).toBe(1)
  const recovered = await host.run({ recoverTask: "one" })
  expect(recovered.tasks.every((task) => task.state === "succeeded")).toBe(true)
  expect(recovered.tasks[0]?.sessionID).toBe(initial.tasks[0]?.sessionID)
  expect(recovered.tasks[0]?.messageID).toBe(initial.tasks[0]?.messageID)
  expect(host.counts.wakes).toBe(1)
  expect(host.admitted.size).toBe(3)
})

test("recovery accepts equivalent Windows checkout spelling without moving the assignment", async () => {
  await using host = await fixture("admission-missing")
  await Bun.write(host.config, JSON.stringify({ workers: [{ ...host.worker, directories: ["C:/work/project/"] }] }))
  const initial = await host.run()
  host.sessions.get(initial.tasks[0]!.sessionID!)!.location.directory = "c:\\WORK\\project"
  const recovered = await host.run({ recoverTask: "one" })
  expect(recovered.tasks.every((task) => task.state === "succeeded")).toBe(true)
  expect(recovered.tasks[0]?.directory).toBe("C:/work/project/")
  expect(recovered.tasks[0]?.sessionID).toBe(initial.tasks[0]?.sessionID)
  expect(recovered.tasks[0]?.messageID).toBe(initial.tasks[0]?.messageID)
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
  const input = {
    config: host.config,
    manifest: host.manifest,
    report: host.report,
    task: "one",
    output,
    environment: { PI_PASSWORD: "test-secret" },
  }
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
  const input = {
    config: host.config,
    manifest: host.manifest,
    report: host.report,
    task: "one",
    output: path.join(host.directory, "result"),
    environment: { PI_PASSWORD: "test-secret" },
  }
  await expect(WorkerPool.collect(input)).rejects.toThrow("terminal task")
  await Bun.write(
    host.report,
    JSON.stringify({
      ...report,
      tasks: report.tasks.map((entry) => (entry.id === "one" ? { ...entry, state: "succeeded" } : entry)),
    }),
  )
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
  await expect(host.run({ report: path.join(host.directory, "another-report.json") })).rejects.toThrow(
    "unfinished batch",
  )
})

test("lost observation never replays a prompt or releases its checkout", async () => {
  await using host = await fixture("lost")
  expect((await host.run()).tasks.map((entry) => entry.state)).toEqual(["unknown", "queued", "queued"])
  await host.run()
  const journal = await stat(host.report, { bigint: true })
  const registry = await stat(`${host.config}.batch.json`, { bigint: true })
  await host.run()
  expect((await stat(host.report, { bigint: true })).mtimeNs).toBe(journal.mtimeNs)
  expect((await stat(host.report, { bigint: true })).ino).toBe(journal.ino)
  expect((await stat(`${host.config}.batch.json`, { bigint: true })).mtimeNs).toBe(registry.mtimeNs)
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
      cwd: path.resolve(import.meta.dir, ".."),
      env: isolatedEnv(host.directory, { PI_PASSWORD: "test-secret" }),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ code, stderr: code ? stderr : "" }).toEqual({ code: 0, stderr: "" })
    return stdout
  }
  await command([
    "add",
    "cli-pi",
    "--config",
    config,
    "--url",
    host.server.url.origin,
    "--directory",
    "/checkout/cli",
    "--password-env",
    "PI_PASSWORD",
    "--tag",
    "arm64",
  ])
  const result = WorkerPool.Report.make(
    JSON.parse(await command(["run", manifest, "--config", config, "--report", report, "--timeout", "5"])),
  )
  expect(result.tasks[0]?.state).toBe("succeeded")
  expect(host.counts.prompts).toBe(1)
  await Bun.write(
    report,
    JSON.stringify({ ...result, tasks: result.tasks.map((entry) => ({ ...entry, state: "unknown" })) }),
  )
  const recovered = WorkerPool.Report.make(
    JSON.parse(
      await command([
        "recover",
        "cli-task",
        "--config",
        config,
        "--manifest",
        manifest,
        "--report",
        report,
        "--timeout",
        "5",
      ]),
    ),
  )
  expect(recovered.tasks[0]?.state).toBe("succeeded")
  expect(host.counts.prompts).toBe(1)
  const output = path.join(host.directory, "cli-result")
  await command([
    "collect",
    "cli-task",
    "--config",
    config,
    "--manifest",
    manifest,
    "--report",
    report,
    "--output",
    output,
  ])
  expect(await Bun.file(path.join(output, "changes.patch")).text()).toBe(host.diffs[0]!.patch)
  await command(["remove", "cli-pi", "--config", config])
  expect((await WorkerPool.readConfig(config)).workers).toEqual([])
}, 45_000)

test("resumes a legacy remote journal after adding native local registrations", async () => {
  await using host = await fixture()
  const config = {
    workers: [
      {
        id: host.worker.id,
        url: host.server.url.origin,
        passwordEnv: "PI_PASSWORD",
        directories: ["/checkout/a"],
        tags: ["linux", "arm64"],
      },
    ],
  }
  const manifest = await Bun.file(host.manifest).json()
  await Bun.write(host.config, JSON.stringify(config))
  await Bun.write(
    host.report,
    JSON.stringify({
      fingerprint: createHash("sha256").update(JSON.stringify({ config, manifest })).digest("hex"),
      tasks: manifest.tasks.map((task: Worker.Task) => ({ id: task.id, state: "queued" })),
    }),
  )
  expect((await host.run()).tasks.every((entry) => entry.state === "succeeded")).toBe(true)
})

test("recovers local admission across a changed listener and coordinator incarnation", async () => {
  await using host = await fixture("admission-lost")
  await Bun.write(
    host.config,
    JSON.stringify({
      workers: [{ kind: "local", id: host.worker.id, directories: ["/checkout/a"], tags: ["linux", "arm64"] }],
    }),
  )
  const connection = { url: host.server.url.origin }
  const local = () =>
    OpenCode.make({ baseUrl: connection.url, headers: { authorization: `Basic ${btoa("opencode:test-secret")}` } })
  const initial = await host.run({ local, environment: {}, coordinator: "before-restart" })
  expect(initial.tasks[0]?.state).toBe("unknown")
  const listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      return fetch(new Request(host.server.url.origin + url.pathname + url.search, request))
    },
  })
  connection.url = listener.url.origin
  host.leases.forEach((lease, directory) => host.leases.set(directory, { ...lease, expiresAt: Date.now() - 1 }))
  const recovered = await host
    .run({ local, environment: {}, coordinator: "after-restart", recoverTask: "one" })
    .finally(() => listener.stop(true))
  expect(recovered.tasks.map((entry) => entry.state)).toEqual(["succeeded", "succeeded", "succeeded"])
  expect(recovered.tasks[0]?.sessionID).toBe(initial.tasks[0]?.sessionID)
  expect(recovered.tasks[0]?.messageID).toBe(initial.tasks[0]?.messageID)
  expect(recovered.tasks[0]?.url).toBe("local")
  expect(host.counts.creates).toBe(3)
  expect(host.counts.wakes).toBe(1)
  expect(host.admitted.size).toBe(3)
})
