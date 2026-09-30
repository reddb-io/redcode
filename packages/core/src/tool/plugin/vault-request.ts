export * as VaultRequestTool from "./vault-request.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { FORM_FIELD, FORM_KIND, reference, sanitize } from "@opencode/schema/vault"
import { Form } from "../../form.js"
import { Permission } from "../../permission.js"
import { Vault } from "../../vault/vault.js"

export const name = "vault_request"

export const description =
  "Ask the user for a secret this project's vault does not hold, such as an API key or a password. The user types it into a masked field; you get back only its `{vault:<name>}` reference, which works in shell commands, webfetch URLs, MCP arguments and .env files. Say in `purpose` what it is for. Never ask for a secret in a message or a question instead."

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

/**
 * Asks the user for a secret through a form the clients render masked and store under a project-unique name. The
 * value goes from the form straight into the vault: the form service keeps no answer of a secret form, and the
 * result, its metadata and the stored call carry only the reference. Dismissing the form is a decline the model
 * reads, not a failure.
 */
export const Plugin = {
  id: "opencode.tool.vault-request",
  effect: Effect.fn("VaultRequestTool.Plugin")(function* (ctx: Context) {
    const forms = yield* Form.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          // Only an agent that may ask the user questions may ask for a secret.
          options: { codemode: false, permission: "question" },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
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
              if (typeof value !== "string" || value === "")
                return {
                  output: { declined: true },
                  content: `The user declined to provide ${reference(asked)}. Continue without it, or ask how to proceed.`,
                  metadata: { name: asked, declined: true },
                }
              const stored = yield* binding.set({ name: asked, value, origin: "requested" })
              return {
                output: { name: stored, declined: false },
                content: `The user stored the secret as ${reference(stored)}. Use that reference where the value belongs; you never see the value.`,
                metadata: { name: stored, declined: false },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
