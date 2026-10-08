export * as VaultRequestTool from "./vault-request.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { FORM_FIELD, FORM_KIND, reference, sanitize } from "@opencode/schema/vault"
import { Form } from "../../form.js"
import { Permission } from "../../permission.js"
import { Vault } from "../../vault/vault.js"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"

export const name = "vault_request"

export const description =
  "Ask the user for a secret this project's vault does not hold, such as an API key or a password. The user types it into a masked field; you get back only its `{vault:<name>}` reference, which works in shell commands, webfetch URLs, MCP arguments and .env files. Say in `purpose` what it is for. Only call this tool when the task actually requires a missing credential. Never call it for a placeholder, to recover a failed tool call, or to unblock execution. Never ask for a secret in a message or a question instead."

export const Input = Schema.Struct({
  name: Schema.String.annotate({
    description: "Short name for the reference, such as github-token or db-password; the stored name may differ.",
  }),
  purpose: Schema.String.annotate({ description: "What the secret is for, shown to the user." }),
})

export const Output = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  declined: Schema.Boolean,
})

export class CancelledError extends Schema.TaggedError<CancelledError>()("VaultRequestTool.CancelledError", {}) {
  override get message() {
    return "The user declined the secret request. Wait for new user input before requesting another secret."
  }
}

/**
 * Asks the user for a secret through a form the clients render masked and store under a project-unique name. The
 * value goes from the form straight into the vault: the form service keeps no answer of a secret form, and the
 * result, its metadata and the stored call carry only the reference. Dismissing the form stops execution until the user provides new input.
 */
export const Plugin = {
  id: "opencode.tool.vault-request",
  effect: Effect.fn("VaultRequestTool.Plugin")(function* (ctx: Context) {
    const forms = yield* Form.Service
    const permission = yield* Permission.Service
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())

    yield* ctx.tool
      .transform((editor) => {
        if (Config.latest(loaded.entries, "vault") === false) return
        editor.add({
          name,
          // Only an agent that may ask the user questions may ask for a secret.
          options: { codemode: false, permission: "question" },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (Config.latest(yield* config.entries(), "vault") === false)
                return yield* new ToolFailure({ message: "Vault is disabled for this repository." })
              const binding = yield* Vault.Current
              if (!binding) return yield* new ToolFailure({ message: "The vault is not available outside a session." })
              const asked = sanitize(input.name) || "secret"
              yield* permission
                .assert({
                  action: "question",
                  resources: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, id: context.id },
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: "Permission denied: question", error })))
              const state = yield* forms
                .ask({
                  sessionID: context.sessionID,
                  title: `Secret requested: ${reference(asked)}`,
                  metadata: {
                    kind: FORM_KIND,
                    secret: true,
                    name: asked,
                    purpose: input.purpose,
                    tool: { messageID: context.messageID, id: context.id },
                  },
                  fields: [
                    {
                      key: FORM_FIELD,
                      type: "string",
                      title: reference(asked),
                      description: input.purpose,
                      required: true,
                    },
                  ],
                })
                .pipe(Effect.orDie)
              const value = state.status === "answered" ? state.answer[FORM_FIELD] : undefined
              // Like question dismissal, tunnel through tool error conversion so the runner stops instead of
              // presenting a successful result that can trigger another request with a different name.
              if (typeof value !== "string" || value === "") return yield* Effect.die(new CancelledError())
              const stored = yield* binding.set({ name: asked, value, origin: "requested" })
              return {
                output: { name: stored, declined: false },
                content: `The user stored the secret as ${reference(stored)}. Use that reference where the value belongs; you never see the value.`,
                metadata: { name: stored, declined: false },
              }
            }),
        })
      })
      .pipe(Effect.orDie)
  }),
}
