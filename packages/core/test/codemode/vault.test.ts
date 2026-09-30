import { expect, test } from "bun:test"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { Tool } from "@opencode/core/tool"
import { execute } from "@opencode/core/tool/runtime"
import { Agent } from "@opencode/schema/agent"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { Info } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { Vault } from "../../src/vault/vault.js"

const context = {
  sessionID: Session.ID.make("ses_codemode_vault"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_codemode_vault"),
  id: Tool.CallID.make("call_codemode_vault"),
  progress: () => Effect.void,
}

// A sink shaped like shell, webfetch and MCP: it resolves references through the running call's binding.
const reveal: Info = {
  name: "reveal",
  description: "Resolve vault references",
  input: Schema.Struct({ text: Schema.String }),
  output: Schema.Struct({ text: Schema.String }),
  execute: ({ text }) =>
    Vault.resolveAll(Vault.references(text)).pipe(
      Effect.map((resolved) => ({
        output: { text: "missing" in resolved ? `missing ${resolved.missing}` : Vault.fill(text, resolved.values) },
      })),
    ),
}

const codeMode = CodeModeTool.create({ tools: new Map([["reveal", reveal]]) }, (_, tool, input, context) =>
  execute(tool, input, context),
)

const binding: Vault.Binding = {
  projectID: Project.ID.make("prj_codemode_vault"),
  resolve: (name) => Effect.succeed(name === "api-key" ? "value-one" : undefined),
  scrub: (text) => Effect.succeed(text),
}

const code = `
const [first, second] = await Promise.all([
  tools.reveal({ text: "{vault:api-key}" }),
  tools.reveal({ text: "{vault:api-key}" }),
])
return [first.text, second.text]
`

test("tools called from Code Mode resolve references through the binding around execute", async () => {
  const result = await Effect.runPromise(
    codeMode.execute({ code }, context).pipe(Effect.provideService(Vault.Current, binding)),
  )
  expect(result.content).toEqual([{ type: "text", text: '[\n  "value-one",\n  "value-one"\n]' }])
})

test("without a binding a reference inside Code Mode stays unknown", async () => {
  const result = await Effect.runPromise(codeMode.execute({ code }, context))
  expect(result.content).toEqual([{ type: "text", text: '[\n  "missing api-key",\n  "missing api-key"\n]' }])
})
