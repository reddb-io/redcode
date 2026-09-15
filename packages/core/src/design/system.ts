export * as DesignSystem from "./system"

import path from "node:path"
import { Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignFiles } from "./files"
import { DesignInventory } from "./inventory"
import { DesignManifest } from "./manifest"

/** Bun's glob scanner cannot expand a brace containing both root files and recursive paths. */
const PATTERNS = [
  "{PRODUCT.md,product.md,DESIGN.md,design.md,design-system.md,tailwind.config.*,postcss.config.*,components.json,package.json}",
  ".red/{PRODUCT.md,product.md,DESIGN.md,design.md}",
  ".agents/context/{PRODUCT.md,product.md,DESIGN.md,design.md}",
  "docs/{PRODUCT.md,product.md,DESIGN.md,design.md}",
  ".storybook/main.*",
  "src/**/{tokens.css,tokens.ts,tokens.json,theme.css,theme.ts,global.css,globals.css}",
  "src/components/index.*",
  "src/design-system/**/index.*",
  "packages/*/src/index.*",
  "src/**/*.stories.*",
  "packages/*/src/**/*.stories.*",
  "stories/**/*.stories.*",
]
const LIMIT = 60
const EXCERPTS = 20
const EXCERPT = 12000
/** Only the dependencies that tell the stack apart are recorded; the rest of package.json never leaves the project. */
const DEPENDENCY =
  /^(?:react|react-dom|solid-js|vue|svelte|next|nuxt|@angular\/core|tailwindcss|@tailwindcss\/.+|postcss|autoprefixer|storybook|@storybook\/.+|@radix-ui\/.+|@mui\/.+|@chakra-ui\/.+|@emotion\/.+|styled-components|@vanilla-extract\/.+|class-variance-authority|tailwind-merge|tailwind-variants|lucide-react|shadcn(?:-ui)?|@shadcn\/.+)$/
const FRAMEWORKS = ["react", "solid-js", "vue", "svelte", "next", "nuxt", "@angular/core"]
const Dependencies = Schema.Record(Schema.String, Schema.String).pipe(Schema.optionalKey)
const decodePackage = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ dependencies: Dependencies, devDependencies: Dependencies, peerDependencies: Dependencies }),
  ),
)
/** A lenient read of the configured system that design-system-config records on Design.Info; absent until it lands. */
const decodeConfigured = Schema.decodeUnknownOption(
  Schema.Struct({
    paths: Schema.Array(Schema.String).pipe(Schema.optionalKey),
    css: Schema.Array(Schema.String).pipe(Schema.optionalKey),
    tailwind: Schema.Boolean.pipe(Schema.optionalKey),
    framework: Schema.String.pipe(Schema.optionalKey),
    aliases: Schema.Record(Schema.String, Schema.String).pipe(Schema.optionalKey),
  }),
)

export type Kind =
  | "manifest"
  | "doc"
  | "tailwind"
  | "postcss"
  | "shadcn"
  | "storybook"
  | "package"
  | "tokens"
  | "components"
  | "story"
/** Excerpt budget order: configuration first so stack() always sees it, stories last and never excerpted. */
const TIER: Record<Kind, number> = {
  tailwind: 0,
  postcss: 0,
  shadcn: 0,
  storybook: 0,
  package: 0,
  manifest: 1,
  doc: 1,
  tokens: 2,
  components: 3,
  story: 4,
}

type Source = typeof Design.Source.Type
/** Encoded or decoded documents both render: only the discovery fields are read. */
type Document = {
  readonly sources: readonly Source[]
  readonly inventory?: readonly Design.Component[]
  readonly manifest?: string
  readonly system?: unknown
}

export function classify(file: string): Kind {
  const name = path.basename(file)
  if (/\.stories\.[^/]+$/.test(name)) return "story"
  if (file === DesignManifest.FILE) return "manifest"
  if (/^(?:product|design|design-system)\.md$/i.test(name)) return "doc"
  if (name.startsWith("tailwind.config.")) return "tailwind"
  if (name.startsWith("postcss.config.")) return "postcss"
  if (name === "components.json") return "shadcn"
  if (name === "package.json") return "package"
  if (file.startsWith(".storybook/")) return "storybook"
  if (/^index\.[^/]+$/.test(name)) return "components"
  return "tokens"
}

/** File hashes are provenance, not a claim that inferred tokens are authoritative. */
export async function discover(application: string) {
  const files = (
    await Promise.all(
      PATTERNS.map((pattern) =>
        Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: application, onlyFiles: true, followSymlinks: false })),
      ),
    )
  )
    .flat()
    .map((file) => file.split(path.sep).join("/"))
    .sort()
    .toSorted((a, b) => TIER[classify(a)] - TIER[classify(b)])
  return (
    await Promise.all(
      files.map(async (file, index) => {
        const bytes = await Bun.file(await DesignFiles.resolve(application, file)).bytes()
        const kind = classify(file)
        const text = new TextDecoder().decode(bytes)
        const excerpt =
          kind === "story" || index >= EXCERPTS
            ? ""
            : kind === "package"
              ? dependencies(text)
              : new TextDecoder().decode(bytes.subarray(0, EXCERPT))
        if (kind === "package" && !excerpt) return []
        return [
          {
            file,
            hash: DesignFiles.hash(bytes),
            observed: Date.now(),
            // A generated manifest is inferred from the files it lists; only a hand-written one is a source of truth.
            authoritative: kind === "doc" || (kind === "manifest" && !text.includes(DesignManifest.START)),
            excerpt,
          },
        ]
      }),
    )
  )
    .flat()
    .slice(0, LIMIT)
}

function dependencies(text: string) {
  const parsed = decodePackage(text)
  if (parsed._tag === "None") return ""
  return Object.entries({
    ...parsed.value.peerDependencies,
    ...parsed.value.devDependencies,
    ...parsed.value.dependencies,
  })
    .filter(([name]) => DEPENDENCY.test(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, version]) => `${name} ${version}`)
    .join("\n")
}

/** Component roots: declared paths plus the directories whose index file discovery found, outermost only. */
export function roots(sources: readonly Source[], declared: readonly string[] = []) {
  const all = [
    ...declared.map((entry) => path.posix.normalize(entry.split(path.sep).join("/")).replace(/\/+$/, "")),
    ...sources
      .filter((source) => classify(source.file) === "components")
      .map((source) => path.posix.dirname(source.file)),
  ]
    .filter((root) => root && root !== "." && !root.startsWith("..") && !path.posix.isAbsolute(root))
    .toSorted()
  return all.filter(
    (root, index) => all.indexOf(root) === index && !all.slice(0, index).some((outer) => root.startsWith(outer + "/")),
  )
}

/** Stack facts read from discovery alone: framework and CSS pipeline, as short labels. */
export function stack(sources: readonly Source[]) {
  const deps = sources
    .filter((source) => classify(source.file) === "package")
    .flatMap((source) => source.excerpt.split("\n"))
    .filter(Boolean)
  const framework = FRAMEWORKS.find((name) => deps.some((line) => line.startsWith(name + " ")))
  const named = (kind: Kind) => sources.filter((source) => classify(source.file) === kind).map((source) => source.file)
  const variables = sources.filter(
    (source) => classify(source.file) === "tokens" && source.file.endsWith(".css") && source.excerpt.includes("--"),
  )
  return {
    framework: framework ? deps.find((line) => line.startsWith(framework + " ")) : undefined,
    dependencies: deps,
    pipeline: [
      ...named("tailwind").map((file) => `Tailwind (${file})`),
      ...named("postcss").map((file) => `PostCSS (${file})`),
      ...named("shadcn").map((file) => `shadcn (${file})`),
      ...named("storybook").map((file) => `Storybook (${file})`),
      ...(variables.length ? [`CSS custom properties (${variables.map((source) => source.file).join(", ")})`] : []),
    ],
    tokens: named("tokens"),
  }
}

export const configured = (document: object) => {
  const parsed = decodeConfigured("system" in document ? document.system : undefined)
  return parsed._tag === "Some" ? parsed.value : undefined
}
export const declared = (document: object) => configured(document)?.paths ?? []

/**
 * Discovery, the component inventory and the manifest, in the order the manifest needs them. The
 * manifest is only written for an existing application whose scan found something to record.
 */
export async function load(
  application: string,
  options: { readonly refresh: boolean; readonly manifest: boolean; readonly declared?: readonly string[] },
) {
  const discovered = await discover(application)
  const found = roots(discovered, options.declared)
  const inventory = await DesignInventory.scan(application, found)
  const facts = stack(discovered)
  const present = facts.tokens.length > 0 || facts.pipeline.length > 0 || inventory.length > 0
  if (!options.manifest || !present)
    return {
      sources: discovered,
      inventory,
      manifest: options.manifest ? `${DesignManifest.FILE} not generated: nothing found to record` : "",
    }
  const result = await DesignManifest.write(
    application,
    {
      stack: [
        `Framework: ${facts.framework ?? "not declared in package.json"}`,
        `CSS pipeline: ${facts.pipeline.join(", ") || "plain CSS (no Tailwind, PostCSS or shadcn configuration found)"}`,
        ...(facts.dependencies.length ? [`Dependencies: ${facts.dependencies.join(", ")}`] : []),
      ],
      tokens: facts.tokens,
      roots: found.filter((root) => inventory.some((entry) => entry.root === root)),
      inventory,
    },
    options.refresh,
  )
  const written = result.status === "created" || result.status === "updated"
  return {
    sources: written ? await discover(application) : discovered,
    inventory,
    manifest:
      result.status === "kept"
        ? `${DesignManifest.FILE} kept as is: ${result.reason}`
        : result.status === "created"
          ? `generated ${DesignManifest.FILE}`
          : result.status === "updated"
            ? `refreshed the generated block in ${DesignManifest.FILE}`
            : "",
  }
}

/** The model-visible block: paths and counts only, never file content. Both runtimes render exactly this. */
export function describe(document: Document) {
  const docs = document.sources.filter((source) => source.authoritative).map((source) => source.file)
  const manifest = document.sources.find((source) => classify(source.file) === "manifest" && !source.authoritative)
  const facts = stack(document.sources)
  const inventory = document.inventory ?? []
  const stories = document.sources.filter((source) => classify(source.file) === "story").length
  const system = configured(document)
  if (!docs.length && !manifest && !facts.tokens.length && !facts.pipeline.length && !inventory.length && !system)
    return "Design system: none detected. Say so in designSystem and design from the brief; do not assume a component library."
  return [
    "Design system (import from the component roots instead of re-implementing; take colors, type and spacing from the token files; write new CSS only for what the system lacks):",
    ...(manifest
      ? [`Manifest: ${manifest.file} (generated from the files below; read it first, edit only its Notes)`]
      : []),
    ...(document.manifest ? [`Manifest status: ${document.manifest}`] : []),
    ...(docs.length ? [`Docs: ${docs.join(", ")} (authoritative; read with the read tool before designing)`] : []),
    ...(facts.tokens.length ? [`Tokens: ${facts.tokens.join(", ")}`] : []),
    ...(facts.pipeline.length ? [`Pipeline: ${facts.pipeline.join("; ")}`] : []),
    ...(facts.framework ? [`Framework: ${facts.framework}`] : []),
    ...[...new Set(inventory.map((entry) => entry.root))].toSorted().map((root) => {
      const names = inventory.filter((entry) => entry.root === root).map((entry) => entry.name)
      return `Components ${root}: ${names.slice(0, 40).join(", ")}${names.length > 40 ? ` (+${names.length - 40} more)` : ""}`
    }),
    ...(stories ? [`Stories: ${stories} files`] : []),
    ...(system
      ? [
          `Configured: paths ${system.paths?.join(", ") || "none"}; css ${system.css?.join(", ") || "none"}; tailwind ${system.tailwind === undefined ? "auto" : system.tailwind ? "on" : "off"}${system.framework ? `; framework ${system.framework}` : ""}${
            system.aliases && Object.keys(system.aliases).length
              ? `; aliases ${Object.entries(system.aliases)
                  .map(([find, target]) => `${find} → ${target}`)
                  .join(", ")}`
              : ""
          }`,
          "Configured design system: import components from the configured paths and include the configured stylesheets instead of recreating them.",
        ]
      : []),
  ].join("\n")
}

/** Paths and counts only: what a list and the Design Context Source carry on every turn. */
export function summary(document: Document) {
  const docs = document.sources.filter((source) => source.authoritative).map((source) => source.file)
  const manifest = document.sources.find((source) => classify(source.file) === "manifest" && !source.authoritative)
  const tokens = stack(document.sources).tokens.length
  const inventory = document.inventory ?? []
  if (!docs.length && !manifest && !tokens && !inventory.length) return ""
  return [
    ...(manifest ? [`manifest ${manifest.file}`] : []),
    ...(docs.length ? [`docs ${docs.join(", ")}`] : []),
    ...(tokens ? [`${tokens} token file${tokens === 1 ? "" : "s"}`] : []),
    ...(inventory.length
      ? [
          `${inventory.length} components in ${[...new Set(inventory.map((entry) => entry.root))].toSorted().join(", ")}`,
        ]
      : []),
  ].join("; ")
}
