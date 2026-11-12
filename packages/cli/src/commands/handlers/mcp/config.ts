import path from "node:path"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { ConfigDiscovery } from "@opencode/core/config/discovery"

/** Highest precedence first, matching server discovery within the selected authoring scope. */
export function configCandidates(directory: string, global: boolean, globalDirectory?: string) {
  const names = ConfigDiscovery.names.toReversed()
  if (global) return names.map((name) => path.join(directory, name))
  const root = repositoryRoot(directory)
  const directories = [path.resolve(directory)]
  while (directories.at(-1) !== root) {
    const parent = path.dirname(directories.at(-1)!)
    if (
      parent === directories.at(-1) ||
      !path
        .relative(root, parent)
        .split(path.sep)
        .every((part) => part !== "..")
    )
      break
    directories.push(parent)
  }
  const candidates = [
    ...directories.flatMap((base) =>
      [path.join(".red", "code"), ".redcode", ".opencode"].flatMap((config) =>
        names.map((name) => path.join(base, config, name)),
      ),
    ),
    ...directories.flatMap((base) =>
      names.filter((name) => !name.startsWith("config.")).map((name) => path.join(base, name)),
    ),
  ]
  // A project opened from HOME can contain .red/code, which may be the global config root.
  // As in server discovery, these files must not re-enter through the project walk.
  return globalDirectory
    ? candidates.filter((file) => !names.some((name) => path.relative(path.join(globalDirectory, name), file) === ""))
    : candidates
}

export async function readConfig(file: string) {
  if (!(await Bun.file(file).exists())) return
  const text = await Bun.file(file).text()
  const errors: ParseError[] = []
  const document: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !record(document)) throw new Error(`Cannot update malformed configuration: ${file}`)
  const mcp = document.mcp
  if (mcp !== undefined && !record(mcp)) throw new Error(`Invalid MCP configuration: ${file}`)
  const servers = mcp?.servers
  if (servers !== undefined && !record(servers)) throw new Error(`Invalid MCP servers configuration: ${file}`)
  return { text, mcp, servers }
}

export function definitionPaths(document: NonNullable<Awaited<ReturnType<typeof readConfig>>>, name: string) {
  const legacy = document.mcp?.[name]
  return [
    ...(document.servers && Object.hasOwn(document.servers, name) ? [["mcp", "servers", name]] : []),
    ...(name !== "servers" &&
    name !== "timeout" &&
    record(legacy) &&
    (legacy.type === "local" || legacy.type === "remote")
      ? [["mcp", name]]
      : []),
  ]
}

export function editConfig(text: string, key: string[], value: unknown) {
  return applyEdits(text, modify(text, key, value, { formattingOptions: { tabSize: 2, insertSpaces: true } }))
}

export async function writeConfig(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 })
  await rename(temporary, file)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function repositoryRoot(directory: string) {
  // Git is optional for config authoring. An unavailable executable or failed lookup narrows writes
  // to the current directory; it must not prevent add/remove or hide errors reading/writing documents.
  try {
    const git = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: directory, stderr: "ignore" })
    return git.exitCode === 0 ? path.resolve(git.stdout.toString().trim()) : path.resolve(directory)
  } catch {
    return path.resolve(directory)
  }
}
