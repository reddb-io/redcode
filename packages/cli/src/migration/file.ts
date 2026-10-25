export * as FileConversion from "./file"

import fs from "node:fs/promises"
import path from "node:path"
import { parse, type ParseError } from "jsonc-parser"
import { ConfigImport } from "@opencode/core/import/config"
import { ConfigNormalize } from "@opencode/core/config/normalize"

export type Kind = "config" | "history" | "theme" | "display"

export async function inspect(source: string, kind: Kind = "config") {
  if (kind === "history") {
    const { inspectHistory } = await import("./history")
    return { source: path.resolve(source), kind, ...(await inspectHistory(source)) }
  }
  const prepared = await prepare(source, kind)
  return {
    source: path.resolve(source),
    kind,
    current: prepared.current,
    compatible:
      prepared.result.type === "normalized" && prepared.result.diagnostics.every((item) => item.kind === "conflict"),
    diagnostics: prepared.result.diagnostics,
  }
}

export async function convert(source: string, output: string, kind: Kind = "config") {
  if (path.resolve(source) === path.resolve(output)) throw new Error("Source and output must be different files")
  if (kind === "history") {
    const { inspectHistory, convertHistory } = await import("./history")
    if (!(await inspectHistory(source)).compatible)
      throw new Error("Source is not a convertible Redcode history database")
    const directory = await fs.mkdtemp(path.join(path.dirname(path.resolve(output)), ".redcode-history-import-"))
    return await (async () => {
      const file = path.join(directory, "history.db")
      await convertHistory(source, file)
      await fs.link(file, path.resolve(output))
      return { source: path.resolve(source), output: path.resolve(output), kind }
    })().finally(() => fs.rm(directory, { recursive: true, force: true }))
  }
  const prepared = await prepare(source, kind)
  if (prepared.result.type !== "normalized" || prepared.result.diagnostics.some((item) => item.kind !== "conflict"))
    throw new Error("Conversion requires resolving the incompatibilities reported by redcode migrate inspect")
  // Validate the emitted format using the exact parser the runtime owns.
  if (kind === "config" && ConfigNormalize.normalize(prepared.result.encoded).type !== "normalized")
    throw new Error("Converted configuration does not match the current schema")
  const temporary = `${path.resolve(output)}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(prepared.result.encoded, null, 2) + "\n", { flag: "wx", mode: 0o600 })
  // Publishing with a hard link refuses an existing destination atomically, including symlinks.
  await fs.link(temporary, path.resolve(output)).finally(() => fs.unlink(temporary))
  return { source: path.resolve(source), output: path.resolve(output), kind }
}

async function prepare(source: string, kind: Exclude<Kind, "history">) {
  const text = await Bun.file(source).text()
  if (kind === "config" && path.extname(source) === ".md") {
    const { ConfigMarkdown } = await import("@opencode/core/config/markdown")
    const document = ConfigMarkdown.parseOption(text)
    if (!document) return incompatible(kind)
    const parts = path.resolve(source).split(path.sep)
    const root = parts.findLastIndex((part) => ["agent", "agents", "mode", "modes"].includes(part))
    const name = (root < 0 ? path.basename(source) : parts.slice(root + 1).join("/")).replace(/\.md$/, "")
    const current = ConfigNormalize.normalize({
      agents: { [name]: { ...document.data, system: document.content.trim() } },
    })
    return {
      current: current.type === "normalized",
      result:
        current.type === "normalized"
          ? current
          : ConfigImport.convert({ agent: { [name]: { ...document.data, prompt: document.content.trim() } } }),
    }
  }
  const errors: ParseError[] = []
  const input: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) throw new Error("Source is not valid JSON or JSONC")
  if (kind === "theme") {
    const { convertTheme } = await import("./theme")
    return Promise.resolve()
      .then(() => ({
        current: !(typeof input === "object" && input !== null && "theme" in input),
        result: { type: "normalized" as const, encoded: convertTheme(input), diagnostics: [] },
      }))
      .catch(() => incompatible(kind))
  }
  if (kind === "display") {
    const { convertPreferences } = await import("./preferences")
    return convertPreferences(input, source).then(
      (converted) => ({
        current: converted.current,
        result: { type: "normalized" as const, encoded: converted.encoded, diagnostics: [] },
      }),
      () => incompatible(kind),
    )
  }
  const current = ConfigNormalize.normalize(input)
  return {
    current: current.type === "normalized",
    result: current.type === "normalized" ? current : ConfigImport.convert(input),
  }
}

function incompatible(kind: Kind) {
  return {
    current: false,
    result: {
      type: "rejected" as const,
      diagnostics: [
        {
          kind: "unsupported" as const,
          path: ["$"],
          message: `The ${kind} document contains incompatible or unsupported values`,
        },
      ],
    },
  }
}
