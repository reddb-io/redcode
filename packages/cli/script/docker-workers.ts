#!/usr/bin/env bun
import { OpenCode } from "@opencode/client/promise"
import { WorkerPool } from "../src/workers/pool"
import { Worker } from "@opencode/schema/worker"
import { mkdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../..")
const project = `redcode-workers-${randomUUID().slice(0, 8)}`
const outputFlag = process.argv.indexOf("--output")
const output = path.resolve(
  outputFlag >= 0 ? (process.argv[outputFlag + 1] ?? "") : path.join(root, ".red/tmp", project),
)
if (outputFlag >= 0 && !process.argv[outputFlag + 1]) throw new Error("--output requires a new directory")
await mkdir(path.dirname(output), { recursive: true })
await mkdir(output)
const compose = ["compose", "-p", project, "-f", path.join(root, "packages/server/test/docker-workers/compose.yaml")]
// Choose free loopback ports once so the registry remains stable across container restarts.
const reservations = Array.from({ length: 3 }, () =>
  Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }),
)
const dockerEnvironment = {
  ...process.env,
  WORKER_A_PORT: String(reservations[0]!.port),
  WORKER_B_PORT: String(reservations[1]!.port),
  COORDINATOR_PORT: String(reservations[2]!.port),
}
reservations.forEach((server) => server.stop(true))
const environment = { DOCKER_WORKER_PASSWORD: "redcode-docker-fixture-only" }
const checks: { name: string; passed: boolean }[] = []
const check = (name: string, passed: boolean) => {
  checks.push({ name, passed })
  if (!passed) throw new Error(name)
}

try {
  if (!process.argv.includes("--skip-build")) await docker([...compose, "build", "worker-a"])
  await docker([...compose, "up", "-d", "--no-build", "--wait", "--wait-timeout", "120"])
  const workers = await Promise.all(
    ["worker-a", "worker-b"].map(async (id) => {
      const url = `http://${(await docker([...compose, "port", id, "4096"])).trim()}`
      const api = OpenCode.make({
        baseUrl: url,
        headers: { authorization: `Basic ${btoa(`opencode:${environment.DOCKER_WORKER_PASSWORD}`)}` },
      })
      return { id, url, api }
    }),
  )
  const config = path.join(output, "workers.json")
  for (const worker of workers) {
    const registration = {
      id: worker.id,
      url: worker.url,
      passwordEnv: "DOCKER_WORKER_PASSWORD",
      directories: ["/lab/checkout"],
      tags: [],
    }
    const system = await WorkerPool.health(registration, environment)
    await WorkerPool.add(config, { ...registration, tags: ["docker", ...system.platform.split(" ")] })
    await Bun.write(path.join(output, `${worker.id}-system.json`), JSON.stringify(system, null, 2))
    check(
      `${worker.id} rejects unauthenticated access`,
      (await fetch(`${worker.url}/api/session`, { signal: AbortSignal.timeout(5_000) })).status === 401,
    )
  }
  const manifest = path.join(output, "tasks.json")
  const report = path.join(output, "tasks.run.json")
  await Bun.write(
    manifest,
    JSON.stringify({
      tasks: workers.map((worker, index) => ({
        id: index ? "beta" : "alpha",
        worker: worker.id,
        prompt: `[worker-task:${index ? "beta" : "alpha"}] Write a result and verify Linux/Git.`,
      })),
    }),
  )
  const placements = new Map<string, string>()
  const probe: { result?: Promise<boolean> } = {}
  const initial = await WorkerPool.run({
    config,
    manifest,
    report,
    environment,
    timeoutMs: 30_000,
    pollMs: 100,
    onUpdate: (entry) => {
      if (entry.state === "running" && entry.worker && entry.sessionID) placements.set(entry.worker, entry.sessionID)
      if (placements.size === 2 && !probe.result)
        probe.result = Promise.all(
          workers.map(async (worker) => Boolean((await worker.api.session.active())[placements.get(worker.id)!])),
        ).then((active) => active.every(Boolean))
    },
  })
  check("Both Linux workers execute concurrently", Boolean(await probe.result))
  check(
    "Both agent tasks succeed",
    initial.tasks.every((task) => task.state === "succeeded"),
  )
  for (const task of initial.tasks) {
    check(
      `${task.id} returns its assigned worker identity`,
      Boolean(task.text?.includes(`${task.worker} completed ${task.id} on Linux`)),
    )
    const artifact = await WorkerPool.collect({
      config,
      manifest,
      report,
      environment,
      task: task.id,
      output: path.join(output, task.id),
    })
    check(
      `${task.id} exports the actual Git file patch`,
      artifact.files.some(
        (file) => file.file === `output/${task.id}.txt` && file.patch.includes(`${task.worker} completed ${task.id}`),
      ),
    )
    const opposite = workers.find((worker) => worker.id !== task.worker)!
    check(
      `${task.id} is absent from the other worker database`,
      (
        await fetch(`${opposite.url}/api/session/${task.sessionID}`, {
          headers: { authorization: `Basic ${btoa(`opencode:${environment.DOCKER_WORKER_PASSWORD}`)}` },
          signal: AbortSignal.timeout(5_000),
        })
      ).status === 404,
    )
  }
  const first = workers[0]!
  const retryManifest = path.join(output, "restart-tasks.json")
  const retryReport = path.join(output, "restart.run.json")
  await Bun.write(
    retryManifest,
    JSON.stringify({
      tasks: [
        { id: "restart", worker: first.id, prompt: "[worker-task:restart] [slow] Finish after a server restart." },
        {
          id: "after",
          worker: first.id,
          prompt: "[worker-task:after] Verify the checkout slot is released after completion.",
        },
      ],
    }),
  )
  const running = await WorkerPool.run({
    config,
    manifest: retryManifest,
    report: retryReport,
    environment,
    timeoutMs: 150,
    pollMs: 50,
  })
  check(
    "An observation deadline reserves the checkout",
    running.tasks[0]?.state === "running" && running.tasks[1]?.state === "queued",
  )
  await docker([...compose, "kill", "-s", "SIGKILL", first.id])
  const disconnected = await WorkerPool.run({
    config,
    manifest: retryManifest,
    report: retryReport,
    environment,
    timeoutMs: 300,
    pollMs: 50,
  })
  check(
    "A disconnected worker retains the original assignment",
    disconnected.tasks[0]?.state === "unknown" &&
      disconnected.tasks[0]?.sessionID === running.tasks[0]?.sessionID &&
      disconnected.tasks[1]?.state === "queued",
  )
  await docker([...compose, "up", "-d", "--no-build", "--wait", "--wait-timeout", "120", first.id])
  // Docker may change an ephemeral host port after recreation; start the existing container, not a replacement.
  check(
    "Restart preserves the registered worker address",
    (await docker([...compose, "port", first.id, "4096"])).trim() === new URL(first.url).host,
  )
  const recovered = await WorkerPool.run({
    config,
    manifest: retryManifest,
    report: retryReport,
    environment,
    recoverTask: "restart",
    timeoutMs: 30_000,
    pollMs: 100,
  })
  check(
    "Recovery preserves Session and message IDs",
    recovered.tasks[0]?.sessionID === running.tasks[0]?.sessionID &&
      recovered.tasks[0]?.messageID === running.tasks[0]?.messageID,
  )
  check(
    "Recovered work and its queued successor complete",
    recovered.tasks.every((task) => task.state === "succeeded"),
  )
  const messages = await first.api.message.list({ sessionID: recovered.tasks[0]!.sessionID!, limit: 100 })
  check(
    "Recovery delivers the original user prompt once",
    messages.data.filter((message) => message.type === "user").length === 1,
  )
  await WorkerPool.collect({
    config,
    manifest: retryManifest,
    report: retryReport,
    environment,
    task: "restart",
    output: path.join(output, "restart"),
  })
  const coordinatorURL = `http://${(await docker([...compose, "port", "coordinator", "4096"])).trim()}`
  const coordinator = OpenCode.make({
    baseUrl: coordinatorURL,
    headers: { authorization: `Basic ${btoa(`opencode:${environment.DOCKER_WORKER_PASSWORD}`)}` },
  })
  check("Coordinator rejects unauthenticated access", (await fetch(`${coordinatorURL}/api/workers`)).status === 401)
  for (const worker of workers) {
    await coordinator.workers.add({
      id: worker.id,
      url: `http://${worker.id}:4096`,
      directories: ["/lab/checkout"],
      tags: ["linux"],
      password: environment.DOCKER_WORKER_PASSWORD,
    })
  }
  const registry = await coordinator.workers.list()
  check(
    "Coordinator registers two authenticated workers without exposing credentials",
    registry.workers.length === 2 && !JSON.stringify(registry).includes(environment.DOCKER_WORKER_PASSWORD),
  )
  await coordinator.workers
    .add({
      id: "worker-a",
      url: "http://worker-a:4096",
      directories: ["/lab/checkout"],
      tags: [],
      password: environment.DOCKER_WORKER_PASSWORD,
    })
    .then(
      () => {
        throw new Error("Duplicate worker accepted")
      },
      () => {},
    )
  check(
    "Duplicate registration retains the original credential",
    (await coordinator.workers.probe({ id: "worker-a" })).connection === "online",
  )
  const batch = await coordinator.workers.submit({
    tasks: [
      {
        id: "central-a",
        worker: "worker-a",
        prompt: "[worker-task:central-a] [slow] Finish without a connected desktop.",
      },
      {
        id: "central-b",
        worker: "worker-b",
        prompt: "[worker-task:central-b] [slow] Finish without a connected desktop.",
      },
    ],
  })
  await coordinator.workers.remove({ id: "worker-a" }).then(
    () => {
      throw new Error("Accepted batch allowed its worker to be removed")
    },
    () => {},
  )
  check("Accepted batch reserves registry before dispatch", (await coordinator.workers.list()).workers.length === 2)
  const admitted = await central(
    (snapshot) =>
      snapshot.batches.find((item) => item.id === batch.id)?.report?.tasks.every((task) => task.state === "running") ??
      false,
  )
  const ids = admitted.batches.find((item) => item.id === batch.id)!.report!.tasks.map((task) => task.sessionID)
  await coordinator.workers.remove({ id: "worker-a" }).then(
    () => {
      throw new Error("Reserved worker removed")
    },
    () => {},
  )
  check("Active batch prevents registry edits", (await coordinator.workers.list()).workers.length === 2)
  await docker([...compose, "kill", "-s", "SIGKILL", "coordinator"])
  // No client and no coordinator process remain connected while the worker agents continue.
  await Bun.sleep(10_000)
  await docker([...compose, "up", "-d", "--no-build", "--wait", "--wait-timeout", "120", "coordinator"])
  const completed = await central(
    (snapshot) =>
      snapshot.batches
        .find((item) => item.id === batch.id)
        ?.report?.tasks.every((task) => task.state === "succeeded") ?? false,
  )
  const original = completed.batches.find((item) => item.id === batch.id)!
  check(
    "Coordinator restart retains its registry and batch",
    completed.workers.length === 2 && original.id === batch.id,
  )
  check(
    "Workers finish independently and coordinator preserves original Session IDs",
    original.report!.tasks.every((task, index) => task.sessionID === ids[index]),
  )
  for (const task of original.report!.tasks) {
    const artifact = await coordinator.workers.collect({ id: batch.id, task: task.id })
    check(
      `${task.id} returns reviewable patches through the coordinator API`,
      artifact.files.some((file) => file.file === `output/${task.id}.txt`) &&
        artifact.patch.includes(`${task.worker} completed ${task.id}`),
    )
    await Bun.write(path.join(output, `${task.id}-artifact.json`), JSON.stringify(artifact, null, 2))
    const owner = workers.find((worker) => worker.id === task.worker)!
    check(
      `${task.id} is admitted once across coordinator restart`,
      (await owner.api.message.list({ sessionID: task.sessionID!, limit: 100 })).data.filter(
        (message) => message.type === "user",
      ).length === 1,
    )
  }
  await coordinator.workers.remove({ id: "worker-b" })
  check("Completed batch releases registry for removal", (await coordinator.workers.list()).workers.length === 1)
  const savedArtifact = await coordinator.workers.collect({ id: batch.id, task: "central-b" })
  check("Collected patches survive worker removal", savedArtifact.patch.includes("worker-b completed central-b"))
  await Bun.write(path.join(output, "coordinator.json"), JSON.stringify(completed, null, 2))
  async function central(predicate: (snapshot: Worker.Snapshot) => boolean) {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const snapshot = await coordinator.workers.list()
      if (predicate(snapshot)) return snapshot
      await Bun.sleep(100)
    }
    throw new Error(`Coordinator did not reach the required state: ${JSON.stringify(await coordinator.workers.list())}`)
  }
  await Bun.write(
    path.join(output, "acceptance.json"),
    JSON.stringify(
      {
        passed: true,
        project,
        image: (await docker(["image", "inspect", "redcode-worker-lab:local", "--format", "{{.Id}}"])).trim(),
        platform: (await docker(["info", "--format", "{{.OSType}}/{{.Architecture}}"])).trim(),
        model: "deterministic TestLLM; real HTTP/auth/database/execution/tools/Git",
        checks,
      },
      null,
      2,
    ),
  )
  process.stdout.write(`Docker worker acceptance passed (${checks.length} checks). Results: ${output}\n`)
} finally {
  const logs = await docker([...compose, "logs", "--no-color", "--tail", "120"]).catch((error: unknown) =>
    String(error),
  )
  await Bun.write(path.join(output, "workers.log"), logs)
  await docker([...compose, "down", "--volumes"])
}

async function docker(args: string[]) {
  const child = Bun.spawn(["docker", ...args], { cwd: root, env: dockerEnvironment, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code) throw new Error(`docker ${args.join(" ")} failed (${code})\n${stdout}\n${stderr}`)
  return stdout
}
