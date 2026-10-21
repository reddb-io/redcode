#!/usr/bin/env bun
// Vendors the pinned reddb-io/design-system release with the design system's own Sync.
// Usage: bun scripts/sync-design-system.ts [/path/to/design-system]
//
// The Sync reads design-system.manifest.json, enforces Kit and Layer routing for the `redcode` consumer and lands
// the release as the `@reddb-io/design-system` workspace package, which every Redcode surface consumes:
// - the GUI imports its contracts, Logo modules, Color Layer, styles and platform icons;
// - the core design app gets one shadow-root stylesheet, the favicon and the Brand's faces, generated into its brand.gen.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const source = resolve(process.argv[2] ?? join(root, "../design-system"))
const manifest = JSON.parse(readFileSync(join(root, "design-system.manifest.json"), "utf8")) as {
  consumer: string
  version: string
  dest: string
}
const dest = join(root, manifest.dest)

// The producer that runs is the checkout's, so it must be the pinned release's own.
const pinned = (await Bun.$`git -C ${source} rev-parse ${manifest.version}^{commit}`.text()).trim()
if ((await Bun.$`git -C ${source} rev-parse HEAD`.text()).trim() !== pinned)
  throw new Error(`Check out ${manifest.version} in ${source} before synchronizing`)

// The receipt hashes bytes. Keep the producer's temporary clone canonical on Windows too.
const gitConfigCount = Number(process.env.GIT_CONFIG_COUNT ?? 0)
await Bun.$`bun ${join(source, "scripts/producer/src/cli.ts")}`.cwd(root).env({
  ...process.env,
  GIT_CONFIG_COUNT: String(gitConfigCount + 1),
  [`GIT_CONFIG_KEY_${gitConfigCount}`]: "core.autocrlf",
  [`GIT_CONFIG_VALUE_${gitConfigCount}`]: "false",
})

// The Sync does not route the Assets Contract's platform icons yet, so they are taken byte-for-byte from the same tag.
const platform = JSON.parse(
  await Bun.$`git -C ${source} show ${manifest.version}:packages/assets/dist/platform-manifest.json`.text(),
) as { icons: { file: string }[] }
mkdirSync(join(dest, "platform"), { recursive: true })
writeFileSync(join(dest, "platform/platform-manifest.json"), JSON.stringify(platform, null, 2) + "\n")
for (const icon of platform.icons)
  writeFileSync(
    join(dest, "platform", icon.file),
    new Uint8Array(
      await Bun.$`git -C ${source} show ${manifest.version}:packages/assets/dist/platform/${icon.file}`.arrayBuffer(),
    ),
  )

// Local Divergence: the Kits are Svelte and Redcode renders with Solid, so the package exports their framework-free
// modules and depends only on what those import. Re-applied after every Sync, which rewrites package.json.
const contracts = (kit: string) =>
  Array.from(new Bun.Glob("**/*.variants.ts").scanSync(join(dest, "kits", kit, "src"))).map((file) => ({
    name: file.split(/[\\/]/).at(-1)!.replace(".variants.ts", ""),
    path: `./kits/${kit}/src/${file.replaceAll("\\", "/")}`,
  }))
const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8"))
// App appearance contracts import Base vocabulary through the public package seam.
// Keep that seam framework-free instead of exposing the upstream Svelte barrel.
writeFileSync(
  join(dest, "solid-base.ts"),
  [
    'export { TONES, FEEDBACK_TONES, isTone, type Tone, type FeedbackTone } from "./kits/base/src/tone"',
    'export { card } from "./kits/base/src/card.variants"',
    'export { dropdownMenu, type DropdownMenuSize } from "./kits/base/src/dropdown-menu.variants"',
    'export { popover } from "./kits/base/src/popover.variants"',
    'export { mediaObject } from "./kits/base/src/media-object.variants"',
    'export { gridList, type GridListColumn } from "./kits/base/src/grid-list.variants"',
    'export { list } from "./kits/base/src/list.variants"',
    "",
  ].join("\n"),
)
writeFileSync(
  join(dest, "package.json"),
  JSON.stringify(
    {
      ...pkg,
      exports: {
        "./color": pkg.exports["./color"],
        "./base": "./solid-base.ts",
        "./styles/application.css": pkg.exports["./styles/application.css"],
        "./contracts/*": "./kits/base/src/*.variants.ts",
        ...Object.fromEntries(contracts("app").map((contract) => [`./contracts/${contract.name}`, contract.path])),
        "./logo/*": "./kits/base/src/logo.*.ts",
        "./platform/*": "./platform/*",
      },
      dependencies: { "tailwind-variants": pkg.dependencies["tailwind-variants"] },
      peerDependencies: undefined,
      peerDependenciesMeta: undefined,
    },
    null,
    2,
  ) + "\n",
)

// Keep the producer's provenance and record the Solid export adaptation explicitly. The file hashes
// describe the delivered package, including the platform icons that this wrapper adds after Sync.
const receiptPath = join(dest, "design-system.receipt.json")
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
const upstreamPackageSha256 = receipt.files["package.json"]
for (const file of [
  "package.json",
  "solid-base.ts",
  "platform/platform-manifest.json",
  ...platform.icons.map((icon) => `platform/${icon.file}`),
])
  receipt.files[file] = createHash("sha256")
    .update(readFileSync(join(dest, file)))
    .digest("hex")
receipt.consumer = { name: manifest.consumer, framework: "solid", upstreamPackageSha256 }
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n")

// The design app injects its UI into a shadow root, so it takes the Application direction, both Color Schemes and
// every Density as one stylesheet (every DS appearance artifact also matches `:host`).
const css = [
  "tokens/tokens.css",
  "theme/theme-base.css",
  "theme/theme-application.css",
  "theme/scheme-light.css",
  "theme/scheme-dark.css",
  ...["tiny", "compact", "comfortable", "spacious"].map((density) => `tokens/density-${density}.css`),
]
  .map((file) => readFileSync(join(dest, file), "utf8").replaceAll("\r\n", "\n"))
  .join("\n")
const favicon = `data:image/svg+xml,${encodeURIComponent(readFileSync(join(dest, "platform/favicon.svg"), "utf8").replaceAll("\r\n", "\n"))}`
// The Brand's faces travel inside the binary as data URIs, so the design pages need no network to render them.
// @font-face does not take effect from a shadow root's stylesheet, so the pages declare these in the document head.
const fonts = readFileSync(join(dest, "assets/fonts.css"), "utf8")
  .replaceAll("\r\n", "\n")
  .replace(
    /url\("\.\/(fonts\/[^"]+\.woff2)"\)/g,
    (_, file: string) => `url("data:font/woff2;base64,${readFileSync(join(dest, "assets", file)).toString("base64")}")`,
  )
writeFileSync(
  join(root, "packages/core/src/design/ui/brand.gen.ts"),
  `// Generated by scripts/sync-design-system.ts from @reddb-io/design-system ${manifest.version}.\nexport const appearance = ${JSON.stringify({ css, favicon }, null, 2)}\n\nexport const fonts = ${JSON.stringify(fonts)}\n`,
)
console.log(`Synced ${manifest.version} into ${manifest.dest}; regenerated the design app's brand.gen.ts`)
