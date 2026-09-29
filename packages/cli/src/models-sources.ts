export * as ModelsSources from "./models-sources"

import path from "node:path"
import { parse, type ParseError } from "jsonc-parser"

/** Global config file names, lowest precedence first, as the config loader reads them. */
const NAMES = ["opencode.json", "opencode.jsonc", "redcode.json", "redcode.jsonc", "config.json", "config.jsonc"]

/**
 * The `models.sources` list of the global configuration. The models catalog cache is shared by every
 * project, so only global configuration may redirect it: the config directory's files, then the
 * `REDCODE_CONFIG` file and `REDCODE_CONFIG_CONTENT`, the last one that sets the list winning.
 */
export async function read(input: { directory: string; file?: string; content?: string }) {
  const texts = await Promise.all(
    [...NAMES.map((name) => path.join(input.directory, name)), ...(input.file ? [input.file] : [])].map((file) =>
      Bun.file(file)
        .text()
        .catch(() => undefined),
    ),
  )
  return [...texts, input.content].reduce<string[] | undefined>((current, text) => fromText(text) ?? current, undefined)
}

/** `models.sources` of one config text, or undefined when it does not set a valid list. */
export function fromText(text: string | undefined) {
  if (!text) return undefined
  const errors: ParseError[] = []
  const value: unknown = parse(
    text.replace(/\{env:([^}]+)\}/g, (_, name: string) => process.env[name] ?? ""),
    errors,
    { allowTrailingComma: true },
  )
  if (errors.length > 0 || typeof value !== "object" || value === null || !("models" in value)) return undefined
  const models = value.models
  if (typeof models !== "object" || models === null || !("sources" in models) || !Array.isArray(models.sources))
    return undefined
  return models.sources.filter((item): item is string => typeof item === "string")
}
