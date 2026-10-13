export * as WorkerEnvironments from "./worker-environments"

import { Context, Effect, Layer, Schema } from "effect"
import { WorkerEnvironment } from "@opencode/schema/worker-environment"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/schema/integration"
import { Global } from "@opencode/util/global"
import { Flock } from "@opencode/util/flock"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { optional } from "@opencode/schema/schema"
import { OpenCode } from "@opencode/client/promise"
import { WorkerEnvironmentProxy } from "./worker-environment-proxy"
import { randomUUID } from "node:crypto"
import { mkdir, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { createServer } from "node:net"

const Saved = Schema.Struct({ info: WorkerEnvironment.Info, credentialID: Schema.String, port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })) })
type Saved = typeof Saved.Type
const Inspection = Schema.Struct({
  running: Schema.Boolean,
  owner: Schema.String,
  user: Schema.String,
  readonly: Schema.Boolean,
  privileged: Schema.Boolean,
  caps: Schema.NullOr(Schema.Array(Schema.String)),
  cpu: Schema.Number,
  memory: Schema.Number,
  pids: Schema.Number,
  security: Schema.NullOr(Schema.Array(Schema.String)),
  network: Schema.String,
  networks: Schema.Record(Schema.String, Schema.Unknown),
  image: Schema.String,
  pidMode: Schema.String,
  groups: Schema.NullOr(Schema.Array(Schema.String)),
  devices: Schema.NullOr(Schema.Array(Schema.Unknown)),
  mounts: Schema.Array(Schema.Struct({ Type: Schema.String, Name: optional(Schema.String), Destination: Schema.String })),
  ports: Schema.Record(Schema.String, Schema.NullOr(Schema.Array(Schema.Struct({ HostIp: Schema.String, HostPort: Schema.String })))),
})

export interface Interface {
  list(): Promise<WorkerEnvironment.Snapshot>
  build(version: string): Promise<{ image: string }>
  create(input: WorkerEnvironment.Create): Promise<WorkerEnvironment.Info>
  start(id: string): Promise<WorkerEnvironment.Info>
  stop(id: string): Promise<WorkerEnvironment.Info>
  remove(id: string, purge: boolean): Promise<void>
  request(id: string, input: WorkerEnvironment.Request): Promise<WorkerEnvironment.Response>
  connection(id: string): Promise<{ url: string; password: string }>
}
export class Service extends Context.Service<Service, Interface>()("@redcode/WorkerEnvironments") {}

const unsupported = async () => { throw new Error("Worker environments require a Bun host with a local Docker engine") }
export const unavailableLayer = Layer.succeed(Service, Service.of({
  list: async () => ({ available: false, engine: "unsupported", environments: [] }),
  build: unsupported, create: unsupported, start: unsupported, stop: unsupported, remove: unsupported,
  request: unsupported, connection: unsupported,
}))

/** Arguments are fixed by the host; callers cannot supply Docker flags, mounts or a privileged user. */
export function containerArguments(info: WorkerEnvironment.Info, owner: string, secretFile: string) {
  const name = `redcode-${owner}-${info.id}`
  return ["create", "--name", name, "--label", `redcode.owner=${owner}`, "--label", "redcode.kind=workspace",
    "--init", "--user", "1000:1000", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--pids-limit", "256", "--ulimit", "nofile=4096:4096", "--cpus", String(info.cpu), "--memory", `${info.memoryMiB}m`, "--memory-swap", `${info.memoryMiB}m`,
    "--network", `${name}-network`, "--network-alias", "worker", "--env-file", secretFile,
    "--env", "HOME=/home/worker", "--env", "GIT_TERMINAL_PROMPT=0",
    "--env", "REDCODE_AUTO_WORKTREE=0",
    "--env", "HTTPS_PROXY=http://gateway:3128", "--env", "HTTP_PROXY=http://gateway:3128",
    "--env", "https_proxy=http://gateway:3128", "--env", "http_proxy=http://gateway:3128",
    "--env", "NO_PROXY=127.0.0.1,localhost", "--env", "no_proxy=127.0.0.1,localhost",
    "--mount", `type=volume,source=${name}-workspace,target=/workspace`,
    "--mount", `type=volume,source=${name}-home,target=/home/worker`,
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=268435456", "--workdir", "/workspace",
    "--entrypoint", "/usr/local/bin/redcode", info.imageID ?? info.image, "serve", "--hostname", "0.0.0.0", "--port", "4096"]
}

export function publicRepository(value: string) {
  const url = new URL(value)
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname || url.pathname === "/")
    throw new Error("Use a public HTTPS Git repository without credentials, query or fragment")
  return url.href
}

export async function createWorkerEnvironments(root: string, credentials: Credential.Interface): Promise<Interface> {
  const owned = path.resolve(root)
  await mkdir(owned, { recursive: true, mode: 0o700 })
  const identity = path.join(owned, "identity")
  const owner = await Flock.withLock(identity, async () => {
    if (!(await Bun.file(identity).exists())) await Bun.write(identity, randomUUID().replaceAll("-", ""), { mode: 0o600 })
    return (await Bun.file(identity).text()).trim()
  }, { dir: `${identity}.lock`, timeoutMs: 2_000 })
  if (!/^[a-f0-9]{32}$/.test(owner)) throw new Error("Invalid environment runtime identity")
  const jobs = new Set<string>()
  const name = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error("Invalid environment name")
    return `redcode-${owner}-${id}`
  }
  const file = (id: string) => { name(id); return path.join(owned, `${id}.json`) }
  const read = async (id: string) => Schema.decodeUnknownSync(Saved)(await Bun.file(file(id)).json())
  const save = async (value: Saved) => {
    const temporary = `${file(value.info.id)}.${randomUUID()}.tmp`
    await Bun.write(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, file(value.info.id))
  }
  const docker = async (args: string[], input?: string, timeout = 120_000) => {
    const process = Bun.spawn(["docker", ...args], { stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "ignore" })
    const timer = setTimeout(() => process.kill(), timeout)
    try {
      const output = async () => {
        const reader = process.stdout.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > 65536) { process.kill(); await reader.cancel(); throw new Error("Docker command output exceeded its limit") }
          chunks.push(chunk.value)
        }
        return Buffer.concat(chunks).toString("utf8")
      }
      const [code, text] = await Promise.all([process.exited, output()])
      if (code !== 0) throw new Error("Docker operation failed; check the engine, image and container on this host")
      return text.trim()
    } finally { clearTimeout(timer) }
  }
  const engine = async () => {
    if (process.env.DOCKER_HOST && !/^(unix:|npipe:)/.test(process.env.DOCKER_HOST))
      throw new Error("Use a local Docker engine on the selected host")
    const endpoint = await docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"])
    if (!/^(unix:|npipe:)/.test(endpoint)) throw new Error("Use a local Docker engine on the selected host")
    const result = await docker(["info", "--format", "{{.OSType}} {{.ServerVersion}}"])
    if (!result.startsWith("linux ")) throw new Error("Linux containers are required")
    if (Number(result.split(" ")[1]?.split(".")[0]) < 28) throw new Error("Docker 28 or newer is required for isolated networks")
    return result
  }
  const inspect = async (info: WorkerEnvironment.Info, gateway = false) => {
    const data = Schema.decodeUnknownSync(Inspection)(JSON.parse(await docker(["inspect", "--format",
      '{"running":{{.State.Running}},"owner":{{json (index .Config.Labels "redcode.owner")}},"user":{{json .Config.User}},"readonly":{{.HostConfig.ReadonlyRootfs}},"privileged":{{.HostConfig.Privileged}},"caps":{{json .HostConfig.CapDrop}},"cpu":{{.HostConfig.NanoCpus}},"memory":{{.HostConfig.Memory}},"pids":{{.HostConfig.PidsLimit}},"security":{{json .HostConfig.SecurityOpt}},"network":{{json .HostConfig.NetworkMode}},"networks":{{json .NetworkSettings.Networks}},"image":{{json .Image}},"pidMode":{{json .HostConfig.PidMode}},"groups":{{json .HostConfig.GroupAdd}},"devices":{{json .HostConfig.Devices}},"mounts":{{json .Mounts}},"ports":{{json .NetworkSettings.Ports}}}', name(info.id) + (gateway ? "-gateway" : "")])))
    if (data.owner !== owner || data.user !== "1000:1000" || !data.readonly || data.privileged || !data.caps?.includes("ALL") ||
      data.image !== info.imageID || data.cpu !== Math.round((gateway ? 0.25 : info.cpu) * 1e9) || data.memory !== (gateway ? 128 : info.memoryMiB) * 1048576 || data.pids !== (gateway ? 64 : 256) ||
      !data.security?.some((option) => option === "no-new-privileges" || option === "no-new-privileges:true") ||
      data.network !== `${name(info.id)}-${gateway ? "egress" : "network"}` ||
      Object.keys(data.networks).sort().join(",") !== [`${name(info.id)}-network`, ...(gateway ? [`${name(info.id)}-egress`] : [])].sort().join(",") ||
      data.pidMode === "host" || data.groups?.length || data.devices?.length ||
      data.mounts.some((mount) => mount.Type !== "tmpfs" && (mount.Type !== "volume" ||
        ![[`${name(info.id)}-workspace`, "/workspace"], [`${name(info.id)}-home`, "/home/worker"]].some(([volume, destination]) => mount.Name === volume && mount.Destination === destination))) ||
      data.mounts.filter((mount) => mount.Type === "volume").length !== (gateway ? 0 : 2))
      throw new Error("Container isolation differs from the managed policy")
    return data
  }
  const endpoint = async (info: WorkerEnvironment.Info) => {
    const worker = await inspect(info)
    const data = await inspect(info, true)
    const port = data.ports["8080/tcp"]?.find((port) => port.HostIp === "127.0.0.1")
    if (!worker.running || !data.running || !port || !/^\d+$/.test(port.HostPort)) throw new Error("Environment is not running")
    return `http://127.0.0.1:${port.HostPort}`
  }
  const password = async (saved: Saved) => {
    const stored = await Effect.runPromise(credentials.get(Credential.ID.make(saved.credentialID)))
    if (stored?.integrationID !== `redcode-environment:${saved.info.id}` || stored.value.type !== "key")
      throw new Error("Environment credential is unavailable")
    return stored.value.key
  }
  const createContainer = async (saved: Saved) => {
    const network = `${name(saved.info.id)}-network`
    const found = await docker(["network", "ls", "--filter", `name=^${network}$`, "--format", "{{.ID}}"])
    if (!found) await docker(["network", "create", "--internal", "--opt", "com.docker.network.bridge.gateway_mode_ipv4=isolated", "--opt", "com.docker.network.bridge.gateway_mode_ipv6=isolated", "--label", `redcode.owner=${owner}`, network])
    if ((await docker(["network", "inspect", "--format", '{{index .Labels "redcode.owner"}}', network])) !== owner)
      throw new Error("Network belongs to another runtime")
    if ((await docker(["network", "inspect", "--format", '{{.Internal}} {{index .Options "com.docker.network.bridge.gateway_mode_ipv4"}} {{index .Options "com.docker.network.bridge.gateway_mode_ipv6"}}', network])) !== "true isolated isolated")
      throw new Error("Workspace network is not isolated")
    const egress = `${name(saved.info.id)}-egress`
    if (!(await docker(["network", "ls", "--filter", `name=^${egress}$`, "--format", "{{.ID}}"])))
      await docker(["network", "create", "--label", `redcode.owner=${owner}`, egress])
    if ((await docker(["network", "inspect", "--format", '{{index .Labels "redcode.owner"}}', egress])) !== owner)
      throw new Error("Network belongs to another runtime")
    for (const volume of [`${name(saved.info.id)}-workspace`, `${name(saved.info.id)}-home`]) {
      await docker(["volume", "create", "--label", `redcode.owner=${owner}`, volume])
      if ((await docker(["volume", "inspect", "--format", '{{index .Labels "redcode.owner"}}', volume])) !== owner)
        throw new Error("Volume belongs to another runtime")
    }
    const secret = path.join(owned, `${saved.info.id}.${randomUUID()}.env`)
    await Bun.write(secret, `REDCODE_PASSWORD=${await password(saved)}\n`, { mode: 0o600 })
    try { await docker(containerArguments(saved.info, owner, secret)) }
    finally { await rm(secret, { force: true }) }
    await docker(["create", "--name", `${name(saved.info.id)}-gateway`, "--label", `redcode.owner=${owner}`, "--label", "redcode.kind=workspace-gateway",
      "--init", "--user", "1000:1000", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
      "--cpus", "0.25", "--memory", "128m", "--memory-swap", "128m", "--pids-limit", "64", "--ulimit", "nofile=1024:1024",
      "--network", egress, "--publish", `127.0.0.1:${saved.port}:8080`, "--tmpfs", "/tmp:rw,nosuid,nodev,size=33554432",
      "--entrypoint", "/usr/local/bin/bun", saved.info.imageID!, "/usr/local/lib/worker-proxy.cjs"])
    await docker(["network", "connect", "--alias", "gateway", network, `${name(saved.info.id)}-gateway`])
    await docker(["start", `${name(saved.info.id)}-gateway`])
    await docker(["start", name(saved.info.id)])
    await inspect(saved.info)
    await inspect(saved.info, true)
  }
  const call = async (saved: Saved, input: WorkerEnvironment.Request) => {
    const url = new URL(input.path, "http://worker")
    const pathname = decodeURIComponent(url.pathname)
    if (!input.path.startsWith("/api/") || input.path.includes("\\") || pathname.includes("\\") || pathname.includes("%") || url.origin !== "http://worker" || url.hash ||
      !/^\/api\/(info|system|resources|location|session|permission|form|fs)(\/|$)/.test(pathname))
      throw new Error("Unsupported environment request")
    const response = await fetch(`${await endpoint(saved.info)}${pathname}${url.search}`, {
      method: input.method, body: input.body,
      headers: { authorization: `Basic ${btoa(`opencode:${await password(saved)}`)}`, "content-type": "application/json" },
      redirect: "error", signal: AbortSignal.timeout(40_000),
    })
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = response.body?.getReader()
    while (reader) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 16 * 1024 * 1024) { await reader.cancel(); throw new Error("Environment response is too large") }
      chunks.push(chunk.value)
    }
    const body = Buffer.concat(chunks).toString("utf8")
    return { status: response.status, body, contentType: response.headers.get("content-type") ?? "application/json" }
  }
  const mutate = <A>(id: string, operation: () => Promise<A>) => Flock.withLock(file(id), operation, {
    dir: `${file(id)}.lock`, timeoutMs: 2_000,
  })
  const idle = async (saved: Saved) => {
    const api = OpenCode.make({ baseUrl: await endpoint(saved.info), headers: { authorization: `Basic ${btoa(`opencode:${await password(saved)}`)}` } })
    const active = await api.session.active({ signal: AbortSignal.timeout(10_000) })
    if (Object.keys(active).length) throw new Error("Wait for active sessions to finish before stopping this environment")
  }
  const waitReady = async (saved: Saved) => {
    const until = Date.now() + 60_000
    while (true) {
      const ready = await call(saved, { method: "GET", path: "/api/info" }).then((response) => response.status === 200, () => false)
      if (ready) return
      if (Date.now() > until) throw new Error("Worker server did not become ready")
      await Bun.sleep(500)
    }
  }
  const containerExists = async (id: string) => (await docker(["ps", "--all", "--filter", `name=^${name(id)}$`, "--format", "{{.Names}}"])).split("\n").includes(name(id))
  return {
    async list() {
      const availability = await engine().then((value) => ({ available: true, engine: value }), () => ({ available: false, engine: "unavailable" }))
      const entries = await readdir(owned)
      const environments = await Promise.all(entries.filter((entry) => /^[a-zA-Z0-9_-]+\.json$/.test(entry)).map(async (entry) => {
        const saved = await read(entry.slice(0, -5))
        if (saved.info.state === "preparing" && !jobs.has(saved.info.id)) return { ...saved.info, state: "reconcile" as const }
        if (availability.available && saved.info.state === "ready") {
          const running = await inspect(saved.info).then((value) => value.running, () => false)
          if (!running) return { ...saved.info, state: "reconcile" as const }
        }
        return saved.info
      }))
      return { ...availability, environments }
    },
    async build(version) {
      if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version")
      await engine()
      const image = `redcode-worker:${version}`
      await docker(["build", "--quiet", "--tag", image, "-"], workerDockerfile(version), 600_000)
      return { image }
    },
    create: (input) => mutate(input.id, async () => {
      await engine()
      const repository = publicRepository(input.repository)
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(input.ref) || input.ref.includes("..")) throw new Error("Invalid Git ref")
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(input.image)) throw new Error("Invalid container image")
      if (await Bun.file(file(input.id)).exists()) throw new Error("Environment already exists; inspect or restore it")
      const imageID = await docker(["image", "inspect", "--format", "{{.Id}}", input.image])
      if (!/^sha256:[a-f0-9]{64}$/.test(imageID)) throw new Error("Build or pull the approved image before preparing this workspace")
      if ((await docker(["image", "inspect", "--format", '{{index .Config.Labels "redcode.worker.protocol"}}', imageID])) !== "1")
        throw new Error("Build an approved worker image with the managed gateway protocol")
      const stored = await Effect.runPromise(credentials.create({
        integrationID: Integration.ID.make(`redcode-environment:${input.id}`), value: { type: "key", key: randomUUID() }, activate: false,
      }))
      const port = await new Promise<number>((resolve, reject) => {
        const socket = createServer()
        socket.once("error", reject)
        socket.listen(0, "127.0.0.1", () => {
          const address = socket.address()
          if (!address || typeof address === "string") { socket.close(); reject(new Error("Could not reserve a local gateway port")); return }
          socket.close((error) => error ? reject(error) : resolve(address.port))
        })
      })
      const state: { info: WorkerEnvironment.Info; credentialID: string; port: number } = {
        info: { id: input.id, repository, ref: input.ref, image: input.image, imageID, cpu: input.cpu, memoryMiB: input.memoryMiB,
          directory: "/workspace/project", state: "preparing", phase: "container", createdAt: new Date().toISOString() }, credentialID: stored.id, port,
      }
      await save(state)
      jobs.add(input.id)
      const phase = async (value: WorkerEnvironment.Info["phase"]) => { state.info = { ...state.info, phase: value }; await save(state) }
      try {
        await createContainer(state)
        await phase("clone")
        await docker(["exec", name(input.id), "git", "-c", "credential.helper=", "clone", "--no-checkout", "--", repository, "/workspace/repository"], undefined, 300_000)
        await phase("checkout")
        await docker(["exec", name(input.id), "git", "-C", "/workspace/repository", "-c", "credential.helper=", "fetch", "--no-tags", "origin", input.ref], undefined, 300_000)
        const commit = await docker(["exec", name(input.id), "git", "-C", "/workspace/repository", "rev-parse", "--verify", "FETCH_HEAD^{commit}"])
        if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Git did not resolve a commit")
        await docker(["exec", name(input.id), "git", "-C", "/workspace/repository", "worktree", "add", "--detach", "/workspace/project", commit])
        state.info = { ...state.info, commit }
        await phase("setup")
        if (input.setup?.trim()) await docker(["exec", "--workdir", "/workspace/project", "-i", name(input.id), "sh", "-s"], input.setup, 300_000)
        await phase("server")
        await waitReady(state)
        if (input.provider) {
          const response = await fetch(`${await endpoint(state.info)}/api/credential`, {
            method: "POST", headers: { authorization: `Basic ${btoa(`opencode:${await password(state)}`)}`, "content-type": "application/json" },
            body: JSON.stringify({ integrationID: input.provider.integrationID, value: { type: "key", key: input.provider.key } }),
            redirect: "error", signal: AbortSignal.timeout(10_000),
          })
          if (!response.ok) throw new Error("Could not configure the workspace provider credential")
          await response.body?.cancel()
        }
        state.info = { ...state.info, state: "ready", phase: "complete" }
        await save(state)
      } catch {
        await docker(["stop", "--time", "10", name(input.id)]).catch(() => undefined)
        await docker(["stop", "--time", "10", `${name(input.id)}-gateway`]).catch(() => undefined)
        state.info = { ...state.info, state: "failed", error: `Preparation failed during ${state.info.phase}; inspect this environment before retrying` }
        await save(state)
      } finally { jobs.delete(input.id) }
      return state.info
    }),
    start: (id) => mutate(id, async () => {
      const saved = await read(id)
      if (saved.info.phase !== "complete") throw new Error("Incomplete preparation needs reconciliation; it is not automatically replayed")
      jobs.add(id)
      await save({ ...saved, info: { ...saved.info, state: "preparing" } })
      try {
        if (!(await containerExists(id))) await createContainer(saved)
        else { await inspect(saved.info); await inspect(saved.info, true); await docker(["start", `${name(id)}-gateway`, name(id)]) }
        await waitReady(saved)
        const info = { ...saved.info, state: "ready" as const }
        await save({ ...saved, info })
        return info
      } catch (error) {
        await save({ ...saved, info: { ...saved.info, state: "reconcile" } })
        throw error
      } finally { jobs.delete(id) }
    }),
    stop: (id) => mutate(id, async () => {
      const saved = await read(id)
      if (await containerExists(id)) {
        const inspected = await inspect(saved.info)
        if (inspected.running && saved.info.phase === "complete") await idle(saved)
        await docker(["stop", "--time", "10", name(id)])
      }
      if ((await docker(["ps", "--all", "--filter", `name=^${name(id)}-gateway$`, "--format", "{{.Names}}"])).split("\n").includes(`${name(id)}-gateway`)) {
        await inspect(saved.info, true)
        await docker(["stop", "--time", "10", `${name(id)}-gateway`])
      }
      const info = { ...saved.info, state: "stopped" as const }
      await save({ ...saved, info })
      return info
    }),
    remove: (id, purge) => mutate(id, async () => {
      const saved = await read(id)
      if (await containerExists(id)) {
        const inspected = await inspect(saved.info)
        if (inspected.running) throw new Error("Stop this environment before removing it")
        await docker(["rm", name(id)])
      }
      if ((await docker(["ps", "--all", "--filter", `name=^${name(id)}-gateway$`, "--format", "{{.Names}}"])).split("\n").includes(`${name(id)}-gateway`)) {
        const inspected = await inspect(saved.info, true)
        if (inspected.running) throw new Error("Stop this environment's gateway before removing it")
        await docker(["rm", `${name(id)}-gateway`])
      }
      if (!purge) { await save({ ...saved, info: { ...saved.info, state: "archived" } }); return }
      for (const volume of [`${name(id)}-workspace`, `${name(id)}-home`]) {
        const exists = (await docker(["volume", "ls", "--filter", `name=^${volume}$`, "--format", "{{.Name}}"])).split("\n").includes(volume)
        if (!exists) continue
        if ((await docker(["volume", "inspect", "--format", '{{index .Labels "redcode.owner"}}', volume])) !== owner)
          throw new Error("Volume belongs to another runtime")
        await docker(["volume", "rm", volume])
      }
      for (const network of [`${name(id)}-network`, `${name(id)}-egress`]) {
        if (await docker(["network", "ls", "--filter", `name=^${network}$`, "--format", "{{.ID}}"])) {
          if ((await docker(["network", "inspect", "--format", '{{index .Labels "redcode.owner"}}', network])) !== owner)
            throw new Error("Network belongs to another runtime")
          await docker(["network", "rm", network])
        }
      }
      await Effect.runPromise(credentials.remove(Credential.ID.make(saved.credentialID)))
      await rm(file(id))
    }),
    request: (id, input) => mutate(id, async () => {
      const saved = await read(id)
      if (saved.info.state !== "ready") throw new Error("Environment is not ready")
      return call(saved, input)
    }),
    async connection(id) {
      const saved = await read(id)
      if (saved.info.state !== "ready") throw new Error("Environment is not ready")
      return { url: await endpoint(saved.info), password: await password(saved) }
    },
  }
}

function workerDockerfile(version: string) {
  return `FROM oven/bun:1.4.2-debian
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates ripgrep bash && rm -rf /var/lib/apt/lists/*
RUN set -eu; arch="$(uname -m)"; case "$arch" in x86_64) target=linux-x64-baseline;; aarch64) target=linux-arm64;; *) exit 1;; esac; \\
    mkdir /release; cd /release; curl -fsSLO https://github.com/reddb-io/redcode/releases/download/v${version}/SHA256SUMS; \\
    curl -fsSLO "https://github.com/reddb-io/redcode/releases/download/v${version}/redcode-server-$target.tar.gz"; \\
    grep "  redcode-server-$target.tar.gz$" SHA256SUMS | sha256sum -c -; \\
    tar -xzf "redcode-server-$target.tar.gz"; install -m 755 redcode /usr/local/bin/redcode; rm -rf /release
RUN mkdir -p /workspace /home/worker && chown -R 1000:1000 /workspace /home/worker
RUN mkdir -p /usr/local/lib && printf '%s' '${Buffer.from(WorkerEnvironmentProxy.script).toString("base64")}' | base64 -d > /usr/local/lib/worker-proxy.cjs
LABEL redcode.worker.protocol="1"
ENV HOME=/home/worker
USER 1000:1000
WORKDIR /workspace
EXPOSE 4096
ENTRYPOINT ["/usr/local/bin/redcode"]
`
}

export const configured = (directory?: string) => makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, Effect.gen(function* () {
    if (typeof Bun === "undefined") return yield* Service.pipe(Effect.provide(unavailableLayer))
    const global = yield* Global.Service
    const credential = yield* Credential.Service
    return yield* Effect.promise(() => createWorkerEnvironments(directory ?? path.join(global.state, "worker-environments"), credential))
  })),
  deps: [Global.node, Credential.node],
})
export const node = configured()
