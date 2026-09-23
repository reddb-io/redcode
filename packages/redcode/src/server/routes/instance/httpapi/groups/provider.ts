import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ProviderDiscovery } from "@/provider/discovery"
import { OpenAICompatible } from "@/provider/openai-compatible"
import { ProviderRemove } from "@/provider/remove"
import { QueryBoolean } from "./query"

export class ProviderDiscoveryApiError extends Schema.ErrorClass<ProviderDiscoveryApiError>(
  "ProviderDiscoveryApiError",
)({ message: Schema.String }, { httpApiStatus: 400 }) {}

export class ProviderConnectApiError extends Schema.ErrorClass<ProviderConnectApiError>("ProviderConnectApiError")(
  { reason: OpenAICompatible.Reason, message: Schema.String },
  { httpApiStatus: 400 },
) {}

const root = "/provider"

export const ProviderRemoveQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  dryRun: Schema.optional(QueryBoolean).annotate({
    description: "Only report what would be removed and cleared; change nothing.",
  }),
})

const ProviderAuthErrorName = Schema.Union([
  Schema.Literal("BadRequest"),
  Schema.Literal("ProviderAuthOauthMissing"),
  Schema.Literal("ProviderAuthOauthCodeMissing"),
  Schema.Literal("ProviderAuthOauthCallbackFailed"),
  Schema.Literal("ProviderAuthValidationFailed"),
])
export class ProviderAuthApiError extends Schema.ErrorClass<ProviderAuthApiError>("ProviderAuthError")(
  {
    name: ProviderAuthErrorName,
    data: Schema.Struct({
      providerID: Schema.optional(ProviderV2.ID),
      field: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
      kind: Schema.optional(Schema.String),
    }),
  },
  { httpApiStatus: 400 },
) {}

export const ProviderApi = HttpApi.make("provider")
  .add(
    HttpApiGroup.make("provider")
      .add(
        HttpApiEndpoint.post("discover", `${root}/discover`, {
          query: WorkspaceRoutingQuery,
          payload: ProviderDiscovery.Input,
          success: ProviderDiscovery.Result,
          error: ProviderDiscoveryApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.discover",
            summary: "Discover compatible provider models",
            description:
              "Check an OpenAI-compatible model catalog from the Redcode server without saving credentials or configuration.",
          }),
        ),
        HttpApiEndpoint.post("connectOpenAICompatible", `${root}/openai-compatible/connect`, {
          query: WorkspaceRoutingQuery,
          payload: OpenAICompatible.Input,
          success: OpenAICompatible.Result,
          error: ProviderConnectApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.openaiCompatible.connect",
            summary: "Connect an OpenAI-compatible provider",
            description:
              "Validate the provider id, URL, key and headers, discover models from the endpoint's /models list from the Redcode server (or take the model ids given), save the provider to global configuration and the key to the credential store (an {env:NAME} reference stays in configuration), and reload instances before responding. Ids of built-in providers are refused unless override is set. Nothing is saved when a check or discovery fails; reason tells which input to correct.",
          }),
        ),
        HttpApiEndpoint.post("connectNineRouter", `${root}/9router/connect`, {
          query: WorkspaceRoutingQuery,
          payload: ProviderDiscovery.Input,
          success: ProviderDiscovery.Result,
          error: ProviderDiscoveryApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.nineRouter.connect",
            summary: "Connect 9Router",
            description:
              "Connect the 9Router preset of the OpenAI-compatible connection: discover 9Router models from the Redcode server, save the provider to global configuration and the API key to the credential store, and reload instances before responding. Models that discovery added earlier and the router no longer lists are removed; customized models are kept.",
          }),
        ),
        HttpApiEndpoint.post("connectRedRouter", `${root}/red-router/connect`, {
          query: WorkspaceRoutingQuery,
          payload: ProviderDiscovery.Input,
          success: ProviderDiscovery.Result,
          error: ProviderDiscoveryApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.redRouter.connect",
            summary: "Connect RedRouter",
            description:
              "Connect the RedRouter preset of the OpenAI-compatible connection: discover RedRouter models from the Redcode server, save the provider to global configuration and the API key to the credential store, and reload instances before responding. Models that discovery added earlier and the router no longer lists are removed; customized models are kept.",
          }),
        ),
        HttpApiEndpoint.delete("remove", `${root}/:providerID`, {
          params: { providerID: ProviderV2.ID },
          query: ProviderRemoveQuery,
          success: described(ProviderRemove.Result, "What was removed, or with dryRun what would be"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.remove",
            summary: "Remove a provider",
            description:
              "Remove a provider completely: its saved key or login, its entry in the global configuration, the global settings that name it (default and small model, agent and command models, the enabled and disabled provider lists), System Two models and a System One evaluator that use it, cached router detections and learned model limits, then reload instances before responding. With dryRun=true nothing changes and the result lists what would be removed. Project configuration files that mention the provider are listed, not edited, and environment variables that make the provider available again are named.",
          }),
        ),
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Provider.ListResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.list",
            summary: "List providers",
            description: "Get a list of all available AI providers, including both available and connected ones.",
          }),
        ),
        HttpApiEndpoint.get("auth", `${root}/auth`, {
          query: WorkspaceRoutingQuery,
          success: described(ProviderAuth.Methods, "Provider auth methods"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.auth",
            summary: "Get provider auth methods",
            description: "Retrieve available authentication methods for all AI providers.",
          }),
        ),
        HttpApiEndpoint.post("authorize", `${root}/:providerID/oauth/authorize`, {
          params: { providerID: ProviderV2.ID },
          query: WorkspaceRoutingQuery,
          payload: ProviderAuth.AuthorizeInput,
          success: described(Schema.UndefinedOr(ProviderAuth.Authorization), "Authorization URL and method"),
          error: ProviderAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.authorize",
            summary: "Start OAuth authorization",
            description: "Start the OAuth authorization flow for a provider.",
          }),
        ),
        HttpApiEndpoint.post("callback", `${root}/:providerID/oauth/callback`, {
          params: { providerID: ProviderV2.ID },
          query: WorkspaceRoutingQuery,
          payload: ProviderAuth.CallbackInput,
          success: described(Schema.Boolean, "OAuth callback processed successfully"),
          error: ProviderAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.callback",
            summary: "Handle OAuth callback",
            description: "Handle the OAuth callback from a provider after user authorization.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "provider",
          description: "Experimental HttpApi provider routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Redcode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
