// Optional real Docker acceptance. Run from packages/server; it never uses a live user server.
import assert from "node:assert/strict"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { OpenCode } from "@opencode/client/promise"
import { Global } from "@opencode/util/global"
import { ServerFetch } from "../src/fetch"
import { tmpdir } from "../../core/test/fixture/tmpdir"

const main = Effect.gen(function* () {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("redcode-isolation-")))
  const handler = yield* ServerFetch.make({
    password: "acceptance-host-only", database: { path: path.join(tmp.path, "host.db") },
    workers: { directory: path.join(tmp.path, "workers") },
    config: { directory: path.join(tmp.path, "config"), global: false, project: false },
    models: { fetch: false }, fs: { filewatcher: false, fff: false },
  }, { overrides: [Global.node.replace(Global.layerWith({
    data: path.join(tmp.path, "data"), state: path.join(tmp.path, "state"), config: path.join(tmp.path, "config"),
    cache: path.join(tmp.path, "cache"), tmp: path.join(tmp.path, "tmp"),
  }))] })
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
  yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
  const api = OpenCode.make({ baseUrl: server.url.origin, headers: { authorization: `Basic ${btoa("opencode:acceptance-host-only")}` } })
  yield* Effect.promise(async () => {
    const suffix = randomUUID().slice(0, 8)
    const ids = [`acceptance-a-${suffix}`, `acceptance-b-${suffix}`]
    const checks: string[] = []
    const check = (condition: unknown, label: string) => { assert(condition, label); checks.push(label) }
    const docker = async (args: string[]) => {
      const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "ignore" })
      const [code, text] = await Promise.all([child.exited, new Response(child.stdout).text()])
      return { code, text: text.trim() }
    }
    const container = async (id: string) => {
      const value = await docker(["ps", "--all", "--filter", "label=redcode.kind=workspace", "--format", "{{.Names}}"])
      const found = value.text.split("\n").find((name) => name.endsWith(`-${id}`))
      assert(found, `missing owned container ${id}`)
      return found
    }
    try {
      const status = await api.workerEnvironments.list()
      check(status.available, "local Linux Docker engine available")
      const image = await api.workerEnvironments.build({ version: "0.80.0" })
      check(image.image === "redcode-worker:0.80.0", "published server image built and checksum verified")
      const inputs = ids.map((id, index) => ({ id, repository: "https://github.com/octocat/Hello-World.git", ref: "HEAD", image: image.image,
        cpu: 0.5, memoryMiB: 512, setup: `printf 'workspace-${index}' > prepared.txt`,
        ...(index === 0 ? { provider: { integrationID: "anthropic", key: "acceptance-environment-key" } } : {}) }))
      for (const input of inputs) {
        const info = await api.workerEnvironments.create(input)
        check(info.state === "ready", `${input.id}: cloned, checked out and ready`)
        check(!!info.commit && /^[a-f0-9]{40}$/.test(info.commit), `${input.id}: resolved base commit recorded`)
        const process = await container(input.id)
        check((await docker(["exec", process, "id", "-u"])).text === "1000", `${input.id}: process is non-root`)
        check((await docker(["exec", process, "cat", "/sys/fs/cgroup/memory.max"])).text === "536870912", `${input.id}: 512 MiB enforced by cgroup`)
        check((await docker(["exec", process, "sh", "-c", "test ! -S /var/run/docker.sock && test ! -e /host && test ! -e /redcode"])).code === 0, `${input.id}: no host project or Docker socket`)
        check((await docker(["exec", process, "sh", "-c", "touch /etc/redcode-acceptance-must-not-write"])).code !== 0, `${input.id}: system filesystem is read-only`)
        check((await docker(["exec", process, "curl", "--noproxy", "*", "--connect-timeout", "2", "--max-time", "3", "https://example.com"])).code !== 0, `${input.id}: direct outbound connection blocked`)
        check((await docker(["exec", process, "curl", "--noproxy", "", "--silent", "--output", "/dev/null", "--write-out", "%{http_connect}", "--connect-timeout", "2", "--max-time", "3", "https://169.254.169.254"])).text === "403", `${input.id}: cloud metadata rejected with 403`)
        check((await docker(["exec", process, "curl", "--noproxy", "", "--silent", "--output", "/dev/null", "--write-out", "%{http_connect}", "--connect-timeout", "2", "--max-time", "3", "https://127.0.0.1"])).text === "403", `${input.id}: loopback target rejected with 403`)
        check((await docker(["exec", process, "bun", "-e", "const response=await fetch('https://example.com');process.exit(response.ok?0:1)"])).code === 0, `${input.id}: Bun provider transport can use public HTTPS proxy`)
      }
      const first = await container(ids[0])
      const second = await container(ids[1])
      const secondIP = await docker(["inspect", "--format", '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', second])
      check((await docker(["exec", first, "curl", "--noproxy", "*", "--connect-timeout", "2", "--max-time", "3", `http://${secondIP.text}:4096/api/info`])).code !== 0, "worker cannot reach another workspace network")
      check((await docker(["exec", first, "sh", "-c", "printf private > /home/worker/private-marker"])).code === 0, "first workspace has writable private home")
      check((await docker(["exec", second, "sh", "-c", "test ! -e /home/worker/private-marker"])).code === 0, "second workspace cannot see first workspace home")
      check((await docker(["exec", second, "cat", "/workspace/project/prepared.txt"])).text === "workspace-1", "preparation commands target the correct checkout")
      const listed = await api.workerEnvironments.list()
      check(!JSON.stringify(listed).includes("acceptance-environment-key"), "environment inventory excludes credentials")
      const direct = await api.workerEnvironments.register({ id: ids[0] })
      check(direct.worker.environmentID === ids[0] && direct.connection === "online", "isolated worker registered without returning password")
      await assert.rejects(api.workerEnvironments.stop({ id: ids[0] }))
      checks.push("registered worker cannot be stopped")
      const proxy = await api.workers.add({ id: ids[1], url: server.url.origin, password: "acceptance-host-only", directories: ["/workspace/project"],
        tags: ["isolated"], environmentID: ids[1], environmentProxy: true })
      check(proxy.connection === "online", "remote coordinator proxy reaches the correct container")
      const session = await api.workerEnvironments.request({ id: ids[0], method: "POST", path: "/api/session",
        body: JSON.stringify({ id: `ses_isolation_${suffix}`, title: "Isolated workspace admission", location: { directory: "/workspace/project" } }) })
      check(session.status === 200, "native Session creation works through the managed HTTP proxy")
      const admitted = JSON.parse(session.body)
      check(admitted.data.location.directory === "/workspace/project", "native Session remains in the prepared worktree")
      const resources = await api.workers.resources({ id: ids[1] })
      check(resources.memory.totalBytes === 536870912, "proxy resource sampling retains enforced memory limit")
      await assert.rejects(api.workerEnvironments.request({ id: ids[0], method: "GET", path: "/api/credential" }))
      checks.push("proxy cannot export worker credentials")
      await assert.rejects(api.workerEnvironments.request({ id: ids[0], method: "GET", path: "http://127.0.0.1/api/info" }))
      checks.push("proxy refuses arbitrary destinations")
      await api.workers.remove({ id: ids[0] })
      await api.workerEnvironments.stop({ id: ids[0] })
      await api.workerEnvironments.remove({ id: ids[0], purge: false })
      check((await api.workerEnvironments.list()).environments.find((info) => info.id === ids[0])?.state === "archived", "archive retains durable environment record")
      await api.workerEnvironments.start({ id: ids[0] })
      check((await docker(["exec", await container(ids[0]), "cat", "/home/worker/private-marker"])).text === "private", "restore retains private home")
      check((await docker(["exec", await container(ids[0]), "cat", "/workspace/project/prepared.txt"])).text === "workspace-0", "restore retains checkout and preparation")
      const restored = await api.workerEnvironments.register({ id: ids[0] })
      check(restored.worker.url === direct.worker.url, "restored environment keeps its original coordinator endpoint")
      await api.workers.remove({ id: ids[0] })
      const output = process.argv[2]
      if (output) await Bun.write(path.resolve(output), JSON.stringify({ checks, count: checks.length, passed: true, modelCalls: 0, environments: listed.environments }, null, 2))
      process.stdout.write(`Worker environment acceptance passed: ${checks.length} checks, zero inference calls\n`)
    } finally {
      for (const id of ids) {
        await api.workers.remove({ id }).catch(() => undefined)
        await api.workerEnvironments.stop({ id }).catch(() => undefined)
        await api.workerEnvironments.remove({ id, purge: true }).catch(() => undefined)
      }
    }
  })
})
NodeRuntime.runMain(main.pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
