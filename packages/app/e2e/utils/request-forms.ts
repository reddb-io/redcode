import type { FormInfo } from "@opencode/client/promise"
import { Form } from "@opencode/schema/form"
import { Vault } from "@opencode/schema/vault"

export function vaultRequestForm(sessionID: string) {
  return {
    id: Form.ID.create("frm_vault_request"),
    sessionID,
    title: "Secret requested: {vault:example-token}",
    metadata: { kind: "vault", secret: true, name: "example-token", purpose: "Read fixture repository metadata." },
    fields: [{ key: Vault.FORM_FIELD, type: "string", title: "{vault:example-token}", required: true }],
  } satisfies FormInfo
}

export function webSearchRequestForm(sessionID: string, specific = true) {
  return {
    id: Form.ID.create("frm_websearch_request"),
    sessionID,
    title: "Third-party web search",
    metadata: { kind: "websearch.provider" },
    fields: specific
      ? [
          {
            key: "provider",
            type: "string",
            options: [
              { value: "alpha", label: "Alpha Search" },
              { value: "beta", label: "Beta Search" },
            ],
          },
        ]
      : [
          {
            key: "choice",
            type: "string",
            options: [
              { value: "allow", label: "Allow" },
              { value: "choose", label: "Choose" },
              { value: "disable", label: "Disable" },
            ],
          },
        ],
  } satisfies FormInfo
}
