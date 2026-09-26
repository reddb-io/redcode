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
    { id: "gopls", command: ["gopls"], extensions: [".go"], root: nearest(["go.work", "go.mod", "go.sum"]) },
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
    { id: "kotlin-ls", command: ["kotlin-lsp", "--stdio"], extensions: [".kt", ".kts"], root: nearest(["settings.gradle.kts", "settings.gradle", "gradlew", "gradlew.bat", "build.gradle.kts", "build.gradle", "pom.xml"]) },
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
  if (server.id === "sourcekit-lsp" && server.command[0] === "sourcekit-lsp" && !resolveCommand(server, root, directory))
    return !!which("xcrun")
  if (server.id === "jdtls" && server.command[0] === "java")
    return !!which("java") && (existsSync(path.join(Global.Path.bin, "jdtls", "plugins")) || downloads)
  if (server.id === "kotlin-ls" && server.command[0] === "kotlin-lsp")
    return !!resolveCommand(server, root, directory) || existsSync(kotlinLauncher()) || downloads
  if (!resolveCommand(server, root, directory) && !(downloads && (server.download || isRoslyn(server) && which("dotnet")))) return false
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
  return which(command, { PATH: [...bins, globalThis.process.env.PATH ?? ""].join(path.delimiter) })
    ?? (server.id === "ty" && command === "ty" ? [globalThis.process.env.VIRTUAL_ENV, path.join(root, ".venv"), path.join(root, "venv")]
      .filter((value): value is string => value !== undefined)
      .map((venv) => path.join(venv, globalThis.process.platform === "win32" ? "Scripts/ty.exe" : "bin/ty"))
      .find((candidate) => existsSync(candidate)) : undefined)
    ?? (isRoslyn(server) ? roslynGlobalPath() : undefined)
}

function isRoslyn(server: Info) {
  return (server.id === "csharp" || server.id === "razor") && server.command[0] === "roslyn-language-server"
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

async function javaRoot(file: string, directory: string) {
  const wrapper = await nearest(["gradlew", "gradlew.bat"], { strict: true, exclude: ["settings.gradle", "settings.gradle.kts"] })(file, directory)
  if (wrapper) return wrapper
  const gradle = await nearest(["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"], { strict: true })(file, directory)
  if (gradle) return gradle
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
  const specialized = server.id === "jdtls" && server.command[0] === "java"
    ? await javaLaunch(downloads)
    : server.id === "kotlin-ls" && server.command[0] === "kotlin-lsp" && !resolveCommand(server, root, directory)
      ? await kotlinLaunch(downloads)
      : server.id === "sourcekit-lsp" && server.command[0] === "sourcekit-lsp" && !resolveCommand(server, root, directory)
        ? await sourcekitLaunch()
      : undefined
  const executable = resolveCommand(server, root, directory)
    ?? specialized?.executable
    ?? (isRoslyn(server) ? await installRoslyn(downloads) : undefined)
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

async function sourcekitLaunch() {
  const xcrun = which("xcrun")
  if (!xcrun) return
  const child = Bun.spawn([xcrun, "--find", "sourcekit-lsp"], { stdout: "pipe", stderr: "ignore" })
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
  const executable = output.trim()
  return code === 0 && executable ? { executable, args: [] } : undefined
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
