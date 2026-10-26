#!/usr/bin/env bun
// Vendors the pinned reddb-io/design-system release with the design system's own Sync.
// Usage: bun scripts/sync-design-system.ts [/path/to/design-system]
//
// The Sync reads design-system.manifest.json, enforces Kit and Layer routing for the `redcode` consumer and lands
// the release as the `@reddb-io/design-system` workspace package, which every Redcode surface consumes:
// - the GUI imports its contracts, Logo modules, Color Layer, styles and platform icons;
// - the core design app gets one shadow-root stylesheet, the favicon and the Brand's faces, generated into its brand.gen.ts.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const root = resolve(import.meta.dir, "..")
const source = resolve(process.argv[2] ?? join(root, "../design-system"))
const manifest = JSON.parse(readFileSync(join(root, "design-system.manifest.json"), "utf8")) as {
  consumer: string
  version: string
  dest: string
}
const dest = join(root, manifest.dest)

// Run the pinned producer without moving the adjacent checkout or its active worktrees.
const pinned = (await Bun.$`git -C ${source} rev-parse ${manifest.version}^{commit}`.text()).trim()
using producer = {
  path: mkdtempSync(join(tmpdir(), "redcode-ds-producer-")),
  [Symbol.dispose]() {
    rmSync(this.path, { recursive: true, force: true })
  },
}
await Bun.$`git -C ${source} archive ${pinned} | tar -xf - -C ${producer.path}`
symlinkSync(
  join(root, "packages/design-system-tools/node_modules"),
  join(producer.path, "node_modules"),
  process.platform === "win32" ? "junction" : "dir",
)

// The pinned compiler also creates a dependency link. Adapt only its temporary
// copy so Windows builds need no symlink privilege; Kit sources stay untouched.
if (process.platform === "win32") {
  const compiler = join(producer.path, "scripts/producer/src/compile-delivery.ts")
  const content = readFileSync(compiler, "utf8")
  const link = 'symlinkSync(join(toolRoot, "node_modules"), link, "dir")'
  if (!content.includes(link)) throw new Error("The pinned React compiler's dependency link has changed")
  writeFileSync(compiler, content.replace(link, link.replace('"dir"', '"junction"')))
}

// The receipt hashes bytes. Keep the producer's temporary clone canonical on Windows too.
const gitConfigCount = Number(process.env.GIT_CONFIG_COUNT ?? 0)
await Bun.$`bun ${join(producer.path, "scripts/producer/src/cli.ts")}`.cwd(root).env({
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

// Preserve recipe imports for the Solid surfaces while React pages consume the canonical Kit exports.
const contracts = (kit: string) =>
  Array.from(new Bun.Glob("**/*.variants.js").scanSync(join(dest, "client/kits", kit, "src"))).map((file) => ({
    name: file.split(/[\\/]/).at(-1)!.replace(".variants.js", ""),
    path: {
      types: `./types/kits/${kit}/src/${file.replaceAll("\\", "/").replace(/\.js$/, ".d.ts")}`,
      default: `./client/kits/${kit}/src/${file.replaceAll("\\", "/")}`,
    },
  }))
const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8"))
rmSync(join(dest, "solid-base.ts"), { force: true })
// Portable App recipes need Base vocabulary, not its React component barrel. Keep this seam
// separate so the remaining Solid surfaces do not load the entire React catalogue in development.
const recipes = [
  "tone",
  "card.variants",
  "dropdown-menu.variants",
  "popover.variants",
  "media-object.variants",
  "grid-list.variants",
  "list.variants",
]
writeFileSync(
  join(dest, "recipe-base.js"),
  recipes.map((file) => `export * from "./client/kits/base/src/${file}.js"\n`).join(""),
)
writeFileSync(
  join(dest, "recipe-base.d.ts"),
  recipes.map((file) => `export * from "./types/kits/base/src/${file}"\n`).join(""),
)
writeFileSync(
  join(dest, "package.json"),
  JSON.stringify(
    {
      ...pkg,
      exports: {
        ...pkg.exports,
        "./contracts/base": {
          types: "./recipe-base.d.ts",
          default: "./recipe-base.js",
        },
        "./contracts/*": {
          types: "./types/kits/base/src/*.variants.d.ts",
          default: "./client/kits/base/src/*.variants.js",
        },
        ...Object.fromEntries(contracts("app").map((contract) => [`./contracts/${contract.name}`, contract.path])),
        "./logo/*": {
          types: "./types/kits/base/src/logo.*.d.ts",
          default: "./client/kits/base/src/logo.*.js",
        },
        "./platform/*": "./platform/*",
      },
    },
    null,
    2,
  ) + "\n",
)

// Keep the producer's provenance and record the compatibility exports explicitly. The file hashes
// describe the delivered package, including the platform icons that this wrapper adds after Sync.
const receiptPath = join(dest, "design-system.receipt.json")
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
const upstreamPackageSha256 = receipt.files["package.json"]
for (const file of [
  "package.json",
  "recipe-base.js",
  "recipe-base.d.ts",
  "platform/platform-manifest.json",
  ...platform.icons.map((icon) => `platform/${icon.file}`),
])
  receipt.files[file] = createHash("sha256")
    .update(readFileSync(join(dest, file)))
    .digest("hex")
receipt.consumer = {
  name: manifest.consumer,
  framework: "react",
  upstreamPackageSha256,
  ...(process.platform === "win32" ? { producerAdaptations: ["windows-react-dependency-junction"] } : {}),
}
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
