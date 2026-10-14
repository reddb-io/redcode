export * as AgentTools from "./agent-tools.js"

import path from "node:path"
import os from "node:os"
import { Context, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AgentTools } from "@opencode/schema/agent-tools"
import { AbsolutePath } from "@opencode/schema/schema"
import { AppProcess } from "@opencode/util/process"
import { FSUtil } from "@opencode/util/fs-util"
import { Npm } from "@opencode/util/npm"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KV } from "./kv.js"
import { KeyedMutex } from "./effect/keyed-mutex.js"

export { ID, Settings, Status, Snapshot, Configure } from "@opencode/schema/agent-tools"

export interface Interface {
  readonly list: () => Effect.Effect<AgentTools.Snapshot>
  readonly configure: (input: AgentTools.Configure) => Effect.Effect<AgentTools.Status, Error>
  readonly install: (id: AgentTools.ID) => Effect.Effect<AgentTools.Status, Error>
  readonly probe: (id: AgentTools.ID) => Effect.Effect<AgentTools.Status>
  readonly changes: () => Stream.Stream<void>
  readonly rift: (request: Schema.Json) => Effect.Effect<Schema.Json, Error>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/AgentTools") {}

// Optional tools are installed explicitly into the existing managed package cache.
// Pin releases so opening settings or restarting a host never checks a registry.
export function distribution(id: AgentTools.ID, host: { platform: string; arch: string }) {
  const native = ["x64", "arm64"].includes(host.arch)
  if (id === "rift")
    return {
      package: "rift-snapshot@0.0.13",
      supported: native && (host.platform === "darwin" || (host.platform === "linux" && host.arch === "x64")),
      entry: path.join("prebuilds", `${host.platform}-${host.arch}`, "rift"),
      mcp: [] as string[],
      probe: ["--version"],
    }
  if (id === "terminal-control") {
    const target = `${host.platform}-${host.arch}${host.platform === "linux" ? "-gnu" : ""}`
    return {
      package: `@kitlangton/terminal-control-${target}@1.2.1`,
      supported: native && ["linux", "darwin"].includes(host.platform),
      entry: path.join("bin", "termctrl"),
      mcp: ["mcp"],
      probe: ["--version"],
    }
  }
  if (id === "browser-control")
    return {
      package: "@opencode-ai/browser-control@0.8.4",
      supported: native && ["linux", "darwin", "win32"].includes(host.platform),
      entry: path.join("dist", "mcp.js"),
      mcp: [] as string[],
      probe: ["doctor"],
    }
  return {
    package: "open-computer-use@1.1.0",
    supported: native && ["linux", "darwin", "win32"].includes(host.platform),
    entry:
      host.platform === "darwin"
        ? path.join("dist", "Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse")
        : path.join(
            "dist",
            host.platform === "win32" ? "windows" : "linux",
            host.arch === "x64" ? "amd64" : "arm64",
            host.platform === "win32" ? "open-computer-use.exe" : "open-computer-use",
          ),
    mcp: ["mcp"],
    probe: ["--version"],
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const npm = yield* Npm.Service
    const fs = yield* FSUtil.Service
    const processService = yield* AppProcess.Service
    const changes = yield* PubSub.unbounded<void>()
    const locks = KeyedMutex.makeUnsafe<AgentTools.ID>()
    const host = { name: os.hostname(), platform: process.platform, arch: process.arch }
    const ids = AgentTools.ID.literals
    const diagnoses = new Map<AgentTools.ID, { diagnosis: string; checkedAt: number }>()
    const settings = Effect.fn("AgentTools.settings")(function* (id: AgentTools.ID) {
      const value = yield* kv.get(`redcode.agent-tools.${id}`)
      const parsed = Schema.decodeUnknownOption(AgentTools.Settings)(value)
      return Option.getOrElse(parsed, (): AgentTools.Settings => ({ enabled: false }))
    })
    const read = Effect.fn("AgentTools.read")(function* (id: AgentTools.ID, selected?: AgentTools.Settings) {
      const config = selected ?? (yield* settings(id))
      const spec = distribution(id, host)
      const installed = yield* npm.resolve(spec.package)
      const entry = path.join(installed.directory, spec.entry)
      const node = Bun.which("node")
      const command = config.command ?? (id === "browser-control" ? [node ?? "node", entry] : [entry, ...spec.mcp])
      const exists = config.command
        ? path.isAbsolute(command[0])
          ? yield* fs.isFile(command[0])
          : Bun.which(command[0]) !== null
        : (yield* fs.isFile(entry)) && (id !== "browser-control" || node !== null)
      const extensionDirectory = path.join(installed.directory, "extension", "dist")
      return {
        id,
        settings: config,
        supported: spec.supported,
        installed: exists,
        package: spec.package,
        ...(exists ? { command } : {}),
        ...(id === "browser-control" && (yield* fs.isDir(extensionDirectory))
          ? { extensionDirectory: AbsolutePath.make(extensionDirectory) }
          : {}),
        ...diagnoses.get(id),
      } satisfies AgentTools.Status
    })
    const notify = PubSub.publish(changes, undefined).pipe(Effect.asVoid)
    const rift = Effect.fn("AgentTools.rift")(function* (request: Schema.Json) {
      const item = yield* read("rift")
      if (!item.supported || !item.command) return yield* Effect.fail(new Error("Rift is not available on this host"))
      const [executable, ...args] = item.command
      const result = yield* processService
        .run(ChildProcess.make(executable, [...args, "rpc"]), {
          stdin: JSON.stringify(request),
          timeout: item.settings.timeout ?? 120_000,
          maxOutputBytes: 1024 * 1024,
          maxErrorBytes: 4096,
        })
        .pipe(
          Effect.flatMap(AppProcess.requireSuccess),
          Effect.mapError((error) => new Error(error.message)),
        )
      if (result.stdoutTruncated) return yield* Effect.fail(new Error("Rift response exceeds the output limit"))
      const reply = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RiftReply))(result.stdout.toString()).pipe(
        Effect.mapError(() => new Error("Rift returned an invalid RPC response")),
      )
      if (reply.status === "error") return yield* Effect.fail(new Error(`${reply.error.code}: ${reply.error.message}`))
      return reply.value
    })
    return Service.of({
      list: () => Effect.forEach(ids, (id) => read(id)).pipe(Effect.map((tools) => ({ host, tools }))),
      changes: () => Stream.fromPubSub(changes),
      rift,
      configure: (input) =>
        locks.withLock(input.id)(
          Effect.gen(function* () {
            const item = yield* read(input.id, input.settings)
            if (input.settings.enabled && (!item.supported || !item.installed))
              return yield* Effect.fail(new Error("Install a supported command on this host before enabling this tool"))
            yield* kv.set(`redcode.agent-tools.${input.id}`, Schema.encodeSync(AgentTools.Settings)(input.settings))
            diagnoses.delete(input.id)
            yield* notify
            return yield* read(input.id)
          }),
        ),
      install: (id) =>
        locks.withLock(id)(
          Effect.gen(function* () {
            const spec = distribution(id, host)
            if (!spec.supported) return yield* Effect.fail(new Error("This tool does not support this host platform"))
            yield* npm.add(spec.package).pipe(Effect.mapError((error) => new Error(error.message)))
            diagnoses.delete(id)
            yield* notify
            return yield* read(id)
          }),
        ),
      probe: (id) =>
        locks.withLock(id)(
          Effect.gen(function* () {
            const item = yield* read(id)
            const spec = distribution(id, host)
            const probeCommand =
              id === "browser-control" && item.command
                ? [item.command[0], path.join(path.dirname(item.command[1]), "cli.js"), ...spec.probe]
                : item.command
                  ? [item.command[0], ...spec.probe]
                  : []
            const diagnosis = !item.supported
              ? "Unsupported host platform"
              : !item.command
                ? "Tool is not installed"
                : item.settings.command
                  ? "Custom command found. Inspect its MCP connection after enabling it."
                  : yield* processService
                      .run(ChildProcess.make(probeCommand[0], probeCommand.slice(1)), {
                        timeout: Math.min(item.settings.timeout ?? 15_000, 30_000),
                        maxOutputBytes: 8192,
                        maxErrorBytes: 4096,
                      })
                      .pipe(
                        Effect.map(
                          (result) =>
                            `${result.stdout.toString()}\n${result.stderr.toString()}`.trim() ||
                            `Exit ${result.exitCode}`,
                        ),
                        Effect.catch((error) => Effect.succeed(error.message)),
                      )
            diagnoses.set(id, { diagnosis, checkedAt: Date.now() })
            return yield* read(id)
          }),
        ),
    })
  }),
)

const RiftReply = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ok"), value: Schema.Json }),
  Schema.Struct({
    status: Schema.Literal("error"),
    error: Schema.Struct({ code: Schema.String, message: Schema.String }),
  }),
])

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, Npm.node, FSUtil.node, AppProcess.node] })
