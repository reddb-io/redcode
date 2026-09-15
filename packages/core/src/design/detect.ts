export * as DesignDetect from "./detect"

import path from "node:path"
import { lstat } from "node:fs/promises"
import { parse } from "jsonc-parser"

/**
 * Proposes a `design.system` configuration from the project's files. Reads are static: package.json,
 * tsconfig, components.json and stylesheets are parsed as text and no project code (tailwind.config.*,
 * postcss.config.*, vite.config.*) is ever loaded or executed.
 */

export interface Field {
  /** 0..1: how sure the heuristic is that the proposed value is what the design should reuse. */
  readonly confidence: number
  readonly evidence: readonly string[]
}

export interface System {
  readonly paths: readonly string[]
  readonly css?: readonly string[]
  readonly tailwind?: boolean
  readonly framework?: "react" | "solid"
  readonly aliases?: Readonly<Record<string, string>>
}

export interface Proposal {
  /** Project-relative directory of the application package the design targets; "." for the project itself. */
  readonly application: string
  /** The `design.system` section to write; every path is relative to `application`. */
  readonly system: System
  /** The detected framework, including one previews cannot build (vue), which is then left out of `system`. */
  readonly framework?: "react" | "solid" | "vue"
  readonly tailwind?: { readonly version?: 3 | 4; readonly config?: string }
  readonly fields: {
    readonly application: Field
    readonly paths: Field
    readonly css: Field
    readonly tailwind: Field
    readonly framework: Field
    readonly aliases: Field
  }
  /** Mean confidence of the fields that carry a value. */
  readonly confidence: number
}

type Dependencies = Record<string, string>
type Manifest = { readonly name?: string; readonly dependencies: Dependencies; readonly workspaces: readonly string[] }

const TEXT_LIMIT = 256 * 1024
const COMPONENT_ROOTS = ["src/components", "src/design-system", "src/ui", "components", "app/components"]
const MONOREPO_ROOTS = ["packages/ui/src", "packages/design-system/src"]
const CSS_DIRECTORIES = ["", "src/", "app/", "src/app/", "src/styles/", "styles/", "src/assets/", "assets/css/"]
const CSS_NAMES = ["globals", "global", "index", "app", "main", "styles", "style", "tailwind"]
const APP_DEPENDENCIES =
  /^(?:next|nuxt|vite|react-scripts|astro|@solidjs\/start|vite-plugin-solid|@vitejs\/plugin-.+|@remix-run\/.+|@tanstack\/(?:react|solid)-start|expo|gatsby)$/
const APP_FILES = ["index.html", "app", "pages", "src/app", "src/pages", "src/main.tsx", "src/main.jsx", "src/main.ts"]
const COMPONENT_FILE = /\.(?:tsx|jsx|vue|svelte)$/

const posix = (file: string) => file.split(path.sep).join("/")
const clean = (file: string) => path.posix.normalize(posix(file)).replace(/^\.\//, "").replace(/\/+$/, "") || "."
const percent = (value: number) => `${Math.round(value * 100)}%`

async function kind(file: string) {
  // A symlink could lead outside the project; detection never follows one.
  const info = await lstat(file).catch(() => undefined)
  if (!info || info.isSymbolicLink()) return undefined
  return info.isDirectory() ? "directory" : info.isFile() ? "file" : undefined
}

async function text(file: string) {
  if ((await kind(file)) !== "file") return undefined
  const bytes = await Bun.file(file)
    .slice(0, TEXT_LIMIT)
    .text()
    .catch(() => undefined)
  return bytes
}

async function json(file: string): Promise<unknown> {
  const content = await text(file)
  if (content === undefined) return undefined
  return parse(content, [], { allowTrailingComma: true })
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

async function manifest(directory: string): Promise<Manifest | undefined> {
  const value = record(await json(path.join(directory, "package.json")))
  if (!value) return undefined
  const dependencies: Dependencies = {}
  for (const key of ["peerDependencies", "devDependencies", "dependencies"])
    for (const [name, version] of Object.entries(record(value[key]) ?? {}))
      if (typeof version === "string") dependencies[name] = version
  const workspaces = Array.isArray(value.workspaces)
    ? strings(value.workspaces)
    : strings(record(value.workspaces)?.packages)
  return { name: typeof value.name === "string" ? value.name : undefined, dependencies, workspaces }
}

async function pnpmWorkspaces(directory: string) {
  const content = await text(path.join(directory, "pnpm-workspace.yaml"))
  if (!content) return []
  const section = /^packages:\s*\n((?:\s+-.*\n?|\s*#.*\n?|\s*\n)*)/m.exec(content)?.[1] ?? ""
  return [...section.matchAll(/^\s+-\s*['"]?([^'"#\s]+)['"]?/gm)].map((match) => match[1]!)
}

function frameworks(dependencies: Dependencies) {
  return [
    ...("solid-js" in dependencies ? (["solid"] as const) : []),
    ...("vue" in dependencies || "nuxt" in dependencies ? (["vue"] as const) : []),
    ...("react" in dependencies || "next" in dependencies ? (["react"] as const) : []),
  ]
}

async function markers(directory: string, dependencies: Dependencies) {
  const files = await Promise.all(
    APP_FILES.map(async (file) => ((await kind(path.join(directory, file))) ? [file] : [])),
  )
  return [...Object.keys(dependencies).filter((name) => APP_DEPENDENCIES.test(name)), ...files.flat()]
}

async function hasComponents(directory: string) {
  if ((await kind(directory)) !== "directory") return false
  const scan = new Bun.Glob("**/*").scan({ cwd: directory, onlyFiles: true, followSymlinks: false })
  let seen = 0
  for await (const file of scan) {
    if (file.split(/[\\/]/).includes("node_modules")) continue
    if (COMPONENT_FILE.test(file)) return true
    if (++seen > 2000) return false
  }
  return false
}

interface Candidate {
  readonly application: string
  readonly manifest: Manifest
  readonly markers: readonly string[]
  readonly score: number
}

async function candidate(root: string, application: string): Promise<Candidate | undefined> {
  const directory = path.join(root, application)
  const pkg = await manifest(directory)
  if (!pkg || frameworks(pkg.dependencies).length === 0) return undefined
  const found = await markers(directory, pkg.dependencies)
  const components = (
    await Promise.all(COMPONENT_ROOTS.map((entry) => hasComponents(path.join(directory, entry))))
  ).some(Boolean)
  const score =
    (found.length ? 10 : 0) +
    (application.startsWith("apps/") ? 3 : 0) +
    (components ? 2 : 0) +
    ("tailwindcss" in pkg.dependencies ? 1 : 0)
  return { application, manifest: pkg, markers: found, score }
}

/** Workspace package directories declared by package.json `workspaces` or pnpm-workspace.yaml. */
async function packages(root: string, patterns: readonly string[]) {
  const found = await Promise.all(
    patterns
      .filter((pattern) => !pattern.startsWith("!") && !pattern.includes(".."))
      .map((pattern) =>
        Array.fromAsync(
          new Bun.Glob(`${clean(pattern)}/package.json`).scan({ cwd: root, onlyFiles: true, followSymlinks: false }),
        ).catch(() => [] as string[]),
      ),
  )
  return [
    ...new Set(
      found
        .flat()
        .map((file) => clean(path.posix.dirname(posix(file))))
        .filter((dir) => dir !== "." && !dir.split("/").includes("node_modules")),
    ),
  ].toSorted()
}

async function application(root: string, hint?: string) {
  if (hint !== undefined) {
    const named = clean(hint)
    const pkg = (await manifest(path.join(root, named))) ?? { dependencies: {}, workspaces: [] }
    return {
      application: named,
      manifest: pkg,
      field: { confidence: 1, evidence: [`named by the design (${named})`] },
      workspace: [] as string[],
    }
  }
  const rootManifest = await manifest(root)
  const patterns = [...(rootManifest?.workspaces ?? []), ...(await pnpmWorkspaces(root))]
  const self = await candidate(root, ".")
  if (!patterns.length) {
    if (!rootManifest) return undefined
    return {
      application: ".",
      manifest: rootManifest,
      field: {
        confidence: self ? 0.95 : 0.6,
        evidence: [
          self
            ? "single package: package.json declares a UI framework"
            : "single package without a UI framework dependency",
        ],
      },
      workspace: [] as string[],
    }
  }
  const workspace = await packages(root, patterns)
  const ranked = (
    await Promise.all([...(self && self.markers.length ? [self] : []), ...workspace.map((dir) => candidate(root, dir))])
  )
    .filter((item): item is Candidate => item !== undefined)
    .toSorted((a, b) => b.score - a.score || a.application.localeCompare(b.application))
  const best = ranked[0]
  if (!best) return undefined
  const tied = ranked.filter((item) => item.score === best.score).length > 1
  const confidence = best.markers.length ? (tied ? 0.55 : 0.85) : tied ? 0.35 : 0.5
  return {
    application: best.application,
    manifest: best.manifest,
    field: {
      confidence,
      evidence: [
        `monorepo with ${workspace.length} workspace package${workspace.length === 1 ? "" : "s"} (${patterns.join(", ")})`,
        best.markers.length
          ? `${best.application} is an application (${best.markers.join(", ")})`
          : `${best.application} declares a UI framework but no application entry; no application package found`,
        ...(tied
          ? [
              `tied with ${ranked
                .filter((item) => item !== best && item.score === best.score)
                .map((item) => item.application)
                .join(", ")}; picked by path order`,
            ]
          : []),
        ...ranked
          .slice(1)
          .filter((item) => item.score !== best.score)
          .map((item) => `also considered ${item.application}`),
      ],
    },
    workspace,
  }
}

interface Tsconfig {
  readonly file: string
  readonly paths: Record<string, string>
}

/** tsconfig paths as prefix aliases relative to the application, per file, following one local `extends`. */
async function tsconfigs(directory: string) {
  const read = async (file: string, seen: Set<string>): Promise<Tsconfig[]> => {
    if (seen.has(file)) return []
    seen.add(file)
    const value = record(await json(path.join(directory, file)))
    if (!value) return []
    const options = record(value.compilerOptions)
    const base = path.posix.dirname(file)
    const paths: Record<string, string> = {}
    for (const [key, targets] of Object.entries(record(options?.paths) ?? {})) {
      const first = strings(targets)[0]
      if (!first) continue
      const target = clean(
        path.posix.join(base, typeof options?.baseUrl === "string" ? options.baseUrl : ".", first.replace(/\/\*$/, "")),
      )
      if (target.startsWith("..") || path.posix.isAbsolute(target)) continue
      paths[key.replace(/\/\*$/, "")] = target
    }
    const parent =
      typeof value.extends === "string" && value.extends.startsWith(".")
        ? clean(path.posix.join(base, value.extends.endsWith(".json") ? value.extends : `${value.extends}.json`))
        : undefined
    return [{ file, paths }, ...(parent && !parent.startsWith("..") ? await read(parent, seen) : [])]
  }
  const seen = new Set<string>()
  return [...(await read("tsconfig.json", seen)), ...(await read("tsconfig.app.json", seen))]
}

function viaAlias(specifier: string, configs: readonly Tsconfig[]) {
  for (const config of configs)
    for (const [find, target] of Object.entries(config.paths).toSorted((a, b) => b[0].length - a[0].length))
      if (specifier === find || specifier.startsWith(find + "/"))
        return clean(path.posix.join(target, specifier.slice(find.length)))
  return undefined
}

const TAILWIND_V4 = /@import\s+(?:url\()?["']tailwindcss(?:\/[^"']*)?["']/
const TAILWIND_V3 = /@tailwind\s+(?:base|components|utilities)\b/

export async function detect(
  root: string,
  options: { readonly application?: string } = {},
): Promise<Proposal | undefined> {
  const target = await application(root, options.application)
  if (!target) return undefined
  const directory = path.join(root, target.application)
  if ((await kind(directory)) !== "directory") return undefined
  const dependencies = target.manifest.dependencies
  const rootDependencies = target.application === "." ? {} : ((await manifest(root))?.dependencies ?? {})
  const configs = await tsconfigs(directory)
  const shadcn = record(await json(path.join(directory, "components.json")))

  // Component roots
  const roots = new Map<string, { confidence: number; evidence: string }>()
  const shadcnAliases = record(shadcn?.aliases)
  for (const key of ["components", "ui"]) {
    const alias = shadcnAliases?.[key]
    if (typeof alias !== "string") continue
    const resolved = viaAlias(alias, configs)
    if (!resolved || resolved === ".") continue
    if ((await kind(path.join(directory, resolved))) !== "directory") continue
    roots.set(resolved, { confidence: 0.95, evidence: `components.json aliases.${key} ${alias} → ${resolved}` })
  }
  for (const entry of [...COMPONENT_ROOTS, ...(target.application === "." ? MONOREPO_ROOTS : [])]) {
    if (roots.has(entry) || !(await hasComponents(path.join(directory, entry)))) continue
    roots.set(entry, {
      confidence: entry === "components" || entry === "app/components" ? 0.7 : 0.8,
      evidence: `${entry} holds component files`,
    })
  }
  const outermost = [...roots.keys()]
    .toSorted()
    .filter((entry, _, all) => !all.some((outer) => outer !== entry && entry.startsWith(outer + "/")))
  const paths = outermost
  const workspaceNotes = (
    await Promise.all(
      target.workspace
        .filter((dir) => dir !== target.application && /(?:^|\/)(?:ui|design-system|components)$/.test(dir))
        .map(async (dir) => ((await hasComponents(path.join(root, dir, "src"))) ? [`${dir}/src`] : [])),
    )
  ).flat()
  const pathsField: Field = {
    confidence: paths.length ? Math.max(...paths.map((entry) => roots.get(entry)!.confidence)) : 0,
    evidence: [
      ...[...roots.values()].map((item) => item.evidence),
      ...(roots.size > paths.length ? [`kept the outermost roots: ${paths.join(", ")}`] : []),
      ...workspaceNotes.map(
        (dir) =>
          `${dir} is a workspace package outside ${target.application}; design.system.paths cannot leave the application, so previews reach it only through node_modules`,
      ),
      ...(paths.length ? [] : ["no component directory found"]),
    ],
  }

  // Stylesheet entry
  const stylesheets: { file: string; score: number; evidence: string; content: string }[] = []
  const shadcnCss = record(shadcn?.tailwind)?.css
  const cssCandidates = [
    ...(typeof shadcnCss === "string" ? [clean(shadcnCss)] : []),
    ...CSS_DIRECTORIES.flatMap((dir) => CSS_NAMES.map((name) => `${dir}${name}.css`)),
  ]
  for (const file of [...new Set(cssCandidates)]) {
    if (file.startsWith("..")) continue
    const content = await text(path.join(directory, file))
    if (content === undefined) continue
    const name = path.posix.basename(file, ".css")
    const [score, evidence] =
      typeof shadcnCss === "string" && clean(shadcnCss) === file
        ? [0.95, `components.json tailwind.css names ${file}`]
        : TAILWIND_V4.test(content)
          ? [0.9, `${file} imports tailwindcss`]
          : TAILWIND_V3.test(content)
            ? [0.9, `${file} holds the @tailwind directives`]
            : name === "globals" || name === "global"
              ? [0.7, `${file} is a global stylesheet`]
              : /:root\s*\{[^}]*--/.test(content)
                ? [0.6, `${file} defines CSS custom properties on :root`]
                : [0, ""]
    if (score > 0) stylesheets.push({ file, score, evidence, content })
  }
  const stylesheet = stylesheets.toSorted((a, b) => b.score - a.score)[0]
  const cssField: Field = {
    confidence: stylesheet?.score ?? 0,
    evidence: stylesheets.length
      ? [
          ...stylesheets.toSorted((a, b) => b.score - a.score).map((item) => item.evidence),
          ...(stylesheets.length > 1 ? [`picked ${stylesheet!.file}`] : []),
        ]
      : ["no global stylesheet found"],
  }

  // Tailwind
  const tailwindVersion = dependencies.tailwindcss ?? rootDependencies.tailwindcss
  const tailwindPlugin = Object.keys({ ...rootDependencies, ...dependencies }).find((name) =>
    /^@tailwindcss\/(?:postcss|vite|cli)$/.test(name),
  )
  const configFiles = await Promise.all(
    ["js", "cjs", "mjs", "ts", "cts", "mts"].map(async (extension) =>
      (await kind(path.join(directory, `tailwind.config.${extension}`))) === "file"
        ? [`tailwind.config.${extension}`]
        : [],
    ),
  )
  const tailwindConfig = configFiles.flat()[0]
  const cssFirst = stylesheets.find((item) => TAILWIND_V4.test(item.content))
  const directives = stylesheets.find((item) => TAILWIND_V3.test(item.content))
  const major = tailwindVersion ? /(\d+)/.exec(tailwindVersion)?.[1] : undefined
  const version: 3 | 4 | undefined =
    major === "4" || tailwindPlugin || cssFirst ? 4 : major === "3" || directives || tailwindConfig ? 3 : undefined
  const tailwind =
    tailwindVersion !== undefined &&
    (tailwindConfig !== undefined || cssFirst !== undefined || directives !== undefined || tailwindPlugin !== undefined)
  const tailwindField: Field = {
    confidence: tailwind ? 0.95 : tailwindVersion ? 0.5 : cssFirst || directives ? 0.5 : 0.9,
    evidence: [
      ...(tailwindVersion ? [`tailwindcss ${tailwindVersion} is a dependency`] : ["no tailwindcss dependency"]),
      ...(tailwindPlugin ? [`${tailwindPlugin} is a dependency`] : []),
      ...(tailwindConfig ? [`${tailwindConfig} exists (read as a file, never executed)`] : []),
      ...(cssFirst ? [`CSS-first configuration in ${cssFirst.file}`] : []),
      ...(directives ? [`@tailwind directives in ${directives.file}`] : []),
      ...(tailwindVersion && !tailwind ? ["no tailwind.config.* or tailwind import in a stylesheet"] : []),
    ],
  }

  // Framework
  const detected = frameworks(dependencies)
  const framework = detected[0]
  const frameworkField: Field = {
    confidence: detected.length === 1 ? 0.95 : detected.length > 1 ? 0.6 : 0,
    evidence: detected.length
      ? [
          `package.json declares ${detected.join(", ")}`,
          ...(framework === "vue" ? ["vue is not a preview engine; framework is left out of the configuration"] : []),
        ]
      : ["no react, solid-js or vue dependency"],
  }

  // Aliases the preview build would not read by itself: it reads only tsconfig.json compilerOptions.paths.
  const direct = configs.find((config) => config.file === "tsconfig.json")?.paths ?? {}
  const aliases: Record<string, string> = {}
  for (const config of configs)
    for (const [find, replacement] of Object.entries(config.paths))
      if (!(find in direct) && !(find in aliases)) aliases[find] = replacement
  const aliasEntries = configs.flatMap((config) =>
    Object.entries(config.paths).map(([find, replacement]) => `${config.file}: ${find} → ${replacement}`),
  )
  const aliasField: Field = {
    confidence: aliasEntries.length ? 0.9 : 0,
    evidence: aliasEntries.length
      ? [
          ...aliasEntries,
          ...(Object.keys(direct).length
            ? ["tsconfig.json paths are read by preview builds directly and are not repeated"]
            : []),
        ]
      : ["no tsconfig paths"],
  }

  if (!paths.length && !stylesheet && !tailwind) return undefined

  const system: System = {
    paths,
    ...(stylesheet ? { css: [stylesheet.file] } : {}),
    tailwind,
    ...(framework === "react" || framework === "solid" ? { framework } : {}),
    ...(Object.keys(aliases).length ? { aliases } : {}),
  }
  const weighted = [
    target.field.confidence,
    ...(paths.length ? [pathsField.confidence] : []),
    ...(stylesheet ? [cssField.confidence] : []),
    tailwindField.confidence,
    ...(framework ? [frameworkField.confidence] : []),
  ]
  return {
    application: target.application,
    system,
    ...(framework ? { framework } : {}),
    ...(tailwind || tailwindVersion
      ? { tailwind: { ...(version ? { version } : {}), ...(tailwindConfig ? { config: tailwindConfig } : {}) } }
      : {}),
    fields: {
      application: target.field,
      paths: pathsField,
      css: cssField,
      tailwind: tailwindField,
      framework: frameworkField,
      aliases: aliasField,
    },
    confidence: Math.round((weighted.reduce((sum, value) => sum + value, 0) / weighted.length) * 100) / 100,
  }
}

/** A short, human-readable summary with the confidence of each field. */
export function summary(proposal: Proposal) {
  const { system, fields } = proposal
  const tailwind = system.tailwind
    ? `yes${proposal.tailwind?.version ? ` (v${proposal.tailwind.version}${proposal.tailwind.version === 4 && !proposal.tailwind.config ? ", CSS-first" : ""})` : ""}${proposal.tailwind?.config ? `, ${proposal.tailwind.config}` : ""}`
    : "no"
  return [
    `Application: ${proposal.application === "." ? "project root" : proposal.application} (${percent(fields.application.confidence)})`,
    `Components: ${system.paths.join(", ") || "none found"}${system.paths.length ? ` (${percent(fields.paths.confidence)})` : ""}`,
    `Stylesheet: ${system.css?.join(", ") || "none found"}${system.css?.length ? ` (${percent(fields.css.confidence)})` : ""}`,
    `Tailwind: ${tailwind} (${percent(fields.tailwind.confidence)})`,
    `Framework: ${proposal.framework ?? "not detected"}${proposal.framework ? ` (${percent(fields.framework.confidence)})` : ""}`,
    ...(system.aliases
      ? [
          `Aliases: ${Object.entries(system.aliases)
            .map(([find, target]) => `${find} → ${target}`)
            .join(", ")} (${percent(fields.aliases.confidence)})`,
        ]
      : []),
    `Overall confidence: ${percent(proposal.confidence)}`,
  ].join("\n")
}
