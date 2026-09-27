import { intro, log, multiselect, outro, select, text } from "@clack/prompts"
import { Global } from "@opencode/util/global"
import { Effect, Option, Schema } from "effect"
import { mkdir, writeFile } from "node:fs/promises"
import { EOL } from "node:os"
import path from "node:path"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { createClient, location, request } from "../auth/shared"

const GeneratedAgent = Schema.Struct({
  identifier: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  whenToUse: Schema.Trim.pipe(Schema.check(Schema.isNonEmpty())),
  systemPrompt: Schema.Trim.pipe(Schema.check(Schema.isNonEmpty())),
})
const GeneratedJson = Schema.fromJsonString(GeneratedAgent)
const permissions = [
  "shell", "read", "edit", "glob", "grep", "webfetch", "websearch", "subagent", "lsp", "skill", "todowrite",
] as const

export default Runtime.handler(Commands.commands.agent.commands.create, (input) =>
  Effect.gen(function* () {
    const interactive = process.stdin.isTTY && process.stdout.isTTY
    const suppliedDescription = Option.getOrUndefined(input.description)?.trim()
    const suppliedPath = Option.getOrUndefined(input.path)
    const suppliedMode = Option.getOrUndefined(input.mode)
    const suppliedPermissions = Option.getOrUndefined(input.permissions)
    if ((!suppliedDescription || !suppliedPath || !suppliedMode || suppliedPermissions === undefined) && !interactive)
      return yield* requireInteractive("Pass --path, --description, --mode, and --permissions in a non-interactive terminal")

    if (interactive) intro("Create agent")
    const global = yield* Global.Service
    const directory = suppliedPath
      ? path.resolve(suppliedPath)
      : (yield* prompt<"project" | "global">(() =>
          select({
            message: "Location",
            options: [
              { value: "project", label: "Current project" },
              { value: "global", label: "Global" },
            ],
          }),
        )) === "global"
        ? global.config
        : path.join(process.cwd(), ".opencode")
    const description = suppliedDescription ?? (yield* prompt<string>(() =>
      text({ message: "What should the agent do?", validate: (value) => value?.trim() ? undefined : "Required" }),
    )).trim()
    const mode =
      suppliedMode ??
      (yield* prompt<"all" | "primary" | "subagent">(() =>
        select({
          message: "Agent mode",
          options: [
            { value: "all", label: "All" },
            { value: "primary", label: "Primary" },
            { value: "subagent", label: "Subagent" },
          ],
        }),
      ))
    const allowed = suppliedPermissions === undefined
      ? yield* prompt<string[]>(() =>
          multiselect({
            message: "Permissions to allow",
            options: permissions.map((name) => ({ value: name, label: name })),
            initialValues: [...permissions],
            required: false,
          }),
        )
      : suppliedPermissions.trim()
        ? suppliedPermissions
            .split(",")
            .map((name) => {
              const value = name.trim()
              return value === "bash" ? "shell" : value === "task" ? "subagent" : value
            })
            .filter(Boolean)
        : [...permissions]
    const unknown = allowed.filter((name) => !permissions.some((permission) => permission === name))
    if (unknown.length > 0) return yield* Effect.fail(new Error(`Unknown permissions: ${unknown.join(", ")}`))

    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const existing = (yield* request((signal) => client.agent.list({ location }, { signal }))).data.map((agent) => agent.id)
    const modelName = Option.getOrUndefined(input.model)
    const separator = modelName?.indexOf("/") ?? -1
    if (modelName && (separator < 1 || separator === modelName.length - 1))
      return yield* Effect.fail(new Error("--model must be provider/model"))
    const model = modelName
      ? { providerID: modelName.slice(0, separator), id: modelName.slice(separator + 1) }
      : undefined
    const generationPrompt = [
      "Create one expert coding agent from the request below.",
      "Return only a JSON object with exactly three string fields: identifier, whenToUse, systemPrompt.",
      "identifier must use lowercase letters, digits, and hyphens, with no leading or trailing hyphen.",
      'whenToUse must start with "Use this agent when" and describe clear invocation conditions.',
      "systemPrompt must give clear operational instructions and respect project instructions.",
      `Existing identifiers that must not be reused: ${existing.join(", ") || "none"}.`,
      `Request: ${description}`,
    ].join("\n")
    if (interactive) log.info("Generating agent configuration...")
    const generated = yield* request((signal) =>
      client.generate.text({ prompt: generationPrompt, ...(model ? { model } : {}), location }, { signal }),
    )
    const first = yield* Effect.option(parseGenerated(generated.text))
    const agent = Option.isSome(first)
      ? first.value
      : yield* request((signal) =>
          client.generate.text({
            prompt: `${generationPrompt}\n\nThe previous response was invalid JSON for those three fields:\n${generated.text}\n\nReturn only the corrected JSON object.`,
            ...(model ? { model } : {}),
            location,
          }, { signal }),
        ).pipe(Effect.flatMap((response) => parseGenerated(response.text)))
    if (existing.includes(agent.identifier))
      return yield* Effect.fail(new Error(`Agent already exists: ${agent.identifier}`))

    const target = path.join(directory, "agents", `${agent.identifier}.md`)
    const denied = permissions.filter((name) => !allowed.includes(name))
    const content = [
      "---",
      `description: ${JSON.stringify(agent.whenToUse)}`,
      `mode: ${mode}`,
      ...(denied.length > 0
        ? ["permissions:", ...denied.flatMap((name) => [`  - action: ${name}`, '    resource: "*"', "    effect: deny"])]
        : []),
      "---",
      "",
      agent.systemPrompt.trim(),
      "",
    ].join("\n")
    yield* Effect.tryPromise({ try: () => mkdir(path.dirname(target), { recursive: true }), catch: (cause) => cause })
    yield* Effect.tryPromise({ try: () => writeFile(target, content, { flag: "wx" }), catch: (cause) => cause })
    if (interactive) outro(`Agent created: ${target}`)
    if (!interactive) process.stdout.write(target + EOL)
  }).pipe(handlePromptErrors),
)

function parseGenerated(value: string) {
  return Schema.decodeUnknownEffect(GeneratedJson)(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))
}
