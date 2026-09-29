import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Provider } from "../../provider.js"

const isBedrock = (item: { readonly package: string }) =>
  item.package.startsWith("@opencode/ai/providers/amazon-bedrock")

export const AmazonBedrockPlugin = define({
  id: "opencode.provider.amazon.bedrock",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((editor) => {
      // models.dev advertises AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and
      // AWS_REGION alongside the bearer token. Only the bearer token is a key;
      // the rest feed the SigV4 credential chain and must not become one.
      editor.method.update({
        integrationID: Provider.ID.amazonBedrock,
        method: { type: "env", names: ["AWS_BEARER_TOKEN_BEDROCK"] },
      })
    })
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (!isBedrock(item.provider)) continue
        evt.update(item.provider.id, (provider) => {
          const settings = provider.settings ?? {}
          // Bedrock is opt-in: AWS credentials in the environment or ~/.aws are often there for other
          // tools, so they never activate it alone. A Bedrock key (saved or AWS_BEARER_TOKEN_BEDROCK),
          // a `providers.amazon-bedrock` configuration entry, or a configured profile does.
          if (typeof settings.profile === "string" && provider.activation === "auto") provider.activation = "enabled"
          // Same default the native package uses, made explicit here so catalog
          // `${AWS_REGION}` URLs resolve without any region configured.
          const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1"
          provider.settings = {
            ...settings,
            ...(typeof settings.region !== "string" ? { region } : {}),
            // Users configure Bedrock private/VPC endpoints as `endpoint`; move it
            // into the catalog base URL once.
            ...(typeof settings.baseURL !== "string" && typeof settings.endpoint === "string"
              ? { baseURL: settings.endpoint }
              : {}),
          }
          delete provider.settings.endpoint
        })
      }
    })
  }),
})
