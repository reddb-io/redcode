import { EOL } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { Global } from "@opencode/util/global"

export const configureVault = Effect.fn("cli.vault.configure")(function* (input: {
  enabled: boolean
  global: boolean
}) {
  const global = yield* Global.Service
  const file = yield* Effect.promise(() =>
    writeVaultConfig(input.global ? global.config : repositoryDirectory(process.cwd()), input.enabled, input.global),
  )
  process.stdout.write(
    `Vault ${input.enabled ? "enabled" : "disabled"} ${input.global ? "globally" : "for this repository"}: ${file}` +
      EOL,
  )
})

/** Patch the highest-priority existing config, keeping comments and unrelated settings. */
export async function writeVaultConfig(directory: string, enabled: boolean, global: boolean) {
  const names = ["config.jsonc", "config.json", "redcode.jsonc", "redcode.json", "opencode.jsonc", "opencode.json"]
  const candidates = global
    ? names.map((name) => path.join(directory, name))
    : [".red/code", ".redcode", ".opencode"]
        .flatMap((root) => names.map((name) => path.join(directory, root, name)))
        .concat(names.filter((name) => !name.startsWith("config.")).map((name) => path.join(directory, name)))
  const existing = (
    await Promise.all(candidates.map(async (file) => ({ file, present: await Bun.file(file).exists() })))
  ).find((item) => item.present)
  const file = existing?.file ?? path.join(directory, global ? "config.jsonc" : "redcode.jsonc")
  const text = existing ? await Bun.file(file).text() : "{}\n"
  const errors: ParseError[] = []
  const document: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof document !== "object" || document === null || Array.isArray(document))
    throw new Error(`Cannot update malformed configuration: ${file}`)
  await Bun.write(
    file,
    applyEdits(
      text,
      modify(text, ["vault"], enabled, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      }),
    ),
  )
  return file
}

/** Repository toggles apply at the git root even when invoked from a nested directory. */
export function repositoryDirectory(directory: string) {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: directory, stderr: "ignore" })
  return result.exitCode === 0 ? path.resolve(result.stdout.toString().trim()) : directory
}
