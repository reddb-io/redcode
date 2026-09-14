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

/** PR design-system-config records the configured system on Design.Info; it is rendered when present so both changes compose. */
export interface Configured {
  readonly paths?: readonly string[]
  readonly css?: readonly string[]
  readonly tailwind?: boolean
}
type Source = typeof Design.Source.Type
/** Encoded or decoded documents both render: only the discovery fields are read. */
type Document = {
  readonly sources: readonly Source[]
  readonly inventory?: readonly Design.Component[]
  readonly system?: Configured
}

export function classify(file: string): Kind {
  const name = path.basename(file)
  if (/\.stories\.[^/]+$/.test(name)) return "story"
  if (file === ".red/DESIGN.md") return "manifest"
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
  // Stories are names only and sort last so a large Storybook cannot crowd out the files that carry excerpts.
  const ordered = [
    ...files.filter((file) => classify(file) !== "story"),
    ...files.filter((file) => classify(file) === "story"),
  ]
  return (
    await Promise.all(
      ordered.map(async (file, index) => {
        const bytes = await Bun.file(await DesignFiles.resolve(application, file)).bytes()
        const kind = classify(file)
        const excerpt =
          kind === "story" || index >= EXCERPTS
            ? ""
            : kind === "package"
              ? dependencies(new TextDecoder().decode(bytes))
              : new TextDecoder().decode(bytes.subarray(0, EXCERPT))
        if (kind === "package" && !excerpt) return []
        return [
          {
            file,
            hash: DesignFiles.hash(bytes),
            observed: Date.now(),
            authoritative: kind === "doc" || kind === "manifest",
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
    ...declared.map((entry) => entry.split(path.sep).join("/").replace(/\/+$/, "")),
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

export const declared = (document: Document) => document.system?.paths ?? []

/** Discovery, the component inventory and the generated manifest, in the order the manifest needs them. */
export async function load(
  application: string,
  options: { readonly refresh: boolean; readonly declared?: readonly string[] },
) {
  const discovered = await discover(application)
  const found = roots(discovered, options.declared)
  const inventory = await DesignInventory.scan(application, found)
  const facts = stack(discovered)
  const written = await DesignManifest.write(
    application,
    {
      stack: [
        `Framework: ${facts.framework ?? "not declared in package.json"}`,
        `CSS pipeline: ${facts.pipeline.join(", ") || "plain CSS (no Tailwind, PostCSS or shadcn configuration found)"}`,
        ...(facts.dependencies.length ? [`Dependencies: ${facts.dependencies.join(", ")}`] : []),
      ],
      tokens: facts.tokens,
      roots: found,
      inventory,
    },
    options.refresh,
  )
  return { sources: written ? await discover(application) : discovered, inventory }
}

/** The model-visible block; both runtimes render exactly this under the design document. */
export function describe(document: Document) {
  const docs = document.sources.filter((source) => source.authoritative)
  const facts = stack(document.sources)
  const inventory = document.inventory ?? []
  const stories = document.sources.filter((source) => classify(source.file) === "story").length
  if (!docs.length && !facts.tokens.length && !facts.pipeline.length && !inventory.length && !document.system)
    return "Design system: none detected. Say so in designSystem and design from the brief; do not assume a component library."
  return [
    "Design system (read .red/DESIGN.md first; import from the component roots instead of re-implementing; write new CSS only for what the system lacks):",
    ...docs.map(
      (source) =>
        `Doc ${source.file}${classify(source.file) === "manifest" ? " (generated, edit the Notes section)" : ""}:\n${source.excerpt.length > 2000 ? source.excerpt.slice(0, 2000) + "\n[truncated; read the file for the rest]" : source.excerpt}`,
    ),
    ...(facts.tokens.length ? [`Tokens: ${facts.tokens.join(", ")}`] : []),
    ...(facts.pipeline.length ? [`Pipeline: ${facts.pipeline.join("; ")}`] : []),
    ...(facts.framework ? [`Framework: ${facts.framework}`] : []),
    ...[...new Set(inventory.map((entry) => entry.root))].toSorted().map((root) => {
      const names = inventory.filter((entry) => entry.root === root).map((entry) => entry.name)
      return `Components ${root}: ${names.slice(0, 40).join(", ")}${names.length > 40 ? ` (+${names.length - 40} more)` : ""}`
    }),
    ...(stories ? [`Stories: ${stories} files`] : []),
    ...(document.system
      ? [
          `Configured: paths ${document.system.paths?.join(", ") || "none"}; css ${document.system.css?.join(", ") || "none"}; tailwind ${document.system.tailwind === undefined ? "auto" : document.system.tailwind ? "on" : "off"}`,
        ]
      : []),
  ].join("\n")
}

/** Paths and counts only: what the Design Context Source carries on every turn. */
export function summary(document: Document) {
  const docs = document.sources.filter((source) => source.authoritative).map((source) => source.file)
  const tokens = stack(document.sources).tokens.length
  const inventory = document.inventory ?? []
  if (!docs.length && !tokens && !inventory.length) return ""
  return [
    ...(docs.length ? [`docs ${docs.join(", ")}`] : []),
    ...(tokens ? [`${tokens} token file${tokens === 1 ? "" : "s"}`] : []),
    ...(inventory.length
      ? [
          `${inventory.length} components in ${[...new Set(inventory.map((entry) => entry.root))].toSorted().join(", ")}`,
        ]
      : []),
  ].join("; ")
}
