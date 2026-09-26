export * as LSPServer from "./server.js"

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, readdir, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { which } from "../util/which.js"
import type { Handle } from "./client.js"

export interface Info {
  readonly id: string
  readonly extensions: readonly string[]
  readonly command: readonly string[]
  readonly initialization?: Record<string, unknown>
  readonly env?: Record<string, string>
  readonly root?: (file: string, directory: string, project: string) => Promise<string | undefined>
}

const packages = ["package.json", "package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]
const javascript = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]

/** Keep candidates until their file root is known, so nested package bins are discoverable. */
export function installed(_directory: string, _project: string): Info[] {
  return [
    { id: "deno", command: ["deno", "lsp"], extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"], root: nearest(["deno.json", "deno.jsonc"], { strict: true }) },
    { id: "typescript", command: ["typescript-language-server", "--stdio"], extensions: javascript, root: nearest(packages, { exclude: ["deno.json", "deno.jsonc"] }) },
    { id: "vue", command: ["vue-language-server", "--stdio"], extensions: [".vue"], root: nearest(packages) },
    { id: "oxlint", command: ["oxc_language_server"], extensions: [...javascript, ".vue", ".astro", ".svelte"], root: nearest([".oxlintrc.json", "oxlint.config.ts", "oxlint.config.js", "oxlint.config.mjs", ...packages]) },
    { id: "biome", command: ["biome", "lsp-proxy", "--stdio"], extensions: [...javascript, ".json", ".jsonc", ".vue", ".astro", ".svelte", ".css", ".graphql", ".gql", ".html"], root: nearest(["biome.json", "biome.jsonc"], { strict: true }) },
    { id: "gopls", command: ["gopls"], extensions: [".go"], root: nearest(["go.work", "go.mod", "go.sum"]) },
    { id: "ruby-lsp", command: ["rubocop", "--lsp"], extensions: [".rb", ".rake", ".gemspec", ".ru"], root: nearest(["Gemfile"]) },
    { id: "pyright", command: ["pyright-langserver", "--stdio"], extensions: [".py", ".pyi"], root: nearest(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]) },
    { id: "elixir-ls", command: ["elixir-ls"], extensions: [".ex", ".exs"], root: nearest(["mix.exs", "mix.lock"]) },
    { id: "zls", command: ["zls"], extensions: [".zig", ".zon"], root: nearest(["build.zig"]) },
    { id: "fsharp", command: ["fsautocomplete"], extensions: [".fs", ".fsi", ".fsx", ".fsscript"], root: nearest(["*.slnx", "*.sln", "*.fsproj", "global.json"]) },
    { id: "sourcekit-lsp", command: ["sourcekit-lsp"], extensions: [".swift", ".m", ".mm", ".objc", "objcpp"], root: nearest(["Package.swift", "*.xcodeproj", "*.xcworkspace"]) },
    { id: "rust", command: ["rust-analyzer"], extensions: [".rs"], root: cargoRoot },
    { id: "clangd", command: ["clangd", "--background-index"], extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"], root: nearest(["compile_commands.json", "compile_flags.txt", ".clangd"]) },
    { id: "svelte", command: ["svelteserver", "--stdio"], extensions: [".svelte"], root: nearest(packages) },
    { id: "astro", command: ["astro-ls", "--stdio"], extensions: [".astro"], root: nearest(packages) },
    { id: "yaml-ls", command: ["yaml-language-server", "--stdio"], extensions: [".yaml", ".yml"], root: nearest(packages) },
    { id: "lua-ls", command: ["lua-language-server"], extensions: [".lua"], root: nearest([".luarc.json", ".luarc.jsonc", ".luacheckrc", ".stylua.toml", "stylua.toml", "selene.toml", "selene.yml"]) },
    { id: "php intelephense", command: ["intelephense", "--stdio"], extensions: [".php"], root: nearest(["composer.json", "composer.lock", ".php-version"]) },
    { id: "prisma", command: ["prisma", "language-server"], extensions: [".prisma"], root: nearest(["schema.prisma", "prisma/schema.prisma", "prisma"], { exclude: ["package.json"] }) },
    { id: "dart", command: ["dart", "language-server", "--lsp"], extensions: [".dart"], root: nearest(["pubspec.yaml", "analysis_options.yaml"]) },
    { id: "ocaml-lsp", command: ["ocamllsp"], extensions: [".ml", ".mli"], root: nearest(["dune-project", "dune-workspace", ".merlin", "opam"]) },
    { id: "bash", command: ["bash-language-server", "start"], extensions: [".sh", ".bash", ".zsh", ".ksh"] },
    { id: "terraform", command: ["terraform-ls", "serve"], extensions: [".tf", ".tfvars"], root: nearest([".terraform.lock.hcl", "terraform.tfstate", "*.tf"]) },
    { id: "texlab", command: ["texlab"], extensions: [".tex", ".bib"], root: nearest([".latexmkrc", "latexmkrc", ".texlabroot", "texlabroot"]) },
    { id: "dockerfile", command: ["docker-langserver", "--stdio"], extensions: [".dockerfile", "Dockerfile"] },
    { id: "gleam", command: ["gleam", "lsp"], extensions: [".gleam"], root: nearest(["gleam.toml"]) },
    { id: "clojure-lsp", command: ["clojure-lsp", "listen"], extensions: [".clj", ".cljs", ".cljc", ".edn"], root: nearest(["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn", "build.boot"]) },
    { id: "nixd", command: ["nixd"], extensions: [".nix"], root: nearest(["flake.nix"]) },
    { id: "tinymist", command: ["tinymist"], extensions: [".typ", ".typc"], root: nearest(["typst.toml"]) },
    { id: "haskell-language-server", command: ["haskell-language-server-wrapper", "--lsp"], extensions: [".hs", ".lhs"], root: nearest(["stack.yaml", "cabal.project", "hie.yaml", "*.cabal"]) },
    { id: "julials", command: ["julia", "--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"], extensions: [".jl"], root: nearest(["Project.toml", "Manifest.toml", "*.jl"]) },
  ] satisfies Info[]
}

export function matches(server: Info, file: string) {
  const name = path.basename(file)
  return server.extensions.length === 0 || server.extensions.includes(path.extname(name).toLowerCase()) || server.extensions.includes(name)
}

export function root(server: Info, file: string, directory: string, project: string) {
  return server.root?.(file, directory, project) ?? Promise.resolve(directory)
}

export function available(server: Info, root: string, directory: string) {
  if (!resolveCommand(server, root, directory)) return false
  if (server.id === "typescript" || server.id === "astro") return typescriptPath(root, directory) !== undefined
  return true
}

function resolveCommand(server: Info, root: string, directory: string) {
  const command = server.command[0]
  if (!command) return
  if (command.includes("/") || command.includes("\\"))
    return existsSync(path.resolve(root, command)) ? command : undefined
  const bins = [...new Set([...ancestors(root, directory), directory])]
    .map((base) => path.join(base, "node_modules", ".bin"))
  return which(command, { PATH: [...bins, globalThis.process.env.PATH ?? ""].join(path.delimiter) }) ?? undefined
}

function typescriptPath(root: string, directory: string) {
  return [root, directory].map((base) => {
    try {
      return createRequire(path.join(base, "package.json")).resolve("typescript/lib/tsserver.js")
    } catch {
      return undefined
    }
  }).find((value) => value !== undefined)
}

function nearest(markers: readonly string[], options?: { readonly strict?: boolean; readonly exclude?: readonly string[] }) {
  return async (file: string, directory: string) => {
    const stop = path.resolve(directory)
    const excluded = options?.exclude && await scan(file, stop, options.exclude)
    if (excluded) return undefined
    return (await scan(file, stop, markers)) ?? (options?.strict ? undefined : stop)
  }
}

async function cargoRoot(file: string, directory: string, project: string) {
  const crate = await nearest(["Cargo.toml", "Cargo.lock"])(file, directory)
  if (!crate) return
  const stop = path.resolve(project)
  const roots = ancestors(crate, stop)
  const workspace = await Promise.all(roots.map(async (root) =>
    readFile(path.join(root, "Cargo.toml"), "utf8").then((content) => content.includes("[workspace]")).catch(() => false),
  ))
  return roots.findLast((_, index) => workspace[index]) ?? crate
}

async function scan(file: string, stop: string, markers: readonly string[]) {
  for (const directory of ancestors(path.dirname(file), stop)) {
    const entries = await readdir(directory).catch(() => [])
    const found = (await Promise.all(markers.map((marker) => marker.includes("/")
      ? stat(path.join(directory, marker)).then(() => true).catch(() => false)
      : Promise.resolve(entries.some((entry) => marker.startsWith("*.")
          ? entry.endsWith(marker.slice(1))
          : entry === marker)),
    ))).some(Boolean)
    if (found) return directory
  }
}

function ancestors(start: string, stop: string) {
  const root = path.resolve(stop)
  const initial = path.resolve(start)
  if (initial !== root && (path.relative(root, initial).startsWith("..") || path.isAbsolute(path.relative(root, initial))))
    return [initial]
  const values: string[] = []
  for (let current = initial; ; current = path.dirname(current)) {
    values.push(current)
    if (current === root || current === path.dirname(current)) return values
  }
}

export async function start(server: Info, root: string, directory: string): Promise<Handle> {
  const executable = resolveCommand(server, root, directory)
  if (!executable) throw new Error(`LSP server ${server.id} is not installed`)
  const tsserver = server.id === "typescript" || server.id === "astro"
    ? typescriptPath(root, directory)
    : undefined
  if ((server.id === "typescript" || server.id === "astro") && !tsserver)
    throw new Error(`LSP server ${server.id} requires TypeScript in the workspace`)
  const venvs = server.id === "pyright"
    ? [globalThis.process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter((value): value is string => value !== undefined)
    : []
  const python = (await Promise.all(venvs.map(async (venv) => {
    const executable = path.join(venv, globalThis.process.platform === "win32" ? "Scripts/python.exe" : "bin/python")
    return stat(executable).then(() => executable).catch(() => undefined)
  }))).find((value) => value !== undefined)
  const initialization = {
    ...(tsserver && server.id === "typescript" ? { tsserver: { path: tsserver } } : {}),
    ...(tsserver && server.id === "astro" ? { typescript: { tsdk: path.dirname(tsserver) } } : {}),
    ...(python ? { pythonPath: python } : {}),
    ...server.initialization,
  }
  const process = spawn(executable, server.command.slice(1), {
    cwd: root,
    env: { ...globalThis.process.env, ...server.env },
    stdio: "pipe",
  })
  const exited = new Promise<number | null>((resolve, reject) => {
    process.once("error", reject)
    process.once("exit", resolve)
  })
  process.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE" || error.code === "ECONNRESET") return
    process.kill("SIGTERM")
  })
  return { process, exited, initialization }
}
