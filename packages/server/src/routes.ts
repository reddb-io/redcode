import { Database } from "@opencode/core/database/database"
import { V1Migration } from "@opencode/core/database/v1-migration"
import { App } from "@opencode/core/app"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Node } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { EventLogger } from "@opencode/core/event-logger"
import { FileSystemSearch } from "@opencode/core/filesystem/search"
import { Credential } from "@opencode/core/credential"
import { Config } from "@opencode/core/config"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { PtyTicket } from "@opencode/core/pty/ticket"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Project } from "@opencode/core/project"
import { Worktree } from "@opencode/core/worktree"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionUsageMirror } from "@opencode/core/usage/mirror"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionGoal } from "@opencode/core/session/goal"
import { SessionBudget } from "@opencode/core/session/budget"
import { SessionGuardLog } from "@opencode/core/session/guard-log"
import { SessionTaskFacts } from "@opencode/core/session/task-facts"
import { SessionTodoStore } from "@opencode/core/session/todo-store"
import { IntelligenceArtifacts } from "@opencode/core/intelligence/artifacts"
import { Intelligence } from "@opencode/core/intelligence"
import { DesignAppConnection } from "@opencode/core/design/app-connection"
import { DesignHost } from "@opencode/core/design/host"
import { Instance } from "@opencode/core/instance/service"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { SessionShare } from "@opencode/core/session/share"
import { ShellSelect } from "@opencode/core/shell/select"
import { MonitorRuntime } from "@opencode/core/monitor"
import { Job } from "@opencode/core/job"
import { Mcp } from "@opencode/core/mcp/index"
import { Global } from "@opencode/util/global"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { LocationActivity } from "@opencode/core/location-activity"
import { ModelsDev } from "@opencode/core/models-dev"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { PluginUpdate } from "@opencode/core/plugin/update"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { WellKnown } from "@opencode/core/wellknown"
import { Workspace } from "@opencode/core/workspace"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Context, Effect, Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { CorsConfig } from "./cors"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { defectLayer } from "./middleware/defect"
import { PtyEnvironment } from "./pty-environment"
import { PtySockets } from "./pty-sockets"
import { ServerPairing } from "./pairing"
import { layer } from "./location"
import { formLocationLayer } from "./middleware/form-location"
import { sessionLocationLayer } from "./middleware/session-location"
import { ServerInfo } from "./server-info"
import { DesignBrowser } from "./design-browser"
import { LegacyRpcApi } from "@opencode/protocol/groups/legacy-rpc"
import { LegacyRpcHandler } from "./handlers/legacy-rpc"
import type { ServerOptions } from "./options"

const applicationServiceNodes = [
  Global.node,
  Database.node,
  Bus.node,
  EventLogger.node,
  httpClient,
  Job.node,
  MonitorRuntime.node,
  Project.node,
  Worktree.node,
  Session.node,
  SessionExecution.node,
  SessionUsageMirror.node,
  SessionInbox.node,
  SessionGoal.node,
  SessionBudget.node,
  SessionGuardLog.node,
  SessionTaskFacts.node,
  SessionTodoStore.node,
  Intelligence.node,
  IntelligenceArtifacts.node,
  DesignAppConnection.node,
  Instance.node,
  SessionTransfer.node,
  SessionShare.node,
  SdkPlugins.node,
  PluginUpdate.node,
  PermissionSaved.node,
  PtyTicket.node,
  PersistentPty.node,
  Credential.node,
  WellKnown.node,
  PtyEnvironment.node,
  ServerPairing.node,
  LocationServiceMap.node,
  LocationActivity.node,
  SessionRestart.node,
  Workspace.node,
] as const
const applicationServices = LayerNode.group(applicationServiceNodes)

export function createRoutes(
  options: ServerOptions = {},
  serviceURLs: () => ReadonlyArray<string> = () => [],
  overrides: LayerNode.Replacements = [],
  features: { readonly v1Migration?: boolean; readonly ptySockets?: PtySockets.Interface } = {},
) {
  return makeRoutes(
    options.password
      ? ServerAuth.Config.configLayer({ password: Option.some(options.password) })
      : ServerAuth.Config.layer,
    options,
    serviceURLs,
    overrides,
    features.v1Migration !== false && !options.database?.url,
    undefined,
    features.ptySockets,
  )
}

type InstanceNode = (
  replacements: () => LayerNode.Replacements,
) => LayerNode.Provider<Instance.Service, LayerNode.Error<typeof Instance.node>, typeof Node.tags.values.global>

export function createEmbeddedRoutes(
  options: ServerOptions = {},
  overrides: LayerNode.Replacements = [],
  instances?: InstanceNode,
) {
  return makeRoutes(
    ServerAuth.Config.configLayer({ password: Option.none() }),
    options,
    () => [],
    overrides,
    !options.database?.url,
    instances,
  )
}

function makeRoutes<AuthError, AuthServices>(
  auth: Layer.Layer<ServerAuth.Config, AuthError, AuthServices>,
  options: ServerOptions,
  serviceURLs: () => ReadonlyArray<string>,
  // Runtime-profile replacements (e.g. workerd) applied after the standard set, so later entries win.
  overrides: LayerNode.Replacements,
  runV1Migration = true,
  instances?: InstanceNode,
  ptySockets?: PtySockets.Interface,
) {
  const standard: LayerNode.Replacements = [
    Database.node.replace(Database.configured(options.database)),
    PersistentPty.node.replace(PersistentPty.configured(options.pty)),
    Bus.node.replace(Bus.configured({ persist: options.events?.persist })),
    App.node.replace(App.configured(options.app)),
    ModelsDev.node.replace(ModelsDev.configured(options.models)),
    Watcher.node.replace(Watcher.configured({ enabled: options.fs?.filewatcher })),
    FileSystemSearch.node.replace(FileSystemSearch.configured({ fff: options.fs?.fff })),
    Global.node.replace(Global.layerWith(options.config?.directory ? { config: options.config.directory } : {})),
    Config.node.replace(
      Config.configured({
        project: options.config?.project,
        file: options.config?.file,
        content: options.config?.content,
      }),
    ),
    DesignAppConnection.node.replace(
      DesignAppConnection.configured({
        host: () => {
          const url = serviceURLs()[0]
          if (!url) return
          const host = new URL(url)
          if (host.hostname === "0.0.0.0" || host.hostname === "[::]" || host.hostname === "::")
            host.hostname = "127.0.0.1"
          return {
            url: host.origin,
            ...(options.password
              ? { authorization: `Basic ${Buffer.from(`opencode:${options.password}`).toString("base64")}` }
              : {}),
          }
        },
        database: options.database,
      }),
    ),
    InstructionDiscovery.node.replace(InstructionDiscovery.configured({ project: options.config?.project })),
    ShellSelect.node.replace(ShellSelect.configured({ gitbash: options.windows?.gitbash })),
    Mcp.node.replace(
      Mcp.configured({
        clientInfo: {
          name: options.app?.name ?? "opencode",
          version: options.app?.version ?? "unknown",
        },
      }),
    ),
  ]
  const build = (overrides: LayerNode.Replacements) => {
    const replacements: LayerNode.Replacements = [
      ...standard,
      // Private instances resolve this list lazily so they inherit the complete host graph, including the selector.
      ...(instances ? [Instance.node.replace(instances(() => replacements))] : []),
      ...overrides,
    ]
    return AppNodeBuilder.build(applicationServices, replacements)
  }
  const serviceLayer = options.simulation
    ? Layer.unwrap(
        Effect.gen(function* () {
          const { simulationReplacements } = yield* Effect.promise(() => import("@opencode/simulation/backend"))
          const simulation = yield* simulationReplacements({ version: App.make(options.app).version }).pipe(
            Effect.provide(HttpServer.layerServices),
          )
          return build([...overrides, ...simulation])
        }),
      )
    : build(overrides)
  return serviceLayer.pipe(
    Layer.flatMap((context) => {
      const services = Layer.succeedContext(context)
      const requestServices = Layer.merge(
        Layer.succeedContext(
          Context.pick(
            Database.Service,
            Credential.Service,
            PermissionSaved.Service,
            PluginUpdate.Service,
            Project.Service,
            WellKnown.Service,
          )(context),
        ),
        ServerInfo.layer(serviceURLs, Context.get(context, Global.Service).tmp, options.app, options.database),
      )
      const api = Layer.mergeAll(
        HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
          Layer.provide(
            handlers.pipe(
              Layer.provide(services),
              Layer.provide(Layer.succeed(CorsConfig, options)),
              Layer.provide(ptySockets ? Layer.succeed(PtySockets.Service, ptySockets) : PtySockets.layer),
            ),
          ),
        ),
        HttpApiBuilder.layer(LegacyRpcApi).pipe(Layer.provide(LegacyRpcHandler.pipe(Layer.provide(services)))),
        defectLayer(options.app?.channel),
      ).pipe(
        Layer.provide(formLocationLayer),
        Layer.provide(sessionLocationLayer),
        Layer.provide(layer),
        Layer.provide(authorizationLayer),
        Layer.provide(schemaErrorLayer),
        Layer.provide(auth),
        HttpRouter.provideRequest(requestServices),
        Layer.provideMerge(services),
        Layer.provideMerge(HttpRouter.layer),
      )
      const browser = DesignBrowser.routes(
        () => [...(options.hostname ? [options.hostname] : []), ...serviceURLs().map((url) => new URL(url).hostname)],
        // A wildcard bind lists each interface address; a loopback bind has no network address.
        () =>
          serviceURLs()
            .map((url) => DesignHost.networkURL(new URL(url)))
            .find((url) => url !== undefined),
      ).pipe(
        Layer.provide(services),
        Layer.provide(auth),
        Layer.provide(Layer.succeed(CorsConfig, options)),
        Layer.provideMerge(api),
      )
      return runV1Migration ? Layer.merge(browser, V1Migration.layer.pipe(Layer.provide(services))) : browser
    }),
  )
}
