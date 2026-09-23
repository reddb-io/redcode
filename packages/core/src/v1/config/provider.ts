export * as ConfigProviderV1 from "./provider"

import { Schema } from "effect"
import { Router } from "@reddb-io/redcode-schema/router"
import { PositiveInt } from "../../schema"

export const ModelStatus = Schema.Literals(["alpha", "beta", "deprecated", "active"])

const InterleavedField = Schema.Union([
  Schema.Literals(["reasoning", "reasoning_content", "reasoning_text"]),
  Schema.String,
])

/**
 * Settings RedRouter reports a model accepts. A combo reports its strictest member's: the smallest
 * limits, the thinking levels every member accepts, and false when any member refuses to disable
 * thinking or to be forced to call a tool.
 */
export const RouterParameters = Schema.Struct({
  context_length: Schema.optional(Schema.Finite),
  max_completion_tokens: Schema.optional(Schema.Finite),
  reasoning: Schema.optional(Schema.Boolean),
  thinking_levels: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  thinking_can_disable: Schema.optional(Schema.Boolean),
  forced_tool_choice: Schema.optional(Schema.Boolean).annotate({
    description: "False when a request with a forced tool_choice (any or a named tool) would be refused.",
  }),
  tools: Schema.optional(Schema.Boolean),
  search: Schema.optional(Schema.Boolean),
  modes: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Modes the router serves the model in besides its default, e.g. review.",
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.optional(Schema.Array(Schema.String)),
      output: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
})
export type RouterParameters = typeof RouterParameters.Type

/** The provider behind a routed model, as RedRouter's model list reports it. */
export const RouterUpstream = Schema.Struct({
  id: Schema.String,
  slug: Schema.optional(Schema.String),
  prefix: Schema.optional(Schema.String).annotate({ description: "The legacy short code of the provider, e.g. cx." }),
  name: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  subscription: Schema.optional(Schema.Boolean),
})
export type RouterUpstream = typeof RouterUpstream.Type

/** A reasoning level (`level`) or mode (`mode`, e.g. review) RedRouter serves under a model. */
export const RouterVariant = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  level: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.String),
  aliases: Schema.optional(Schema.Array(Schema.String)),
})
export type RouterVariant = typeof RouterVariant.Type

export const Model = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  release_date: Schema.optional(Schema.String),
  attachment: Schema.optional(Schema.Boolean),
  reasoning: Schema.optional(Schema.Boolean),
  temperature: Schema.optional(Schema.Boolean),
  tool_call: Schema.optional(Schema.Boolean),
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Boolean,
      InterleavedField,
      Schema.Struct({
        field: InterleavedField,
      }),
    ]),
  ),
  cost: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
      context_over_200k: Schema.optional(
        Schema.Struct({
          input: Schema.Finite,
          output: Schema.Finite,
          cache_read: Schema.optional(Schema.Finite),
          cache_write: Schema.optional(Schema.Finite),
        }),
      ),
    }),
  ),
  limit: Schema.optional(
    Schema.Struct({
      context: Schema.Finite.annotate({
        description:
          "Context window in tokens: the most a request's input and output may carry together. Set it to what the provider behind a router or proxy actually enforces when that is smaller than the catalog's value. A limit the provider reports when refusing a request is learned and applied when smaller (see `redcode debug limits`); setting or changing this value clears that lesson.",
      }),
      input: Schema.optional(Schema.Finite).annotate({
        description:
          "Input limit in tokens, when the provider caps the input separately from the context window. Requests are compacted before reaching it.",
      }),
      output: Schema.Finite.annotate({ description: "Maximum output tokens the model may produce in one request." }),
    }),
  ),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.optional(Schema.mutable(Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])))),
      output: Schema.optional(
        Schema.mutable(Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"]))),
      ),
    }),
  ),
  experimental: Schema.optional(Schema.Boolean),
  status: Schema.optional(ModelStatus),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
  options: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  router: Schema.optional(
    Schema.Struct({
      owned_by: Schema.optional(Schema.String),
      strategy: Schema.optional(Schema.String),
      thinking_levels: Schema.optional(Schema.Array(Schema.String)),
      capabilities: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
      parameters: Schema.optional(RouterParameters),
      members: Schema.optional(Schema.Array(Schema.String)).annotate({
        description: "The provider/model ids a combo can route to, nested combos expanded.",
      }),
      provider: Schema.optional(RouterUpstream).annotate({
        description: "The provider behind the model, as the router reported it.",
      }),
      aliases: Schema.optional(Schema.Array(Schema.String)).annotate({
        description:
          "Earlier ids of this model at the router. A saved reference to one of them is moved to this model's id.",
      }),
      variants: Schema.optional(Schema.Array(RouterVariant)).annotate({
        description: "Reasoning levels and modes the router serves under this model instead of as separate models.",
      }),
      via: Schema.optional(Schema.String).annotate({
        description: "Set when the router serves this model through another router, such as a remote RedRouter.",
      }),
    }),
  ).annotate({
    description:
      "What the router reported about this model, written by provider discovery. Its thinking levels become the model's variants.",
  }),
  variants: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.StructWithRest(
        Schema.Struct({
          disabled: Schema.optional(Schema.Boolean).annotate({ description: "Disable this variant for the model" }),
        }),
        [Schema.Record(Schema.String, Schema.Any)],
      ),
    ).annotate({ description: "Variant-specific configuration" }),
  ),
})

export const Info = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  env: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  id: Schema.optional(Schema.String),
  npm: Schema.optional(Schema.String),
  whitelist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  blacklist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  options: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        apiKey: Schema.optional(Schema.String),
        baseURL: Schema.optional(Schema.String),
        enterpriseUrl: Schema.optional(Schema.String).annotate({
          description: "GitHub Enterprise URL for copilot authentication",
        }),
        setCacheKey: Schema.optional(Schema.Boolean).annotate({
          description: "Enable promptCacheKey for this provider (default false)",
        }),
        timeout: Schema.optional(
          Schema.Union([PositiveInt, Schema.Literal(false)]).annotate({
            description: "Timeout in milliseconds for full requests to this provider. Set to false to disable timeout.",
          }),
        ).annotate({
          description: "Timeout in milliseconds for full requests to this provider. Set to false to disable timeout.",
        }),
        headerTimeout: Schema.optional(
          Schema.Union([PositiveInt, Schema.Literal(false)]).annotate({
            description:
              "Timeout in milliseconds to wait for response headers. Provider integrations may set defaults. Set to false to disable timeout.",
          }),
        ).annotate({
          description:
            "Timeout in milliseconds to wait for response headers. Provider integrations may set defaults. Set to false to disable timeout.",
        }),
        chunkTimeout: Schema.optional(
          Schema.Union([PositiveInt, Schema.Literal(false)]).annotate({
            description:
              "Timeout in milliseconds between streamed SSE chunks for this provider (default: 300000). If no chunk arrives within this window, the request is aborted. Set to false to disable timeout.",
          }),
        ).annotate({
          description:
            "Timeout in milliseconds between streamed SSE chunks for this provider (default: 300000). If no chunk arrives within this window, the request is aborted. Set to false to disable timeout.",
        }),
      }),
      [Schema.Record(Schema.String, Schema.Any)],
    ),
  ),
  router: Schema.optional(Router.Connection).annotate({
    description:
      "The router this connection was found to be (RedRouter or 9Router), written when it is connected or its models are refreshed.",
  }),
  models: Schema.optional(Schema.Record(Schema.String, Model)),
}).annotate({ identifier: "ProviderConfig" })
export type Info = Schema.Schema.Type<typeof Info>
