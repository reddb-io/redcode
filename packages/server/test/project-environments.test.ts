import { expect } from "bun:test"
import { Effect } from "effect"
import { ProjectEnvironment } from "@opencode/schema/project-environment"
import { AbsolutePath } from "@opencode/schema/schema"
import { ProjectEnvironments } from "../src/project-environments"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { ExecutionOwner } from "@opencode/core/execution-owner"
import { Database } from "@opencode/core/database/database"
import { Vault } from "@opencode/core/vault/vault"
import { Project } from "@opencode/core/project"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"

const quoted = (value: string) =>
  process.platform === "win32" ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`
const command = (file: string, action: string) =>
  `${process.platform === "win32" ? "& " : ""}${quoted(process.execPath)} ${quoted(file)} ${action}`
// Hosted Windows runners can spend more than ten seconds starting a cold PowerShell.
// The dedicated timeout recipe below still uses one second to verify cancellation.
const timeoutSeconds = process.platform === "win32" ? 30 : 10

it.live(
  "environment recipes share project identity, preserve execution directories and redact real command results",
  () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const repository = path.join(temporary.path, "repository")
      const worktree = path.join(temporary.path, "worktree")
      const storage = path.join(temporary.path, "recipes")
      yield* Effect.promise(() => mkdir(repository))
      const git = (args: string[]) =>
        Effect.promise(async () => {
          const child = Bun.spawn(["git", "-C", repository, ...args], { stdout: "pipe", stderr: "pipe" })
          const detail = await new Response(child.stderr).text()
          expect(await child.exited, detail).toBe(0)
        })
      yield* git(["init"])
      yield* git([
        "-c",
        "user.name=Environment test",
        "-c",
        "user.email=environment@example.test",
        "commit",
        "--allow-empty",
        "-m",
        "fixture",
      ])
      yield* git(["worktree", "add", "--detach", worktree])
      const runner = path.join(temporary.path, "runner.cjs")
      yield* Effect.promise(() =>
        Bun.write(
          runner,
          `const fs = require('node:fs');
const action = process.argv[2];
if (action === 'prepare') fs.writeFileSync('prepare-count', String(Number(fs.existsSync('prepare-count') ? fs.readFileSync('prepare-count','utf8') : '0') + 1));
if (action === 'start') fs.writeFileSync('started', process.env.REDCODE_WORKTREE);
if (action === 'stop') fs.rmSync('started', {force:true});
if (action === 'validate' && !fs.existsSync('started')) process.exit(7);
if (action === 'slow') await new Promise(r => setTimeout(r, 150));
if (action === 'hold') { fs.writeFileSync('hold-ready','ready'); while(!fs.existsSync('release')) await new Promise(r=>setTimeout(r,10)); }
console.log(action + ':' + process.cwd());
if (process.env.FIXTURE_TOKEN) console.log(process.env.FIXTURE_TOKEN);
`,
        ),
      )
      yield* Effect.gen(function* () {
        const service = yield* ProjectEnvironments.Service
        const vault = yield* Vault.Service
        const project = yield* Project.Service
        const processes = yield* AppProcess.Service
        const directory = AbsolutePath.make(repository)
        const second = AbsolutePath.make(worktree)
        const resolved = yield* project.resolve(directory)
        yield* vault.attach({ projectID: resolved.id, directory: resolved.canonical })
        const secret = "environment-secret-value-without-provider-prefix"
        yield* vault.set({ projectID: resolved.id, name: "fixture-token", value: secret, origin: "user" })
        const definition: ProjectEnvironment.Definition = {
          id: "dev",
          name: "Development",
          backend: "commands",
          composeFile: "compose.yaml",
          prepare: command(runner, "prepare"),
          start: command(runner, "start"),
          stop: command(runner, "stop"),
          validate: command(runner, "validate"),
          timeoutSeconds,
          secrets: { FIXTURE_TOKEN: "fixture-token" },
        }
        const recipe = yield* Effect.promise(() => service.save({ directory, definition, expectedRevision: 0 }))
        const other = yield* Effect.promise(() => service.list(second))
        expect(other.recipes).toHaveLength(1)
        expect(other.recipes[0].revision).toBe(recipe.revision)
        const wait = (id: string) =>
          Effect.gen(function* () {
            const until = Date.now() + (timeoutSeconds + 5) * 1000
            while (Date.now() < until) {
              // Concurrent clients can poll while an operation replaces its durable result.
              const snapshots = yield* Effect.promise(() =>
                Promise.all(Array.from({ length: 8 }, () => service.list(directory))),
              )
              const result = snapshots.at(-1)!.environments.find((item) => item.id === id)
              if (result && result.state !== "working") return result
              yield* Effect.sleep("10 millis")
            }
            return yield* Effect.die(new Error("Environment did not settle"))
          })
        const started = yield* Effect.promise(() =>
          service.run({ directory, recipeID: "dev", revision: 1, action: "start", requestID: "first" }),
        )
        const settled = yield* wait(started.id)
        expect(settled.state, settled.detail).toBe("ready")
        expect(settled.output).toContain("prepare:")
        expect(settled.output).toContain(repository)
        expect(settled.output).not.toContain(secret)
        expect(yield* Effect.promise(() => Bun.file(path.join(repository, "started")).text())).toBe(repository)
        expect(yield* Effect.promise(() => Bun.file(path.join(worktree, "started")).exists())).toBe(false)
        const alreadyReady = yield* Effect.promise(() =>
          service.run({ directory, recipeID: "dev", revision: 1, action: "start", requestID: "already-ready" }),
        )
        const restarted = yield* wait(alreadyReady.id)
        expect(restarted.state, restarted.detail).toBe("ready")
        const firstReceipt = yield* Effect.promise(() =>
          service.run({ directory, recipeID: "dev", revision: 1, action: "start", requestID: "first" }),
        )
        expect(alreadyReady.id).toBe(started.id)
        expect(
          yield* Effect.promise(() => Bun.file(path.join(repository, "prepare-count")).text()),
          JSON.stringify({ settled, firstReceipt, restarted }),
        ).toBe("1")
        const snapshot = yield* Effect.promise(() => service.list(second))
        expect(snapshot.recipes[0].validatedRevision).toBe(1)
        expect(snapshot.environments[0].directory).toBe(directory)
        expect(
          (yield* Effect.promise(() =>
            service.run({ directory, recipeID: "dev", revision: 1, action: "start", requestID: "first" }),
          )).state,
        ).toBe("ready")
        const blocked = yield* Effect.exit(
          Effect.promise(() => service.save({ directory, definition, expectedRevision: 1 })),
        )
        expect(blocked._tag).toBe("Failure")
        const stopped = yield* Effect.promise(() =>
          service.run({ directory, recipeID: "dev", revision: 1, action: "stop", requestID: "stop" }),
        )
        expect((yield* wait(stopped.id)).state).toBe("stopped")
        expect(yield* Effect.promise(() => Bun.file(path.join(repository, "started")).exists())).toBe(false)
        const retried = yield* Effect.promise(() =>
          service.run({ directory, recipeID: "dev", revision: 1, action: "start", requestID: "first" }),
        )
        expect(retried.state).toBe("ready")
        expect(yield* Effect.promise(() => Bun.file(path.join(repository, "started")).exists())).toBe(false)
        expect(
          (yield* Effect.promise(() => service.save({ directory: second, definition, expectedRevision: 1 }))).revision,
        ).toBe(2)
        const stale = yield* Effect.exit(
          Effect.promise(() =>
            service.run({ directory, recipeID: "dev", revision: 1, action: "start", requestID: "stale" }),
          ),
        )
        expect(stale._tag).toBe("Failure")
        const persisted = yield* Effect.promise(async () =>
          (
            await Promise.all(
              (await readdir(storage))
                .filter((file) => file.endsWith(".json"))
                .map((file) => Bun.file(path.join(storage, file)).text()),
            )
          ).join("\n"),
        )
        expect(persisted).not.toContain(secret)
        const holding = { ...definition, prepare: command(runner, "hold") }
        yield* Effect.promise(() => service.save({ directory, definition: holding, expectedRevision: 2 }))
        const owner = yield* ExecutionOwner.make
        const peer = yield* Effect.acquireRelease(
          Effect.promise(() =>
            ProjectEnvironments.createProjectEnvironments(storage, { project, vault, process: processes, owner }),
          ),
          (peer) => Effect.promise(() => peer.dispose()),
        )
        const held = yield* Effect.promise(() =>
          service.run({ directory, recipeID: "dev", revision: 3, action: "prepare", requestID: "held" }),
        )
        const waitForRunner = () =>
          Effect.gen(function* () {
            const deadline = Date.now() + 5000
            while (!(yield* Effect.promise(() => Bun.file(path.join(repository, "hold-ready")).exists()))) {
              if (Date.now() > deadline) return yield* Effect.die(new Error("Fixture command did not start"))
              yield* Effect.sleep("10 millis")
            }
          })
        yield* waitForRunner()
        expect(
          (yield* Effect.promise(() =>
            peer.run({ directory, recipeID: "dev", revision: 3, action: "prepare", requestID: "held" }),
          )).requestID,
        ).toBe("held")
        const competing = yield* Effect.exit(
          Effect.promise(() =>
            peer.run({ directory, recipeID: "dev", revision: 3, action: "prepare", requestID: "competitor" }),
          ),
        )
        expect(competing._tag).toBe("Failure")
        yield* vault.forget({ projectID: resolved.id, name: "fixture-token" })
        yield* Effect.promise(() => Bun.write(path.join(repository, "release"), "release"))
        const maskedAfterForget = yield* wait(held.id)
        expect(maskedAfterForget.state, maskedAfterForget.detail ?? maskedAfterForget.output).toBe("prepared")
        expect(maskedAfterForget.output).not.toContain(secret)
        yield* vault.set({ projectID: resolved.id, name: "fixture-token", value: secret, origin: "user" })
        yield* Effect.promise(() =>
          Promise.all([rm(path.join(repository, "release")), rm(path.join(repository, "hold-ready"))]),
        )
        const interrupted = yield* Effect.promise(() =>
          service.run({ directory, recipeID: "dev", revision: 3, action: "prepare", requestID: "interrupted" }),
        )
        yield* waitForRunner()
        yield* Effect.promise(() => service.dispose())
        expect((yield* wait(interrupted.id)).state).toBe("reconcile")
        const blockedRecovery = yield* Effect.exit(
          Effect.promise(() =>
            peer.run({ directory, recipeID: "dev", revision: 3, action: "reconcile", requestID: "unconfirmed" }),
          ),
        )
        expect(blockedRecovery._tag).toBe("Failure")
        const recovered = yield* Effect.promise(() =>
          peer.run({
            directory,
            recipeID: "dev",
            revision: 3,
            action: "reconcile",
            requestID: "confirmed",
            confirmReconciled: true,
          }),
        )
        expect((yield* wait(recovered.id)).state).toBe("reconciled")
        expect(yield* Effect.promise(() => Bun.file(path.join(repository, "release")).exists())).toBe(false)
        yield* Effect.promise(() =>
          peer.save({ directory, expectedRevision: 0, definition: { ...holding, id: "timeout", timeoutSeconds: 1 } }),
        )
        const timed = yield* Effect.promise(() =>
          peer.run({ directory, recipeID: "timeout", revision: 1, action: "prepare", requestID: "timeout" }),
        )
        const timedResult = yield* wait(timed.id)
        expect(timedResult.state).toBe("failed")
        expect(timedResult.detail).toContain("Timed out")
        yield* Effect.promise(() =>
          peer.save({
            directory,
            expectedRevision: 0,
            definition: { ...definition, id: "missing", secrets: { FIXTURE_TOKEN: "unavailable-secret" } },
          }),
        )
        const missing = yield* Effect.promise(() =>
          peer.run({ directory, recipeID: "missing", revision: 1, action: "start", requestID: "missing" }),
        )
        expect((yield* wait(missing.id)).state).toBe("failed")
        expect(yield* Effect.promise(() => Bun.file(path.join(repository, "started")).exists())).toBe(false)
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(LayerNode.group([ProjectEnvironments.node, Vault.node, Project.node, AppProcess.node]), [
            ProjectEnvironments.node.replace(ProjectEnvironments.configured(storage)),
            Database.node.replace(Database.configured({ path: ":memory:" })),
          ]),
        ),
      )
    }),
  timeoutSeconds * 3000,
)
