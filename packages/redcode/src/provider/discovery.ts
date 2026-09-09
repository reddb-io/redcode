import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

export const Input = Schema.Struct({ baseURL: Schema.String, apiKey: Schema.String })
export const Model = Schema.Struct({ id: Schema.String, name: Schema.String })
export const Result = Schema.Struct({ baseURL: Schema.String, models: Schema.Array(Model) })

export class DiscoveryError extends Schema.TaggedErrorClass<DiscoveryError>()("ProviderDiscoveryError", {
  message: Schema.String,
}) {}

const Catalog = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String) })),
})

export const discover = Effect.fn("ProviderDiscovery.discover")(function* (
  http: HttpClient.HttpClient,
  input: typeof Input.Type,
) {
  const url = yield* Effect.try({
    try: () => new URL(input.baseURL.trim()),
    catch: () => new DiscoveryError({ message: "Enter a valid API URL, such as http://127.0.0.1:20128/v1." }),
  })
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return yield* new DiscoveryError({
      message: "Use an HTTP or HTTPS API URL without credentials, query or fragment.",
    })
  }
  if (!input.apiKey.trim() || /[\r\n]/.test(input.apiKey)) {
    return yield* new DiscoveryError({ message: "Enter the API key from your provider dashboard." })
  }
  const baseURL = url.toString().replace(/\/+$/, "")
  return yield* Effect.gen(function* () {
    const response = yield* http
      .execute(
        HttpClientRequest.get(`${baseURL}/models`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(input.apiKey.trim()),
        ),
      )
      .pipe(
        Effect.mapError(
          () =>
            new DiscoveryError({
              message:
                "Cannot reach the provider. Check the API URL and that it is running on the Redcode server's network.",
            }),
        ),
      )
    if (response.status === 401 || response.status === 403) {
      return yield* new DiscoveryError({
        message: "The provider refused this API key. Copy a valid key from its dashboard and retry.",
      })
    }
    if (response.status !== 200) {
      return yield* new DiscoveryError({
        message: `The model list returned HTTP ${response.status}. Check the API URL, including /v1.`,
      })
    }
    const body = yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Catalog)),
      Effect.mapError(
        () =>
          new DiscoveryError({
            message: "The provider returned an invalid model list. Check that this is an OpenAI-compatible API URL.",
          }),
      ),
    )
    const models = [
      ...new Map(
        body.data
          .filter((model) => model.id.trim() && !["__proto__", "constructor", "prototype"].includes(model.id))
          .map((model) => [model.id, { id: model.id, name: model.name?.trim() || model.id }]),
      ).values(),
    ]
    if (!models.length) {
      return yield* new DiscoveryError({
        message: "No models are available. Connect an account or create a combo in the provider dashboard, then retry.",
      })
    }
    return { baseURL, models }
  }).pipe(
    Effect.timeoutOrElse({
      duration: "10 seconds",
      orElse: () =>
        Effect.fail(
          new DiscoveryError({ message: "The provider took too long to respond. Check the API URL and retry." }),
        ),
    }),
  )
})

export * as ProviderDiscovery from "./discovery"
