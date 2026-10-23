import type { FormInfo } from "@opencode/client/promise"
import { Form } from "@opencode/schema/form"
import { Vault } from "@opencode/schema/vault"

export function questionRequestForm(sessionID: string) {
  return {
    id: Form.ID.create("frm_question_request"),
    sessionID,
    title: "Questions",
    metadata: { kind: "question" },
    fields: [
      {
        key: "q0",
        type: "string",
        title: "Implementation",
        description: "Which implementation should be used?",
        options: [
          { value: "minimal", label: "Minimal", description: "Use the smallest correct change" },
          { value: "extended", label: "Extended", description: "Include additional behavior" },
        ],
        custom: true,
      },
      {
        key: "q1",
        type: "multiselect",
        title: "Coverage",
        description: "Which checks should run?",
        options: [
          { value: "unit", label: "Unit tests" },
          { value: "browser", label: "Browser checks" },
        ],
        custom: true,
      },
      {
        key: "q2",
        type: "string",
        title: "Delivery",
        description: "How should it be delivered?",
        options: [
          { value: "manual", label: "Manual review" },
          { value: "automatic", label: "Automatic delivery" },
        ],
        custom: true,
      },
    ],
  } satisfies FormInfo
}

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
