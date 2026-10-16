// Real Compose/HTTP/CLI acceptance; creates and removes only its temporary development stacks.
import assert from "node:assert/strict"
import path from "node:path"
import { rename } from "node:fs/promises"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { AbsolutePath } from "@opencode/schema/schema"
import { ProjectEnvironment } from "@opencode/schema/project-environment"
import { OpenCode } from "@opencode/client/promise"
import { Global } from "@opencode/util/global"
import { ServerFetch } from "../src/fetch"
import { tmpdir } from "../../core/test/fixture/tmpdir"

const main = Effect.gen(function* () {
  const temporary = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("redcode-recipes-")))
  const root = temporary.path
  const handler = yield* ServerFetch.make(
    {
      password: "recipe-lab-only",
      database: { path: path.join(root, "host.db") },
      workers: { directory: path.join(root, "workers") },
      config: { directory: path.join(root, "config"), global: false, project: false },
      models: { fetch: false },
      fs: { filewatcher: false, fff: false },
    },
    {
      overrides: [
        Global.node.replace(
          Global.layerWith({
            data: path.join(root, "data"),
            state: path.join(root, "state"),
            config: path.join(root, "config"),
            cache: path.join(root, "cache"),
            tmp: path.join(root, "tmp"),
          }),
        ),
      ],
    },
  )
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
  yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
  const api = OpenCode.make({
    baseUrl: server.url.origin,
    headers: { authorization: `Basic ${btoa("opencode:recipe-lab-only")}` },
  })
  yield* Effect.promise(async () => {
    const checks: string[] = []
    const check = (value: unknown, label: string) => {
      assert(value, label)
      checks.push(label)
    }
    const exec = async (argv: string[], cwd = root, env?: Record<string, string | undefined>) => {
      const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", env: env ?? process.env })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      assert.equal(code, 0, `${argv[0]} ${argv[1]} failed: ${stderr}`)
      return stdout.trim()
    }
    const first = AbsolutePath.make(path.join(root, "first"))
    const second = AbsolutePath.make(path.join(root, "second"))
    await exec(["git", "init", first])
    const script =
      "const fs = require('node:fs'); if(!fs.existsSync('/data/marker')) fs.writeFileSync('/data/marker','retained'); Bun.serve({port:3001,fetch:()=>new Response(fs.readFileSync('/data/marker','utf8'))});"
    await Bun.write(
      path.join(first, "compose.json"),
      JSON.stringify({
        services: Object.fromEntries(
          Array.from({ length: 5 }, (_, index) => [
            `service-${index}`,
            {
              image: "oven/bun:1.4.2-debian",
              pull_policy: "never",
              user: "0:0",
              command: ["bun", "-e", script],
              mem_limit: "128m",
              cpus: 0.25,
              ports: ["127.0.0.1::3001"],
              volumes: ["data:/data"],
            },
          ]),
        ),
        volumes: { data: {} },
      }),
    )
    await exec(["git", "add", "."], first)
    await exec(
      ["git", "-c", "user.name=Recipe acceptance", "-c", "user.email=recipe@example.test", "commit", "-m", "fixture"],
      first,
    )
    await exec(["git", "worktree", "add", "--detach", second], first)
    const validationFile = path.join(root, "validate.mjs")
    await Bun.write(
      validationFile,
      `const p = Bun.spawn(['docker','ps','--filter','label=com.docker.compose.project='+process.env.COMPOSE_PROJECT_NAME,'--format','{{.ID}}'],{stdout:'pipe'});
const ids=(await new Response(p.stdout).text()).trim().split(/\\s+/); if(await p.exited || ids.length!==5) throw new Error('Expected five running services');
for(const id of ids){ const d=Bun.spawn(['docker','inspect','--format','{{json .NetworkSettings.Ports}}',id],{stdout:'pipe'}); const ports=JSON.parse(await new Response(d.stdout).text()); if(await d.exited)throw new Error('inspect failed');const port=ports['3001/tcp'][0].HostPort;const response=await fetch('http://127.0.0.1:'+port);if(await response.text()!=='retained')throw new Error('service failed');}console.log('All five services passed HTTP validation');`,
    )
    const quote = (value: string) =>
      process.platform === "win32" ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`
    const validate = `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} ${quote(validationFile)}`
    const recipe: ProjectEnvironment.Definition = {
      id: "dev",
      name: "Five-service development",
      backend: "compose",
      composeFile: "compose.json",
      prepare: "",
      start: "",
      stop: "",
      validate,
      timeoutSeconds: 60,
      secrets: {},
    }
    await api.projectEnvironments.save({ directory: first, expectedRevision: 0, definition: recipe })
    check(
      (await api.projectEnvironments.list({ directory: second })).recipes.length === 1,
      "recipe shared with linked worktree",
    )
    const operations: ProjectEnvironment.Info[] = []
    const wait = async (operation: ProjectEnvironment.Info) => {
      const deadline = Date.now() + 90_000
      while (Date.now() < deadline) {
        const info = (await api.projectEnvironments.list({ directory: operation.directory })).environments.find(
          (item) => item.id === operation.id,
        )
        if (info && info.state !== "working") {
          assert.notEqual(info.state, "failed", info.detail + "\n" + info.output)
          return info
        }
        await Bun.sleep(250)
      }
      throw new Error("Environment operation timed out")
    }
    const run = async (directory: AbsolutePath, action: ProjectEnvironment.Action) => {
      const operation = await api.projectEnvironments.run({
        directory,
        recipeID: "dev",
        revision: 1,
        action,
        requestID: crypto.randomUUID(),
      })
      operations.push(operation)
      return wait(operation)
    }
    const cli = (args: string[]) =>
      exec(
        [
          process.execPath,
          path.resolve(import.meta.dir, "../../cli/src/index.ts"),
          "environments",
          ...args,
          "--server",
          server.url.origin,
          "--directory",
          first,
        ],
        path.resolve(import.meta.dir, "../../cli"),
        {
          ...process.env,
          OPENCODE_PASSWORD: "recipe-lab-only",
          OPENCODE_TEST_HOME: path.join(root, "cli-home"),
          REDCODE_TEST_HOME: path.join(root, "cli-home"),
        },
      )
    try {
      const listed = JSON.parse(await cli(["list"]))
      check(listed.recipes[0].id === "dev", "CLI reads the same HTTP recipe")
      const saved = JSON.parse(
        await cli([
          "save",
          "cli-check",
          "--name",
          "CLI lifecycle",
          "--backend",
          "commands",
          "--start",
          "echo started",
          "--stop",
          "echo stopped",
          "--validate",
          "echo checked",
        ]),
      )
      check(saved.revision === 1, "CLI saves a recipe through the host API")
      const cliRun = JSON.parse(await cli(["run", "cli-check", "start", "--revision", "1", "--yes"]))
      check(
        cliRun.state === "ready" && cliRun.output.includes("checked"),
        "CLI waits for a real native command lifecycle",
      )
      await cli(["run", "cli-check", "stop", "--revision", "1", "--yes"])
      const a = await run(first, "start")
      const b = await run(second, "start")
      check(a.state === "ready" && b.state === "ready", "two real five-container stacks pass HTTP validation")
      check(a.composeProject !== b.composeProject, "worktrees use different Compose project names")
      await rename(path.join(first, "compose.json"), path.join(first, "compose.json.bak"))
      try {
        check(
          JSON.parse(await cli(["run", "dev", "stop", "--revision", "1", "--yes"])).state === "stopped",
          "CLI stops its owned stack even when its Compose file is missing",
        )
      } finally {
        await rename(path.join(first, "compose.json.bak"), path.join(first, "compose.json"))
      }
      check((await run(second, "validate")).state === "ready", "stopping one stack leaves the other stack working")
      check(
        (await run(second, "recreate")).state === "ready",
        "recreation preserves volume data and validates services",
      )
      const raw = await fetch(`${server.url.origin}/api/project-environments?directory=${encodeURIComponent(first)}`)
      check(raw.status === 401, "HTTP operations require the host credential")
      const report = { passed: true, checks, count: checks.length, modelCalls: 0, environments: [a, b] }
      if (process.argv[2]) await Bun.write(path.resolve(process.argv[2]), JSON.stringify(report, null, 2))
      console.log(`Project environment acceptance passed: ${checks.length} checks; zero inference calls`)
    } finally {
      for (const directory of [first, second]) await run(directory, "stop").catch(() => undefined)
      for (const operation of operations.filter(
        (item, index, all) => all.findIndex((other) => other.composeProject === item.composeProject) === index,
      ))
        await exec([
          "docker",
          "compose",
          "--project-name",
          operation.composeProject,
          "--file",
          path.join(operation.directory, "compose.json"),
          "down",
          "--volumes",
          "--remove-orphans",
        ]).catch(() => undefined)
    }
  })
})
NodeRuntime.runMain(main.pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
