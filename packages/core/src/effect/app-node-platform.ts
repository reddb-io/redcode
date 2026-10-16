import {
  LLMClient,
  RequestExecutor,
  type StreamOptions,
  type CompactionRequest,
  type CheckpointRequest,
  type EndpointCompactOptions,
  type TriggerCompactOptions,
} from "@opencode/ai/route"
import type { AIError, CompactionResponse, CompactionCheckpointResponse } from "@opencode/ai"
import { Socket } from "effect/unstable/socket"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { WebSocketConstructor } from "./websocket-constructor.js"
import { Effect, Layer } from "effect"
import { ProviderHealth } from "../provider-health.js"

export const requestExecutor = makeGlobalNode({
  service: RequestExecutor.Service,
  layer: Layer.effect(
    RequestExecutor.Service,
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const health = yield* ProviderHealth.Service
      return RequestExecutor.Service.of({
        execute: (request, middleware, options) =>
          executor.execute(
            request,
            (input, handler) =>
              middleware ? middleware(input, (sent) => health.execute(sent, handler)) : health.execute(input, handler),
            options,
          ),
      })
    }),
  ).pipe(Layer.provide(RequestExecutor.layer)),
  deps: [httpClient, ProviderHealth.node],
})

export const llmClient = makeGlobalNode({
  service: LLMClient.Service,
  layer: Layer.effect(
    LLMClient.Service,
    Effect.gen(function* () {
      const client = yield* LLMClient.Service
      const health = yield* ProviderHealth.Service
      const coordinated = (options?: StreamOptions) =>
        options?.webSocket ? { ...options, webSocket: health.webSocket(options.webSocket) } : options
      function compact(
        request: CompactionRequest,
        options?: EndpointCompactOptions,
      ): Effect.Effect<CompactionResponse, AIError>
      function compact(
        request: CheckpointRequest,
        options: TriggerCompactOptions,
      ): Effect.Effect<CompactionCheckpointResponse, AIError>
      function compact(
        request: CompactionRequest | CheckpointRequest,
        options?: EndpointCompactOptions | TriggerCompactOptions,
      ) {
        // The public overload correlates the request with its mechanism. Preserve
        // that contract while wrapping trigger compaction's WebSocket transport.
        if (options?.mechanism === "trigger")
          return client.compact(request as CheckpointRequest, { ...options, ...coordinated(options) })
        return client.compact(request as CompactionRequest, options)
      }
      return LLMClient.Service.of({
        ...client,
        compact,
        stream: (request, options) => client.stream(request, coordinated(options)),
        generate: (request, options) => client.generate(request, coordinated(options)),
      })
    }),
  ).pipe(Layer.provide(LLMClient.layer)),
  deps: [requestExecutor, ProviderHealth.node],
})

export const webSocketConstructor = makeGlobalNode({
  service: Socket.WebSocketConstructor,
  layer: WebSocketConstructor.layer,
  deps: [],
})

export * as LayerNodePlatform from "./app-node-platform.js"
