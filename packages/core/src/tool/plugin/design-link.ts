export * as DesignLinkTool from "./design-link.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Design } from "@opencode/schema/design"
import { designReviewURL } from "@opencode/util/design-review"
import { Effect, Schema } from "effect"
import { DesignAppConnection } from "../../design/app-connection.js"
import { Permission } from "../../permission.js"

export const name = "design_link"
export const Input = Schema.Struct({
  share: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Also create a sign-in link for someone else: another device on the local network, or a browser on this machine that is not paired. Only when the user asks to share the review.",
    }),
  ),
})

const Links = Schema.Struct({ url: Schema.String, network: Schema.optional(Schema.String) })

export const Plugin = {
  id: "redcode.tool.design-link",
  effect: Effect.fn("DesignLinkTool.Plugin")(function* (ctx: Context) {
    const apps = yield* DesignAppConnection.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Return this Session's Design review link without publishing anything. Call it when the user reports that a review link expired, is unauthorized or does not open, or asks for the link again; never republish, restart or tear down the design session for that. The local link is stable on this machine. Set share only when the user asks to share the review with someone else.",
          input: Input,
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const host = apps.host()
              if (!host)
                return yield* new Design.Error({
                  code: "unavailable",
                  message:
                    "No Redcode server serves this Session's review, so there is no link to give. Ask the user to open the review from the Design panel of the Redcode desktop or web app.",
                })
              const local = `Review: ${designReviewURL(host.url, context.sessionID)}\nThis link is stable on this machine and never expires. It opens directly in the Redcode desktop app, in a browser paired with redcode pair, and in a browser that already opened this review. Any other browser shows how to sign in: open the review from the Redcode Design panel, or run redcode design ${context.sessionID} for a fresh sign-in link.`
              const content = input.share ? `${local}\n${yield* share(host, context.sessionID)}` : local
              return { output: content, content, metadata: {} }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

/** Fresh sign-in links from the owning server; each must be opened within 10 minutes. */
function share(host: { readonly url: string; readonly authorization?: string }, sessionID: string) {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(new URL(`/design/session/${encodeURIComponent(sessionID)}/link`, host.url), {
        headers: host.authorization ? { authorization: host.authorization } : {},
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`Redcode answered HTTP ${response.status}`)
      return Schema.decodeUnknownSync(Links)(await response.json())
    },
    catch: (error) =>
      new Design.Error({
        code: "unavailable",
        message: `Redcode did not create a share link: ${error instanceof Error ? error.message : String(error)}`,
      }),
  }).pipe(
    Effect.map((links) =>
      [
        links.network
          ? `Share on the local network: ${links.network}`
          : "Local network sharing is off, so another device cannot open this review. The user can run redcode service set hostname 0.0.0.0 and redcode service restart to turn it on.",
        `Sign-in link for an unpaired browser on this machine: ${links.url}`,
        "Each share link must be opened within 10 minutes; the browser that opens it then stays signed in while the review is in use. Call design_link with share again for a new one.",
      ].join("\n"),
    ),
  )
}
