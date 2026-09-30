import { Vault } from "@opencode/schema/vault"
import { Locale } from "./locale"
import { canonicalToolName, finiteNumber, webSearchProviderLabel } from "./tool-display"

type Dict = Record<string, unknown>

export type PermissionPresentation = {
  icon: string
  title: string
  lines: string[]
  diff?: string
  patch?: string
  file?: string
}

export type PermissionPresentationInput = {
  action: string
  resources: ReadonlyArray<unknown>
  metadata?: unknown
  input?: unknown
  toolMetadata?: unknown
}

export function permissionPresentation(
  source: PermissionPresentationInput,
  formatPath: (value: string) => string = (value) => value,
): PermissionPresentation {
  const action = canonicalToolName(source.action)
  const input = normalizeInput(action, source.input)
  const metadata = { ...dict(source.toolMetadata), ...dict(source.metadata) }
  const resources = source.resources.filter((item): item is string => typeof item === "string")

  if (action === "edit") {
    const file = text(input.path) || resources[0] || ""
    const first = dict(Array.isArray(metadata.files) ? metadata.files[0] : undefined)
    const diff = text(first.patch) || text(first.diff) || text(metadata.diff) || undefined
    return {
      icon: "→",
      title: `Edit ${formatPath(file)}`,
      lines: [],
      diff,
      patch: diff ? undefined : text(input.patchText) || undefined,
      file,
    }
  }

  if (action === "read" || action === "list") {
    const value = text(input.path) || resources[0] || ""
    const title = action === "read" ? "Read" : "List"
    return {
      icon: "→",
      title: `${title} ${formatPath(value)}`,
      lines: value ? [`Path: ${formatPath(value)}`] : [],
    }
  }

  if (action === "glob" || action === "grep") {
    const pattern = text(input.pattern) || resources[0] || ""
    const title = action === "glob" ? "Glob" : "Grep"
    return {
      icon: "✱",
      title: `${title} "${pattern}"`,
      lines: pattern ? [`Pattern: ${pattern}`] : [],
    }
  }

  if (action === "shell") {
    const command = text(input.command)
    return {
      icon: "#",
      title: "Shell command",
      lines: command ? [`$ ${command}`] : resources.map((item) => `- ${item}`),
    }
  }

  if (action === "subagent") {
    const agent = text(input.agent) || "general"
    const description = text(input.description)
    return {
      icon: "#",
      title: `${Locale.titlecase(agent)} Subagent`,
      lines: description ? [`◉ ${description}`] : [],
    }
  }

  if (action === "webfetch") {
    const url = text(input.url) || text(metadata.url)
    return {
      icon: "%",
      title: `WebFetch ${url}`,
      lines: url ? [`URL: ${url}`] : [],
    }
  }

  if (action === "websearch") {
    const query = text(input.query) || text(metadata.query)
    const title = webSearchProviderLabel(metadata.provider)
    return {
      icon: "◈",
      title: query ? `${title} "${query}"` : title,
      lines: query ? [`Query: ${query}`] : [],
    }
  }

  if (action === "lsp") {
    const file = text(input.path)
    const operation = text(input.operation) || "request"
    const line = finiteNumber(input.line)
    const character = finiteNumber(input.character)
    const position = line !== undefined && character !== undefined ? `${line}:${character}` : undefined
    return {
      icon: "→",
      title: `LSP ${operation}${file ? ` ${formatPath(file)}${position ? `:${position}` : ""}` : ""}`,
      lines: [
        ...(input.operation ? [`Operation: ${operation}`] : []),
        ...(file ? [`Path: ${formatPath(file)}`] : []),
        ...(position ? [`Position: ${position}`] : []),
      ],
    }
  }

  if (action === "external_directory") {
    const raw = text(metadata.parentDir) || text(metadata.filepath) || resources[0] || ""
    const directory = wildcardDirectory(raw)
    return {
      icon: "←",
      title: `Access external directory ${formatPath(directory)}`,
      lines: resources.map((item) => `- ${item}`),
    }
  }

  if (action === "vault") {
    const pairs = resources.map(vaultPair)
    const secrets = strings(metadata.secrets)
    const destinations = strings(metadata.destinations)
    const command = text(metadata.command)
    const url = text(metadata.url)
    const file = text(metadata.file)
    const references = (secrets.length > 0 ? secrets : [...new Set(pairs.map((pair) => pair.name))])
      .map((name) => Vault.reference(name))
      .join(", ")
    const targets = (destinations.length > 0 ? destinations : [...new Set(pairs.map((pair) => pair.destination))])
      .map(vaultDestination)
      .join(", ")
    return {
      icon: "⚿",
      title: `Allow ${references} to be sent to ${targets}?`,
      lines: [
        ...(command ? [`Command: ${command}`] : []),
        ...(url ? [`URL: ${url}`] : []),
        ...(file ? [`File: ${formatPath(file)}`] : []),
        "The value itself is never shown to the model.",
      ],
    }
  }

  if (action === "doom_loop") {
    return {
      icon: "⟳",
      title: "Continue after repeated failures",
      lines: ["This keeps the session running despite repeated failures."],
    }
  }

  return {
    icon: "⚙",
    title: `Call tool ${source.action}`,
    lines: [`Tool: ${source.action}`],
  }
}

function wildcardDirectory(value: string) {
  const wildcard = value.indexOf("*")
  if (wildcard === -1) return value
  const prefix = value.slice(0, wildcard)
  if (/^[\\/]+$/.test(prefix) || /^[A-Za-z]:[\\/]$/.test(prefix)) return prefix
  return prefix.replace(/[\\/]+$/, "")
}

export function permissionAlwaysLines(input: { action: string; save?: ReadonlyArray<string> }): string[] {
  const save = input.save ?? []
  if (input.action === "vault")
    return save.map(vaultPair).map(
      (pair) =>
        `This will always allow ${Vault.reference(pair.name)} to be sent to ${vaultDestination(pair.destination)} while the vault holds it.`,
    )
  if (save.length === 1 && save[0] === "*") {
    return [`This will always allow ${input.action} for this project.`]
  }
  return ["This will always allow the following patterns for this project.", ...save.map((item) => `- ${item}`)]
}

/** A vault permission resource, `<name>@<destination>`; names never contain "@", destinations may. */
function vaultPair(value: string) {
  const at = value.indexOf("@")
  if (at === -1) return { name: value, destination: "" }
  return { name: value.slice(0, at), destination: value.slice(at + 1) }
}

function vaultDestination(value: string) {
  if (value.startsWith("cmd:")) return `the ${value.slice("cmd:".length)} command`
  if (value.startsWith("mcp:")) return `the MCP server ${value.slice("mcp:".length)}`
  if (value.startsWith("file:")) return `the file ${value.slice("file:".length)}`
  return value
}

export function permissionOptionLabel(option: "once" | "always" | "reject" | "confirm" | "cancel") {
  if (option === "once") return "Allow once"
  if (option === "always") return "Always allow"
  if (option === "reject") return "Reject"
  if (option === "confirm") return "Confirm"
  return "Cancel"
}

function normalizeInput(action: string, value: unknown): Dict {
  const input = dict(value)
  const path = text(input.path) || text(input.filePath) || text(input.filepath)
  const agent = text(input.agent) || text(input.subagent_type)
  return {
    ...input,
    ...(["read", "edit", "list", "lsp"].includes(action) && path ? { path } : {}),
    ...(action === "subagent" && agent ? { agent } : {}),
  }
}

function dict(value: unknown): Dict {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Dict
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function text(value: unknown) {
  return typeof value === "string" ? value : ""
}
