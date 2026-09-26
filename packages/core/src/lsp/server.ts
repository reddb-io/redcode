export * as LSPServer from "./server.js"

import { spawn } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { Global } from "@opencode/util/global"
import { which } from "../util/which.js"
import type { Handle } from "./client.js"

export interface Info {
  readonly id: string
  readonly extensions: readonly string[]
  readonly command: readonly string[]
  readonly initialization?: Record<string, unknown>
  readonly env?: Record<string, string>
  readonly root?: (file: string, directory: string, project: string) => Promise<string | undefined>
  readonly download?: { readonly package: string; readonly bin?: string }
}

const packages = ["package.json", "package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]
const javascript = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]

/** Keep candidates until their file root is known, so nested package bins are discoverable. */
export function installed(_directory: string, _project: string): Info[] {
  return [
    { id: "deno", command: ["deno", "lsp"], extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"], root: nearest(["deno.json", "deno.jsonc"], { strict: true }) },
    { id: "typescript", command: ["typescript-language-server", "--stdio"], extensions: javascript, root: nearest(packages, { exclude: ["deno.json", "deno.jsonc"] }), download: { package: "typescript-language-server", bin: "typescript-language-server" } },
    { id: "vue", command: ["vue-language-server", "--stdio"], extensions: [".vue"], root: nearest(packages), download: { package: "@vue/language-server", bin: "vue-language-server" } },
    { id: "eslint", command: ["vscode-eslint-language-server", "--stdio"], extensions: [...javascript, ".vue"], root: nearest(["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ...packages]), download: { package: "vscode-langservers-extracted", bin: "vscode-eslint-language-server" } },
    { id: "oxlint", command: ["oxc_language_server"], extensions: [...javascript, ".vue", ".astro", ".svelte"], root: nearest([".oxlintrc.json", "oxlint.config.ts", "oxlint.config.js", "oxlint.config.mjs", ...packages]) },
    { id: "biome", command: ["biome", "lsp-proxy", "--stdio"], extensions: [...javascript, ".json", ".jsonc", ".vue", ".astro", ".svelte", ".css", ".graphql", ".gql", ".html"], root: nearest(["biome.json", "biome.jsonc"], { strict: true }), download: { package: "@biomejs/biome", bin: "biome" } },
    { id: "gopls", command: ["gopls"], extensions: [".go"], root: goRoot },
    { id: "ruby-lsp", command: ["rubocop", "--lsp"], extensions: [".rb", ".rake", ".gemspec", ".ru"], root: nearest(["Gemfile"]) },
    ...(["1", "true"].includes(globalThis.process.env.REDCODE_EXPERIMENTAL_LSP_TY?.toLowerCase() ?? "")
      ? [{ id: "ty", command: ["ty", "server"], extensions: [".py", ".pyi"], root: nearest(["pyproject.toml", "ty.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]) }]
      : [{ id: "pyright", command: ["pyright-langserver", "--stdio"], extensions: [".py", ".pyi"], root: nearest(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]), download: { package: "pyright", bin: "pyright-langserver" }]),
    { id: "elixir-ls", command: ["elixir-ls"], extensions: [".ex", ".exs"], root: nearest(["mix.exs", "mix.lock"]) },
    { id: "zls", command: ["zls"], extensions: [".zig", ".zon"], root: nearest(["build.zig"]) },
    { id: "csharp", command: ["roslyn-language-server", "--stdio", "--autoLoadProjects"], extensions: [".cs", ".csx"], root: nearest(["*.slnx", "*.sln", "*.csproj", "global.json"]) },
    { id: "razor", command: ["roslyn-language-server", "--stdio", "--autoLoadProjects"], extensions: [".razor", ".cshtml"], root: nearest(["*.slnx", "*.sln", "*.csproj", "global.json"]) },
    { id: "fsharp", command: ["fsautocomplete"], extensions: [".fs", ".fsi", ".fsx", ".fsscript"], root: nearest(["*.slnx", "*.sln", "*.fsproj", "global.json"]) },
    { id: "sourcekit-lsp", command: ["sourcekit-lsp"], extensions: [".swift", ".m", ".mm", ".objc", "objcpp"], root: nearest(["Package.swift", "*.xcodeproj", "*.xcworkspace"]) },
    { id: "rust", command: ["rust-analyzer"], extensions: [".rs"], root: cargoRoot },
    { id: "clangd", command: ["clangd", "--background-index", "--clang-tidy"], extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"], root: nearest(["compile_commands.json", "compile_flags.txt", ".clangd"]) },
    { id: "svelte", command: ["svelteserver", "--stdio"], extensions: [".svelte"], root: nearest(packages), download: { package: "svelte-language-server", bin: "svelteserver" } },
    { id: "astro", command: ["astro-ls", "--stdio"], extensions: [".astro"], root: nearest(packages), download: { package: "@astrojs/language-server", bin: "astro-ls" } },
    { id: "jdtls", command: ["java"], extensions: [".java"], root: javaRoot },
    { id: "kotlin-ls", command: ["kotlin-lsp", "--stdio"], extensions: [".kt", ".kts"], root: kotlinRoot },
    { id: "yaml-ls", command: ["yaml-language-server", "--stdio"], extensions: [".yaml", ".yml"], root: nearest(packages), download: { package: "yaml-language-server", bin: "yaml-language-server" } },
    { id: "lua-ls", command: ["lua-language-server"], extensions: [".lua"], root: nearest([".luarc.json", ".luarc.jsonc", ".luacheckrc", ".stylua.toml", "stylua.toml", "selene.toml", "selene.yml"]) },
    { id: "php intelephense", command: ["intelephense", "--stdio"], extensions: [".php"], root: nearest(["composer.json", "composer.lock", ".php-version"]), initialization: { telemetry: { enabled: false } }, download: { package: "intelephense", bin: "intelephense" } },
    { id: "prisma", command: ["prisma", "language-server"], extensions: [".prisma"], root: nearest(["schema.prisma", "prisma/schema.prisma", "prisma"], { exclude: ["package.json"] }) },
    { id: "dart", command: ["dart", "language-server", "--lsp"], extensions: [".dart"], root: nearest(["pubspec.yaml", "analysis_options.yaml"]) },
    { id: "ocaml-lsp", command: ["ocamllsp"], extensions: [".ml", ".mli"], root: nearest(["dune-project", "dune-workspace", ".merlin", "opam"]) },
    { id: "bash", command: ["bash-language-server", "start"], extensions: [".sh", ".bash", ".zsh", ".ksh"], download: { package: "bash-language-server", bin: "bash-language-server" } },
    { id: "terraform", command: ["terraform-ls", "serve"], extensions: [".tf", ".tfvars"], root: nearest([".terraform.lock.hcl", "terraform.tfstate", "*.tf"]), initialization: { experimentalFeatures: { prefillRequiredFields: true, validateOnSave: true } } },
    { id: "texlab", command: ["texlab"], extensions: [".tex", ".bib"], root: nearest([".latexmkrc", "latexmkrc", ".texlabroot", "texlabroot"]) },
    { id: "dockerfile", command: ["docker-langserver", "--stdio"], extensions: [".dockerfile", "Dockerfile"], download: { package: "dockerfile-language-server-nodejs", bin: "docker-langserver" } },
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

export function available(server: Info, root: string, directory: string, downloads: boolean) {
  if (server.id === "oxlint" && server.command[0] === "oxc_language_server")
    return !!resolveCommand(server, root, directory) || !!resolveCommand({ ...server, command: ["oxlint"] }, root, directory)
  if (server.id === "zls" && server.command[0] === "zls")
    return !!resolveCommand(server, root, directory) || downloads && !!which("zig")
  if (server.id === "clangd" && server.command[0] === "clangd")
    return !!resolveCommand(server, root, directory) || !!clangdCache() || downloads
  if (server.id === "lua-ls" && server.command[0] === "lua-language-server")
    return !!resolveCommand(server, root, directory) || existsSync(luaExecutable()) || downloads
  if (server.id === "elixir-ls" && server.command[0] === "elixir-ls")
    return !!resolveCommand(server, root, directory) || existsSync(elixirExecutable()) || downloads && !!which("elixir") && !!which("mix")
  if (server.id === "terraform" && server.command[0] === "terraform-ls")
    return !!resolveCommand(server, root, directory) || downloads
  if ((server.id === "texlab" || server.id === "tinymist") && server.command[0] === server.id)
    return !!resolveCommand(server, root, directory) || downloads
  if (server.id === "sourcekit-lsp" && server.command[0] === "sourcekit-lsp" && !resolveCommand(server, root, directory))
    return !!which("xcrun")
  if (server.id === "jdtls" && server.command[0] === "java")
    return !!which("java") && (existsSync(path.join(Global.Path.bin, "jdtls", "plugins")) || downloads)
  if (server.id === "kotlin-ls" && server.command[0] === "kotlin-lsp")
    return !!resolveCommand(server, root, directory) || existsSync(kotlinLauncher()) || downloads
  if (!resolveCommand(server, root, directory) && !(downloads && (server.download || isRoslyn(server) && which("dotnet") || nativeInstaller(server)))) return false
  if (server.id === "razor" && isRoslyn(server) && !razorExtension()) return false
  if (server.id === "typescript" || server.id === "astro") return typescriptPath(root, directory) !== undefined
  if (server.id === "eslint") return modulePath("eslint", root, directory) !== undefined
  return true
}

function resolveCommand(server: Info, root: string, directory: string) {
  const command = server.command[0]
  if (!command) return
  if (command.includes("/") || command.includes("\\"))
    return existsSync(path.resolve(root, command)) ? command : undefined
  const bins = [...new Set([...ancestors(root, directory), directory])]
    .map((base) => path.join(base, "node_modules", ".bin"))
  return which(command, { PATH: [...bins, globalThis.process.env.PATH ?? "", Global.Path.bin].join(path.delimiter) })
    ?? (server.id === "ty" && command === "ty" ? [globalThis.process.env.VIRTUAL_ENV, path.join(root, ".venv"), path.join(root, "venv")]
      .filter((value): value is string => value !== undefined)
      .map((venv) => path.join(venv, globalThis.process.platform === "win32" ? "Scripts/ty.exe" : "bin/ty"))
      .find((candidate) => existsSync(candidate)) : undefined)
    ?? (isRoslyn(server) ? roslynGlobalPath() : undefined)
}

function isRoslyn(server: Info) {
  return (server.id === "csharp" || server.id === "razor") && server.command[0] === "roslyn-language-server"
}

function nativeInstaller(server: Info) {
  if (server.id === "gopls" && server.command[0] === "gopls" && which("go"))
    return ["go", "install", "golang.org/x/tools/gopls@latest"]
  if (server.id === "ruby-lsp" && server.command[0] === "rubocop" && which("ruby") && which("gem"))
    return ["gem", "install", "rubocop", "--bindir", Global.Path.bin]
  if (server.id === "fsharp" && server.command[0] === "fsautocomplete" && which("dotnet"))
    return ["dotnet", "tool", "install", "fsautocomplete", "--tool-path", Global.Path.bin]
}

async function installNative(server: Info, downloads: boolean) {
  const command = downloads && nativeInstaller(server)
  if (!command) return
  await mkdir(Global.Path.bin, { recursive: true })
  const child = Bun.spawn(command, {
    env: { ...globalThis.process.env, GOBIN: Global.Path.bin },
    stdout: "ignore",
    stderr: "ignore",
  })
  if (await child.exited !== 0) return
  const name = server.command[0]
  if (!name) return
  const executable = path.join(Global.Path.bin, `${name}${globalThis.process.platform === "win32" ? ".exe" : ""}`)
  return existsSync(executable) ? executable : undefined
}

function roslynGlobalPath() {
  const bin = path.join(globalThis.process.env.DOTNET_CLI_HOME ?? os.homedir(), ".dotnet", "tools", `roslyn-language-server${globalThis.process.platform === "win32" ? ".cmd" : ""}`)
  return existsSync(bin) ? bin : undefined
}

function razorExtension() {
  const roots = [
    globalThis.process.env.VSCODE_EXTENSIONS,
    ...[".vscode", ".vscode-insiders", ".vscode-server", ".vscode-server-insiders"].map((name) => path.join(os.homedir(), name, "extensions")),
  ].filter((value): value is string => value !== undefined)
  return [...new Set(roots)].flatMap((root) => {
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("ms-dotnettools.csharp-"))
        .map((entry) => path.join(root, entry.name))
    } catch {
      return []
    }
  }).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).map((directory) => {
    const extension = path.join(directory, ".razorExtension")
    return {
      compiler: path.join(extension, "Microsoft.CodeAnalysis.Razor.Compiler.dll"),
      targets: path.join(extension, "Targets", "Microsoft.NET.Sdk.Razor.DesignTime.targets"),
      extension: path.join(extension, "Microsoft.VisualStudioCode.RazorExtension.dll"),
    }
  }).find((item) => existsSync(item.compiler) && existsSync(item.targets) && existsSync(item.extension))
}

let roslynInstall: Promise<string | undefined> | undefined

async function installRoslyn(downloads: boolean) {
  if (!downloads || !which("dotnet")) return
  roslynInstall ??= new Promise<string | undefined>((resolve) => {
    const child = spawn("dotnet", ["tool", "install", "--global", "roslyn-language-server", "--prerelease"], { stdio: "ignore" })
    child.once("error", () => resolve(undefined))
    child.once("exit", (code) => resolve(code === 0 ? which("roslyn-language-server") ?? roslynGlobalPath() : undefined))
  }).finally(() => { roslynInstall = undefined })
  return roslynInstall
}

function typescriptPath(root: string, directory: string) {
  return modulePath("typescript/lib/tsserver.js", root, directory)
}

function modulePath(name: string, root: string, directory: string) {
  return [root, directory].map((base) => {
    try {
      return createRequire(path.join(base, "package.json")).resolve(name)
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

async function goRoot(file: string, directory: string) {
  return (await nearest(["go.work"], { strict: true })(file, directory))
    ?? nearest(["go.mod", "go.sum"])(file, directory)
}

async function kotlinRoot(file: string, directory: string) {
  for (const markers of [
    ["settings.gradle.kts", "settings.gradle"],
    ["gradlew", "gradlew.bat"],
    ["build.gradle.kts", "build.gradle"],
    ["pom.xml"],
  ]) {
    const found = await nearest(markers, { strict: true })(file, directory)
    if (found) return found
  }
  return directory
}

async function javaRoot(file: string, directory: string) {
  const wrapper = await nearest(["gradlew", "gradlew.bat"], { strict: true, exclude: ["settings.gradle", "settings.gradle.kts"] })(file, directory)
  if (wrapper) return wrapper
  const settings = await nearest(["settings.gradle", "settings.gradle.kts"], { strict: true })(file, directory)
  if (settings) return settings
  const build = await nearest(["build.gradle", "build.gradle.kts"], { strict: true })(file, directory)
  if (build) return build
  const poms = ancestors(path.dirname(file), directory).filter((base) => existsSync(path.join(base, "pom.xml")))
  if (poms.length) {
    const parent = await poms.slice(1).reduce(async (selected, base) => {
      const current = await selected
      if (!current) return undefined
      const content = await readFile(path.join(base, "pom.xml"), "utf8").catch(() => "")
      const relative = path.relative(base, current).replaceAll("\\", "/")
      const modules = content.match(/<modules>([\s\S]*?)<\/modules>/g) ?? []
      return modules.some((block) => [...block.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)]
        .some((match) => match[1]?.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "") === relative)) ? base : undefined
    }, Promise.resolve(poms[0] as string | undefined))
    return parent ?? poms[0]
  }
  return nearest([".project", ".classpath"], { strict: true })(file, directory)
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

export async function start(server: Info, root: string, directory: string, downloads: boolean): Promise<Handle> {
  const specialized = await specializedLaunch(server, root, directory, downloads)
  const executable = specialized?.executable
    ?? resolveCommand(server, root, directory)
    ?? (isRoslyn(server) ? await installRoslyn(downloads) : undefined)
    ?? await installNative(server, downloads)
    ?? await download(server, downloads)
  if (!executable) throw new Error(`LSP server ${server.id} is not installed`)
  const tsserver = server.id === "typescript" || server.id === "astro"
    ? typescriptPath(root, directory)
    : undefined
  if ((server.id === "typescript" || server.id === "astro") && !tsserver)
    throw new Error(`LSP server ${server.id} requires TypeScript in the workspace`)
  if (server.id === "eslint" && !modulePath("eslint", root, directory))
    throw new Error("LSP server eslint requires ESLint in the workspace")
  const venvs = server.id === "pyright" || server.id === "ty"
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
  const razor = server.id === "razor" && isRoslyn(server) ? razorExtension() : undefined
  if (server.id === "razor" && isRoslyn(server) && !razor)
    throw new Error("LSP server razor requires the VS Code C# Razor extension")
  const process = spawn(executable, [
    ...(specialized?.args ?? server.command.slice(1)),
    ...(razor ? [`--razorSourceGenerator=${razor.compiler}`, `--razorDesignTimePath=${razor.targets}`, "--extension", razor.extension] : []),
  ], {
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

async function download(server: Info, enabled: boolean) {
  if (!enabled || !server.download) return
  const { Npm } = await import("@opencode/util/npm")
  return Npm.which(server.download.package, server.download.bin)
}

async function specializedLaunch(server: Info, root: string, directory: string, downloads: boolean) {
  if (server.id === "jdtls" && server.command[0] === "java") return javaLaunch(downloads)
  if (server.id === "oxlint" && server.command[0] === "oxc_language_server")
    return oxlintLaunch(server, root, directory)
  if (resolveCommand(server, root, directory)) return
  if (server.id === "zls" && server.command[0] === "zls") return zlsLaunch(downloads)
  if (server.id === "clangd" && server.command[0] === "clangd") return clangdLaunch(downloads)
  if (server.id === "lua-ls" && server.command[0] === "lua-language-server") return luaLaunch(downloads)
  if (server.id === "elixir-ls" && server.command[0] === "elixir-ls") return elixirLaunch(downloads)
  if (server.id === "terraform" && server.command[0] === "terraform-ls") return terraformLaunch(downloads)
  if (server.id === "texlab" && server.command[0] === "texlab") return texlabLaunch(downloads)
  if (server.id === "tinymist" && server.command[0] === "tinymist") return tinymistLaunch(downloads)
  if (server.id === "kotlin-ls" && server.command[0] === "kotlin-lsp") return kotlinLaunch(downloads)
  if (server.id === "sourcekit-lsp" && server.command[0] === "sourcekit-lsp") return sourcekitLaunch()
}

async function sourcekitLaunch() {
  const xcrun = which("xcrun")
  if (!xcrun) return
  const child = Bun.spawn([xcrun, "--find", "sourcekit-lsp"], { stdout: "pipe", stderr: "ignore" })
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
  const executable = output.trim()
  return code === 0 && executable ? { executable, args: [] } : undefined
}

async function oxlintLaunch(server: Info, root: string, directory: string) {
  const executable = resolveCommand({ ...server, command: ["oxlint"] }, root, directory)
  if (!executable) return
  const child = Bun.spawn([executable, "--help"], { stdout: "pipe", stderr: "ignore" })
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
  return code === 0 && output.includes("--lsp") ? { executable, args: ["--lsp"] } : undefined
}

async function zlsLaunch(downloads: boolean) {
  if (!downloads || !which("zig")) return
  const platform = globalThis.process.platform === "darwin" ? "macos" : globalThis.process.platform === "win32" ? "windows" : globalThis.process.platform
  const arch = globalThis.process.arch === "arm64" ? "aarch64" : globalThis.process.arch === "x64" ? "x86_64" : globalThis.process.arch === "ia32" ? "x86" : globalThis.process.arch
  const extension = globalThis.process.platform === "win32" ? "zip" : "tar.xz"
  const name = `zls-${arch}-${platform}.${extension}`
  if (!["zls-x86_64-linux.tar.xz", "zls-x86_64-macos.tar.xz", "zls-x86_64-windows.zip", "zls-aarch64-linux.tar.xz", "zls-aarch64-macos.tar.xz", "zls-aarch64-windows.zip", "zls-x86-linux.tar.xz", "zls-x86-windows.zip"].includes(name))
    throw new Error(`LSP server zls does not support ${platform}-${arch}`)
  await unpack(await githubAsset("zigtools/zls", name), name, Global.Path.bin)
  const executable = path.join(Global.Path.bin, `zls${globalThis.process.platform === "win32" ? ".exe" : ""}`)
  if (!existsSync(executable)) throw new Error("LSP server zls archive has no executable")
  if (globalThis.process.platform !== "win32") await chmod(executable, 0o755)
  return { executable, args: [] }
}

function clangdCache() {
  const name = `clangd${globalThis.process.platform === "win32" ? ".exe" : ""}`
  try {
    return readdirSync(Global.Path.bin, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("clangd_"))
      .map((entry) => path.join(Global.Path.bin, entry.name, "bin", name))
      .find((candidate) => existsSync(candidate))
  } catch {
    return undefined
  }
}

async function clangdLaunch(downloads: boolean) {
  const cached = clangdCache()
  if (cached) return { executable: cached, args: ["--background-index", "--clang-tidy"] }
  if (!downloads) return
  const platform = globalThis.process.platform === "darwin" ? "mac" : globalThis.process.platform === "win32" ? "windows" : "linux"
  const response = await fetch("https://api.github.com/repos/clangd/clangd/releases/latest")
  if (!response.ok) throw new Error(`LSP server clangd release lookup failed: HTTP ${response.status}`)
  const release: unknown = await response.json()
  const tag = typeof release === "object" && release !== null && "tag_name" in release && typeof release.tag_name === "string"
    ? release.tag_name : undefined
  const assets = typeof release === "object" && release !== null && "assets" in release && Array.isArray(release.assets)
    ? release.assets as unknown[] : []
  if (!tag) throw new Error("LSP server clangd release has no tag")
  const candidates = assets.filter((item) => typeof item === "object" && item !== null && "name" in item && typeof item.name === "string" && item.name.includes(tag) && item.name.includes(platform))
  const asset = candidates.find((item) => typeof item === "object" && item !== null && "name" in item && typeof item.name === "string" && item.name.endsWith(".zip"))
    ?? candidates.find((item) => typeof item === "object" && item !== null && "name" in item && typeof item.name === "string" && item.name.endsWith(".tar.xz"))
  const name = typeof asset === "object" && asset !== null && "name" in asset && typeof asset.name === "string" ? asset.name : undefined
  const url = typeof asset === "object" && asset !== null && "browser_download_url" in asset && typeof asset.browser_download_url === "string"
    ? asset.browser_download_url : undefined
  if (!name || !url) throw new Error(`LSP server clangd release has no ${platform} archive`)
  await unpack(url, name, Global.Path.bin)
  const executable = path.join(Global.Path.bin, `clangd_${tag}`, "bin", `clangd${globalThis.process.platform === "win32" ? ".exe" : ""}`)
  if (!existsSync(executable)) throw new Error("LSP server clangd archive has no executable")
  if (globalThis.process.platform !== "win32") await chmod(executable, 0o755)
  return { executable, args: ["--background-index", "--clang-tidy"] }
}

function luaExecutable() {
  return path.join(Global.Path.bin, `lua-language-server-${globalThis.process.arch}-${globalThis.process.platform}`, "bin", `lua-language-server${globalThis.process.platform === "win32" ? ".exe" : ""}`)
}

async function luaLaunch(downloads: boolean) {
  const executable = luaExecutable()
  if (existsSync(executable)) return { executable, args: [] }
  if (!downloads) return
  const extension = globalThis.process.platform === "win32" ? "zip" : "tar.gz"
  const combination = `${globalThis.process.platform}-${globalThis.process.arch}.${extension}`
  if (!["darwin-arm64.tar.gz", "darwin-x64.tar.gz", "linux-x64.tar.gz", "linux-arm64.tar.gz", "win32-x64.zip", "win32-ia32.zip"].includes(combination))
    throw new Error(`LSP server lua-ls does not support ${combination}`)
  const response = await fetch("https://api.github.com/repos/LuaLS/lua-language-server/releases/latest")
  if (!response.ok) throw new Error(`LSP server lua-ls release lookup failed: HTTP ${response.status}`)
  const release: unknown = await response.json()
  const tag = typeof release === "object" && release !== null && "tag_name" in release && typeof release.tag_name === "string"
    ? release.tag_name : undefined
  const name = `lua-language-server-${tag}-${combination}`
  const assets = typeof release === "object" && release !== null && "assets" in release && Array.isArray(release.assets)
    ? release.assets as unknown[] : []
  const asset = assets.find((item) => typeof item === "object" && item !== null && "name" in item && item.name === name)
  const url = typeof asset === "object" && asset !== null && "browser_download_url" in asset && typeof asset.browser_download_url === "string"
    ? asset.browser_download_url : undefined
  if (!tag || !url) throw new Error(`LSP server lua-ls release has no ${combination} archive`)
  const directory = path.dirname(path.dirname(executable))
  await rm(directory, { recursive: true, force: true })
  await unpack(url, name, directory)
  if (!existsSync(executable)) throw new Error("LSP server lua-ls archive has no executable")
  if (globalThis.process.platform !== "win32") await chmod(executable, 0o755)
  return { executable, args: [] }
}

function elixirExecutable() {
  return path.join(Global.Path.bin, "elixir-ls-master", "release", globalThis.process.platform === "win32" ? "language_server.bat" : "language_server.sh")
}

async function elixirLaunch(downloads: boolean) {
  const executable = elixirExecutable()
  if (existsSync(executable)) return { executable, args: [] }
  const mix = which("mix")
  if (!downloads || !which("elixir") || !mix) return
  await unpack("https://github.com/elixir-lsp/elixir-ls/archive/refs/heads/master.zip", "elixir-ls.zip", Global.Path.bin)
  const directory = path.join(Global.Path.bin, "elixir-ls-master")
  const env = { ...globalThis.process.env, MIX_ENV: "prod" }
  for (const args of [["deps.get"], ["compile"], ["elixir_ls.release2", "-o", "release"]]) {
    const child = Bun.spawn([mix, ...args], { cwd: directory, env, stdout: "ignore", stderr: "pipe" })
    const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()])
    if (code !== 0) throw new Error(`LSP server elixir-ls build failed: mix ${args[0]}: ${error.trim()}`)
  }
  if (!existsSync(executable)) throw new Error("LSP server elixir-ls release has no executable")
  if (globalThis.process.platform !== "win32") await chmod(executable, 0o755)
  return { executable, args: [] }
}

async function terraformLaunch(downloads: boolean) {
  if (!downloads) return
  const response = await fetch("https://api.releases.hashicorp.com/v1/releases/terraform-ls/latest")
  if (!response.ok) throw new Error(`LSP server terraform release lookup failed: HTTP ${response.status}`)
  const release: unknown = await response.json()
  const builds = typeof release === "object" && release !== null && "builds" in release && Array.isArray(release.builds)
    ? release.builds as unknown[] : []
  const platform = globalThis.process.platform === "win32" ? "windows" : globalThis.process.platform
  const arch = globalThis.process.arch === "arm64" ? "arm64" : "amd64"
  const build = builds.find((item) => typeof item === "object" && item !== null && "os" in item && "arch" in item && item.os === platform && item.arch === arch)
  const url = typeof build === "object" && build !== null && "url" in build && typeof build.url === "string"
    ? build.url : undefined
  if (!url) throw new Error(`LSP server terraform has no ${platform}-${arch} build`)
  await unpack(url, "terraform-ls.zip", Global.Path.bin)
  const executable = path.join(Global.Path.bin, `terraform-ls${globalThis.process.platform === "win32" ? ".exe" : ""}`)
  if (!existsSync(executable)) throw new Error("LSP server terraform archive has no executable")
  if (globalThis.process.platform !== "win32") await chmod(executable, 0o755)
  return { executable, args: ["serve"] }
}

async function texlabLaunch(downloads: boolean) {
  if (!downloads) return
  if (!["x64", "arm64"].includes(globalThis.process.arch) || !["linux", "darwin", "win32"].includes(globalThis.process.platform))
    throw new Error(`LSP server texlab does not support ${globalThis.process.platform}-${globalThis.process.arch}`)
  const arch = globalThis.process.arch === "arm64" ? "aarch64" : "x86_64"
  const platform = globalThis.process.platform === "darwin" ? "macos" : globalThis.process.platform === "win32" ? "windows" : "linux"
  const name = `texlab-${arch}-${platform}.${globalThis.process.platform === "win32" ? "zip" : "tar.gz"}`
  await unpack(await githubAsset("latex-lsp/texlab", name), name, Global.Path.bin)
  const executable = path.join(Global.Path.bin, `texlab${globalThis.process.platform === "win32" ? ".exe" : ""}`)
  if (!existsSync(executable)) throw new Error("LSP server texlab archive has no executable")
  if (globalThis.process.platform !== "win32") await chmod(executable, 0o755)
  return { executable, args: [] }
}

async function tinymistLaunch(downloads: boolean) {
  if (!downloads) return
  if (!["x64", "arm64"].includes(globalThis.process.arch) || !["linux", "darwin", "win32"].includes(globalThis.process.platform))
    throw new Error(`LSP server tinymist does not support ${globalThis.process.platform}-${globalThis.process.arch}`)
  const arch = globalThis.process.arch === "arm64" ? "aarch64" : "x86_64"
  const platform = globalThis.process.platform === "darwin" ? "apple-darwin" : globalThis.process.platform === "win32" ? "pc-windows-msvc" : "unknown-linux-gnu"
  const name = `tinymist-${arch}-${platform}.${globalThis.process.platform === "win32" ? "zip" : "tar.gz"}`
  await unpack(await githubAsset("Myriad-Dreamin/tinymist", name), name, Global.Path.bin, globalThis.process.platform === "win32" ? 0 : 1)
  const executable = path.join(Global.Path.bin, `tinymist${globalThis.process.platform === "win32" ? ".exe" : ""}`)
  if (!existsSync(executable)) throw new Error("LSP server tinymist archive has no executable")
  if (globalThis.process.platform !== "win32") await chmod(executable, 0o755)
  return { executable, args: [] }
}

async function githubAsset(repository: string, name: string) {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`)
  if (!response.ok) throw new Error(`LSP server ${repository} release lookup failed: HTTP ${response.status}`)
  const release: unknown = await response.json()
  const assets = typeof release === "object" && release !== null && "assets" in release && Array.isArray(release.assets)
    ? release.assets as unknown[] : []
  const asset = assets.find((item) => typeof item === "object" && item !== null && "name" in item && item.name === name)
  const url = typeof asset === "object" && asset !== null && "browser_download_url" in asset && typeof asset.browser_download_url === "string"
    ? asset.browser_download_url : undefined
  if (!url) throw new Error(`LSP server ${repository} release has no ${name} asset`)
  return url
}

async function unpack(url: string, name: string, directory: string, strip = 0) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`LSP server download failed: HTTP ${response.status}`)
  await mkdir(directory, { recursive: true })
  const archive = path.join(directory, name)
  await Bun.write(archive, await response.bytes())
  const command = name.endsWith(".zip")
    ? globalThis.process.platform === "win32"
      ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${directory.replaceAll("'", "''")}' -Force`]
      : ["unzip", "-o", archive, "-d", directory]
    : ["tar", name.endsWith(".tar.gz") ? "-xzf" : "-xf", name, ...(strip ? [`--strip-components=${strip}`] : [])]
  const extraction = Bun.spawn(command, { cwd: directory, stdout: "ignore", stderr: "pipe" })
  const [code, error] = await Promise.all([extraction.exited, new Response(extraction.stderr).text()])
  await rm(archive, { force: true })
  if (code !== 0) throw new Error(`LSP server archive ${name} extraction failed: ${error.trim()}`)
}

async function javaLaunch(downloads: boolean) {
  const java = which("java")
  if (!java) throw new Error("LSP server jdtls requires Java 21 or newer")
  const version = Bun.spawn([java, "-version"], { stdout: "ignore", stderr: "pipe" })
  const output = await new Response(version.stderr).text()
  const major = Number(output.match(/version "(\d+)/)?.[1])
  if ((await version.exited) !== 0 || !Number.isFinite(major) || major < 21)
    throw new Error("LSP server jdtls requires Java 21 or newer")
  const dist = path.join(Global.Path.bin, "jdtls")
  const plugins = path.join(dist, "plugins")
  if (!existsSync(plugins)) {
    if (!downloads) throw new Error("LSP server jdtls is not installed")
    await mkdir(dist, { recursive: true })
    const response = await fetch("https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz")
    if (!response.ok) throw new Error(`LSP server jdtls download failed: HTTP ${response.status}`)
    const archive = path.join(dist, "release.tar.gz")
    await Bun.write(archive, await response.bytes())
    const extraction = Bun.spawn(["tar", "-xzf", path.basename(archive)], { cwd: dist, stdout: "ignore", stderr: "pipe" })
    const [code, error] = await Promise.all([extraction.exited, new Response(extraction.stderr).text()])
    await rm(archive, { force: true })
    if (code !== 0) throw new Error(`LSP server jdtls extraction failed: ${error.trim()}`)
  }
  const launcher = (await readdir(plugins)).find((name) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(name))
  if (!launcher) throw new Error("LSP server jdtls launcher is missing")
  const config = path.join(dist, globalThis.process.platform === "darwin" ? "config_mac" : globalThis.process.platform === "win32" ? "config_win" : "config_linux")
  const data = await mkdtemp(path.join(os.tmpdir(), "opencode-jdtls-data-"))
  return {
    executable: java,
    args: ["-Declipse.application=org.eclipse.jdt.ls.core.id1", "-Dosgi.bundles.defaultStartLevel=4",
      "-Declipse.product=org.eclipse.jdt.ls.core.product", "-Dlog.level=ALL", "--add-modules=ALL-SYSTEM",
      "--add-opens", "java.base/java.util=ALL-UNNAMED", "--add-opens", "java.base/java.lang=ALL-UNNAMED",
      "-jar", path.join(plugins, launcher), "-configuration", config, "-data", data],
  }
}

function kotlinLauncher() {
  return path.join(Global.Path.bin, "kotlin-ls", globalThis.process.platform === "win32" ? "kotlin-lsp.cmd" : "kotlin-lsp.sh")
}

async function kotlinLaunch(downloads: boolean) {
  const launcher = kotlinLauncher()
  if (existsSync(launcher)) return { executable: launcher, args: ["--stdio"] }
  if (!downloads) throw new Error("LSP server kotlin-ls is not installed")
  const response = await fetch("https://api.github.com/repos/Kotlin/kotlin-lsp/releases/latest")
  if (!response.ok) throw new Error(`LSP server kotlin-ls release lookup failed: HTTP ${response.status}`)
  const release: unknown = await response.json()
  const version = typeof release === "object" && release !== null && "name" in release && typeof release.name === "string"
    ? release.name.replace(/^v/, "") : undefined
  if (!version) throw new Error("LSP server kotlin-ls release has no version")
  const platform = globalThis.process.platform === "darwin" ? "mac" : globalThis.process.platform === "win32" ? "win" : globalThis.process.platform
  const arch = globalThis.process.arch === "arm64" ? "aarch64" : globalThis.process.arch
  if (!["mac-x64", "mac-aarch64", "linux-x64", "linux-aarch64", "win-x64", "win-aarch64"].includes(`${platform}-${arch}`))
    throw new Error(`LSP server kotlin-ls does not support ${platform}-${arch}`)
  const dist = path.dirname(launcher)
  await mkdir(dist, { recursive: true })
  const archive = path.join(dist, "kotlin-ls.zip")
  const download = await fetch(`https://download-cdn.jetbrains.com/kotlin-lsp/${version}/kotlin-lsp-${version}-${platform}-${arch}.zip`)
  if (!download.ok) throw new Error(`LSP server kotlin-ls download failed: HTTP ${download.status}`)
  await Bun.write(archive, await download.bytes())
  const command = globalThis.process.platform === "win32"
    ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${dist.replaceAll("'", "''")}' -Force`]
    : ["unzip", "-o", archive, "-d", dist]
  const extraction = Bun.spawn(command, { stdout: "ignore", stderr: "pipe" })
  const [code, error] = await Promise.all([extraction.exited, new Response(extraction.stderr).text()])
  await rm(archive, { force: true })
  if (code !== 0 || !existsSync(launcher)) throw new Error(`LSP server kotlin-ls extraction failed: ${error.trim()}`)
  if (globalThis.process.platform !== "win32") await chmod(launcher, 0o755)
  return { executable: launcher, args: ["--stdio"] }
}
