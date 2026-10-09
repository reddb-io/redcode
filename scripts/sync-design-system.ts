#!/usr/bin/env bun
// Vendors the pinned reddb-io/design-system release with the design system's own Sync.
// Usage: bun scripts/sync-design-system.ts [/path/to/design-system]
//
// The Sync reads design-system.manifest.json, enforces Kit and Layer routing for the `redcode` consumer and lands
// the release under `dest` as a reviewable diff. The Kits are Svelte, so the Solid app takes only their framework-free
// parts: the `*.variants.ts` contracts, the Brand marks, the Color Layer and the styles.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const source = resolve(process.argv[2] ?? join(root, "../design-system"))
const manifest = JSON.parse(readFileSync(join(root, "design-system.manifest.json"), "utf8")) as {
  version: string
  dest: string
}

// The producer that runs is the checkout's, so it must be the pinned release's own.
const pinned = (await Bun.$`git -C ${source} rev-parse ${manifest.version}^{commit}`.text()).trim()
if ((await Bun.$`git -C ${source} rev-parse HEAD`.text()).trim() !== pinned)
  throw new Error(`Check out ${manifest.version} in ${source} before synchronizing`)

await Bun.$`bun ${join(source, "scripts/producer/src/cli.ts")}`.cwd(root)

// The Sync does not route the Assets Contract's platform icons yet, so they are taken byte-for-byte from the same tag.
const platform = join(root, manifest.dest, "platform")
const listing = JSON.parse(
  await Bun.$`git -C ${source} show ${manifest.version}:packages/assets/dist/platform-manifest.json`.text(),
) as { icons: { file: string }[] }
mkdirSync(platform, { recursive: true })
writeFileSync(join(platform, "platform-manifest.json"), JSON.stringify(listing, null, 2) + "\n")
for (const icon of listing.icons)
  writeFileSync(
    join(platform, icon.file),
    new Uint8Array(await Bun.$`git -C ${source} show ${manifest.version}:packages/assets/dist/platform/${icon.file}`.arrayBuffer()),
  )
console.log(`Platform icons: ${listing.icons.map((icon) => icon.file).join(", ")}`)
