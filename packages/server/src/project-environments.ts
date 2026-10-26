export * as ProjectEnvironments from "./project-environments"

import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ProjectEnvironment } from "@opencode/schema/project-environment"
import { AbsolutePath, optional } from "@opencode/schema/schema"
import { Project } from "@opencode/core/project"
import { Vault } from "@opencode/core/vault/vault"
import { ExecutionOwner } from "@opencode/core/execution-owner"
import { AppProcess } from "@opencode/util/process"
import { Flock } from "@opencode/util/flock"
import { Global } from "@opencode/util/global"
import { Redact } from "@opencode/util/redact"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, realpath, rename } from "node:fs/promises"
import path from "node:path"

const Saved = Schema.Struct({ info: ProjectEnvironment.Info, owner: optional(ExecutionOwner.Info) })
type Saved = typeof Saved.Type
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24)

export interface Interface {
  list(directory: AbsolutePath): Promise<ProjectEnvironment.Snapshot>
  save(input: ProjectEnvironment.Save): Promise<ProjectEnvironment.Recipe>
  run(input: ProjectEnvironment.Run): Promise<ProjectEnvironment.Info>
  dispose(): Promise<void>
}
export class Service extends Context.Service<Service, Interface>()("@redcode/ProjectEnvironments") {}

export async function createProjectEnvironments(
  directory: string,
  dependencies: {
    project: Project.Interface
    vault: Vault.Interface
    process: AppProcess.Interface
    owner: ExecutionOwner.Info
  },
): Promise<Interface> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const root = await realpath(directory)
  const live = new Map<string, { abort: AbortController; done: Promise<void> }>()
  const lifetime = { closed: false }
  const scopes = new Map<
    string,
    { at: number; value: Promise<{ projectID: Project.ID; directory: AbsolutePath; prefix: string }> }
  >()
  const location = async (directory: AbsolutePath, fresh = false) => {
    const canonical = AbsolutePath.make(await realpath(directory))
    const cached = scopes.get(canonical)
    if (!fresh && cached && Date.now() - cached.at < 30_000) return cached.value
    const value = (async () => {
      const project = await Effect.runPromise(dependencies.project.resolve(canonical))
      const checkout = AbsolutePath.make(await realpath(project.directory))
      await Effect.runPromise(dependencies.vault.attach({ projectID: project.id, directory: project.canonical }))
      return { projectID: project.id, directory: checkout, prefix: hash(project.id) }
    })()
    if (scopes.size >= 128) scopes.delete(scopes.keys().next().value!)
    scopes.set(canonical, { at: Date.now(), value })
    return value.catch((error) => {
      if (scopes.get(canonical)?.value === value) scopes.delete(canonical)
      throw error
    })
  }
  const clean = async (projectID: Project.ID, text: string) =>
    Redact.redact(await Effect.runPromise(dependencies.vault.scrub(projectID, text)))
  const recipeFile = (prefix: string, id: string) => path.join(root, `${prefix}.recipe.${hash(id)}.json`)
  const instanceFile = (prefix: string, id: string) => path.join(root, `${prefix}.instance.${id}.json`)
  const readRecipe = async (prefix: string, id: string) => {
    const file = Bun.file(recipeFile(prefix, id))
    return (await file.exists()) ? Schema.decodeUnknownSync(ProjectEnvironment.Recipe)(await file.json()) : undefined
  }
  const write = async (file: string, value: unknown) => {
    const temporary = `${file}.${randomUUID()}.tmp`
    await Bun.write(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, file)
  }
  const lock = <A>(prefix: string, run: () => Promise<A>) =>
    Flock.withLock(path.join(root, prefix), run, {
      dir: path.join(root, `${prefix}.lock`),
      timeoutMs: 2_000,
    })
  const records = async (prefix: string) =>
    Promise.all(
      (await readdir(root))
        .filter((name) => name.startsWith(`${prefix}.instance.`) && name.endsWith(".json"))
        .map(async (name) => Schema.decodeUnknownSync(Saved)(await Bun.file(path.join(root, name)).json())),
    )
  const observed = (saved: Saved): ProjectEnvironment.Info =>
    saved.info.state === "working" && (!saved.owner || !ExecutionOwner.alive(saved.owner))
      ? {
          ...saved.info,
          state: "reconcile",
          detail: "The owning runtime stopped. Inspect the original commands before reconciling; work is not replayed.",
        }
      : saved.info

  const service: Interface = {
    async list(directory) {
      const scope = await location(directory)
      const recipes = await Promise.all(
        (await readdir(root))
          .filter((name) => name.startsWith(`${scope.prefix}.recipe.`) && name.endsWith(".json"))
          .map(async (name) =>
            Schema.decodeUnknownSync(ProjectEnvironment.Recipe)(await Bun.file(path.join(root, name)).json()),
          ),
      )
      const environments = await Promise.all(
        (await records(scope.prefix)).map(async (saved) => {
          const info = observed(saved)
          return {
            ...info,
            output: await clean(scope.projectID, info.output),
            ...(info.detail ? { detail: await clean(scope.projectID, info.detail) } : {}),
          }
        }),
      )
      return { directory: scope.directory, projectID: scope.projectID, recipes, environments }
    },
    async save(input) {
      const scope = await location(input.directory, true)
      return lock(scope.prefix, async () => {
        const previous = await readRecipe(scope.prefix, input.definition.id)
        if ((previous?.revision ?? 0) !== input.expectedRevision)
          throw new Error("Recipe changed. Reload before saving.")
        if (
          (await records(scope.prefix)).some(
            (saved) =>
              saved.info.recipeID === input.definition.id &&
              ["working", "ready", "reconcile", "reconciled"].includes(observed(saved).state),
          )
        )
          throw new Error("Stop this recipe's environments before editing it; reconcile interrupted operations first")
        if (!input.definition.validate.trim())
          throw new Error("Provide a validation command that proves this environment works")
        if (
          input.definition.backend === "commands" &&
          (!input.definition.start.trim() || !input.definition.stop.trim())
        )
          throw new Error("Command recipes require explicit start and stop commands")
        if (
          input.definition.backend === "compose" &&
          (path.isAbsolute(input.definition.composeFile) || input.definition.composeFile.split(/[\\/]/).includes(".."))
        )
          throw new Error("Choose a Compose file inside the selected worktree")
        if (
          Object.keys(input.definition.secrets).some((name) =>
            /^(COMPOSE_|DOCKER_|REDCODE_|PATH$|HOME$|USERPROFILE$|LD_|NODE_OPTIONS$|BUN_OPTIONS$)/i.test(name),
          )
        )
          throw new Error("Secret bindings cannot override runtime, Docker or Compose configuration")
        const serialized = JSON.stringify({ ...input.definition, secrets: {} })
        if (
          Redact.findSecrets(serialized).some((secret) => secret.confidence === "high") ||
          (await Effect.runPromise(dependencies.vault.scrub(scope.projectID, serialized))) !== serialized
        )
          throw new Error("Recipes must contain Vault names rather than secret values")
        const recipe: ProjectEnvironment.Recipe = {
          ...input.definition,
          projectID: scope.projectID,
          revision: (previous?.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        }
        await write(recipeFile(scope.prefix, recipe.id), recipe)
        return recipe
      })
    },
    async run(input) {
      if (lifetime.closed) throw new Error("Environment runtime is closing")
      const scope = await location(input.directory, true)
      const id = hash(`${scope.directory}\0${input.recipeID}`)
      return lock(scope.prefix, async () => {
        const receiptFile = path.join(root, `${scope.prefix}.request.${hash(input.requestID)}.json`)
        if (await Bun.file(receiptFile).exists()) {
          const receipt = Schema.decodeUnknownSync(Saved)(await Bun.file(receiptFile).json())
          if (
            receipt.info.directory !== scope.directory ||
            receipt.info.recipeID !== input.recipeID ||
            receipt.info.action !== input.action
          )
            throw new Error("This request ID belongs to another environment operation")
          return observed(receipt)
        }
        const recipe = await readRecipe(scope.prefix, input.recipeID)
        if (!recipe || recipe.revision !== input.revision)
          throw new Error("Recipe changed or is unavailable. Reload before running it.")
        const file = instanceFile(scope.prefix, id)
        const previous = (await Bun.file(file).exists())
          ? Schema.decodeUnknownSync(Saved)(await Bun.file(file).json())
          : undefined
        if (previous?.info.requestID === input.requestID) {
          if (previous.info.action !== input.action) throw new Error("This request ID belongs to another action")
          return observed(previous)
        }
        if (previous && observed(previous).state === "working")
          throw new Error("Another runtime is operating this environment")
        if (previous && observed(previous).state === "reconcile" && input.action !== "reconcile")
          throw new Error("Reconcile the interrupted operation before running another command")
        if (
          input.action === "reconcile" &&
          (!input.confirmReconciled || !previous || observed(previous).state !== "reconcile")
        )
          throw new Error("Confirm the original commands have stopped before reconciliation")
        if (input.action === "prepare" && previous && ["ready", "reconciled"].includes(previous.info.state))
          throw new Error("Stop the environment before preparing it again")
        const info: ProjectEnvironment.Info = {
          id,
          recipeID: recipe.id,
          projectID: scope.projectID,
          directory: scope.directory,
          composeProject: `redcode-${hash(`${root}\0${scope.directory}\0${recipe.id}`)}`,
          revision: recipe.revision,
          state: "working",
          action: input.action,
          requestID: input.requestID,
          output: "",
          updatedAt: new Date().toISOString(),
        }
        const persist = async (saved: Saved) => {
          await write(file, saved)
          await write(receiptFile, saved)
        }
        await persist({ info, owner: dependencies.owner })
        const abort = new AbortController()
        const execute = async () => {
          const state = { output: "" }
          const injected = new Map<string, string>()
          const scrub = (text: string) =>
            clean(
              scope.projectID,
              Array.from(injected)
                .sort(([a], [b]) => b.length - a.length)
                .reduce((value, [secret, name]) => value.replaceAll(secret, `{vault:${name}}`), text),
            )
          const environment: Record<string, string> = {
            ...(Object.fromEntries(
              Object.entries(process.env).filter(
                ([key, value]) =>
                  value !== undefined &&
                  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|PROGRAMFILES(?:\(x86\))?|PROGRAMDATA|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TMP|TEMP|TMPDIR|LANG|LC_ALL|DOCKER_CONFIG|DOCKER_CONTEXT)$/i.test(
                    key,
                  ),
              ),
            ) as Record<string, string>),
            REDCODE_ENVIRONMENT_ID: id,
            REDCODE_WORKTREE: scope.directory,
            COMPOSE_PROJECT_NAME: info.composeProject,
          }
          try {
            const inventoryOnly = recipe.backend === "compose" && ["stop", "reconcile"].includes(input.action)
            for (const [variable, name] of inventoryOnly ? [] : Object.entries(recipe.secrets)) {
              const value = await Effect.runPromise(dependencies.vault.resolve({ projectID: scope.projectID, name }))
              if (value === undefined) throw new Error(`Missing project Vault reference: ${name}`)
              environment[variable] = value
              if (value) injected.set(value, name)
            }
            const run = async (executable: string, args: string[]) => {
              if (abort.signal.aborted) throw new Error("Operation interrupted")
              const result = await Effect.runPromise(
                dependencies.process.run(
                  ChildProcess.make(executable, args, {
                    cwd: scope.directory,
                    env: environment,
                  }),
                  {
                    signal: abort.signal,
                    timeout: `${recipe.timeoutSeconds} seconds`,
                    maxOutputBytes: 32768,
                    maxErrorBytes: 32768,
                  },
                ),
              )
              state.output = (
                state.output + (await scrub(result.stdout.toString("utf8") + result.stderr.toString("utf8")))
              ).slice(-32768)
              if (result.exitCode !== 0) throw new Error(`Command exited with status ${result.exitCode}`)
              return result.stdout.toString("utf8")
            }
            const script = (command: string) =>
              !command.trim()
                ? Promise.resolve("")
                : process.platform === "win32"
                  ? run("powershell.exe", [
                      "-NoLogo",
                      "-NoProfile",
                      "-NonInteractive",
                      "-Command",
                      `$ErrorActionPreference='Stop'; ${command}; if ($LASTEXITCODE) { exit $LASTEXITCODE }`,
                    ])
                  : run("sh", ["-eu", "-c", command])
            const composePath =
              recipe.backend === "compose" && !inventoryOnly
                ? await realpath(path.join(scope.directory, recipe.composeFile))
                : undefined
            if (
              composePath &&
              (path.relative(scope.directory, composePath).startsWith("..") ||
                path.isAbsolute(path.relative(scope.directory, composePath)))
            )
              throw new Error("Compose file resolves outside the selected worktree")
            const compose = (args: string[]) =>
              run("docker", [
                "compose",
                "--project-name",
                info.composeProject,
                "--project-directory",
                scope.directory,
                "--file",
                composePath!,
                ...args,
              ])
            const stopCompose = async () => {
              const ids = (
                await run("docker", [
                  "ps",
                  "--all",
                  "--filter",
                  `label=com.docker.compose.project=${info.composeProject}`,
                  "--format",
                  "{{.ID}}",
                ])
              )
                .trim()
                .split(/\s+/)
                .filter(Boolean)
              if (ids.length) await run("docker", ["stop", "--time", "30", ...ids])
            }
            if (input.action === "reconcile") {
              if (recipe.backend === "compose")
                await run("docker", [
                  "ps",
                  "--all",
                  "--filter",
                  `label=com.docker.compose.project=${info.composeProject}`,
                  "--format",
                  "{{.ID}} {{.Names}} {{.State}} {{.Ports}}",
                ])
              await persist({
                info: {
                  ...info,
                  state: "reconciled",
                  output: state.output,
                  detail:
                    "Reconciled by operator. Existing containers and data were retained; start or stop explicitly.",
                  updatedAt: new Date().toISOString(),
                },
              })
              return
            }
            if (recipe.backend === "compose" && !inventoryOnly) await compose(["config", "--quiet"])
            if (input.action === "stop" || input.action === "recreate") {
              if (recipe.backend === "compose") await stopCompose()
              if (recipe.backend === "commands") await script(recipe.stop)
            }
            if (
              input.action === "prepare" ||
              input.action === "recreate" ||
              (input.action === "start" &&
                (!previous ||
                  previous.info.revision !== recipe.revision ||
                  !["prepared", "ready"].includes(previous.info.state)))
            )
              await script(recipe.prepare)
            if (input.action === "start" || input.action === "recreate") {
              if (recipe.backend === "compose")
                await compose([
                  "up",
                  "--detach",
                  "--wait",
                  "--remove-orphans",
                  ...(input.action === "recreate" ? ["--force-recreate"] : []),
                  "--wait-timeout",
                  String(Math.min(recipe.timeoutSeconds, 600)),
                ])
              if (recipe.backend === "commands") await script(recipe.start)
            }
            const validated = ["validate", "start", "recreate"].includes(input.action)
            if (validated) await script(recipe.validate)
            const finished: ProjectEnvironment.Info = {
              ...info,
              output: state.output,
              updatedAt: new Date().toISOString(),
              state: input.action === "stop" ? "stopped" : validated ? "ready" : "prepared",
              ...(validated ? { validatedAt: new Date().toISOString() } : {}),
            }
            await lock(scope.prefix, async () => {
              await persist({ info: finished })
              if (validated) {
                const latest = await readRecipe(scope.prefix, recipe.id)
                if (latest?.revision === recipe.revision)
                  await write(recipeFile(scope.prefix, recipe.id), {
                    ...latest,
                    validatedRevision: recipe.revision,
                    validatedAt: finished.validatedAt,
                  })
              }
            })
          } catch (error) {
            const detail = await scrub(error instanceof Error ? error.message : "Environment operation failed")
            await persist({
              info: {
                ...info,
                state: abort.signal.aborted ? "reconcile" : "failed",
                output: state.output,
                detail,
                updatedAt: new Date().toISOString(),
              },
            }).catch(async (failure: unknown) => {
              console.error("Could not persist project environment operation result", {
                id,
                requestID: input.requestID,
                detail,
                persistence: await scrub(failure instanceof Error ? failure.message : "Persistence failed"),
              })
            })
          }
        }
        const done = Promise.resolve()
          .then(execute)
          .catch(() => {
            console.error("Could not persist project environment operation result", { id, requestID: input.requestID })
          })
          .finally(() => live.delete(id))
        live.set(id, { abort, done })
        return info
      })
    },
    async dispose() {
      lifetime.closed = true
      for (const job of live.values()) job.abort.abort()
      await Promise.allSettled([...live.values()].map((job) => job.done))
      scopes.clear()
    },
  }
  return service
}

const unavailable = async (): Promise<never> => {
  throw new Error("Project environments need a native Redcode execution host")
}
export const unavailableLayer = Layer.succeed(
  Service,
  Service.of({ list: unavailable, save: unavailable, run: unavailable, dispose: async () => {} }),
)
export const configured = (directory?: string) =>
  makeGlobalNode({
    service: Service,
    layer: Layer.effect(
      Service,
      Effect.gen(function* () {
        if (typeof Bun === "undefined") return yield* Service.pipe(Effect.provide(unavailableLayer))
        const global = yield* Global.Service
        const project = yield* Project.Service
        const vault = yield* Vault.Service
        const process = yield* AppProcess.Service
        const owner = yield* ExecutionOwner.make
        return yield* Effect.acquireRelease(
          Effect.promise(() =>
            createProjectEnvironments(directory ?? path.join(global.state, "project-environments"), {
              project,
              vault,
              process,
              owner,
            }),
          ),
          (service) => Effect.promise(() => service.dispose()),
        )
      }),
    ),
    deps: [Global.node, Project.node, Vault.node, AppProcess.node],
  })
export const node = configured()
