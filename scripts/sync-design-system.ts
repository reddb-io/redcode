#!/usr/bin/env bun
// Vendors the pinned reddb-io/design-system release into packages/ui.
// Usage: bun scripts/sync-design-system.ts [/path/to/design-system] [/path/to/brand]
//
// The Svelte Kits cannot run in Solid, so this adopts the framework-free layers only: Tokens, Theme, Assets
// (fonts) and the Kits' `*.variants.ts` contracts, which depend on `tailwind-variants` alone. The producer is the
// DS's own and the pins in design-system.manifest.json must match the checkout, so the result is reviewable.
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(import.meta.dir, "..")
const source = resolve(process.argv[2] ?? join(root, "../design-system"))
// A reddb-io/brand checkout, for the house mark the design system does not publish yet.
const brand = resolve(process.argv[3] ?? join(root, "../brand"))
const manifest = JSON.parse(readFileSync(join(root, "design-system.manifest.json"), "utf8")) as {
  source: string
  version: string
  revision: string
  producerRevision: string
  styles: string[]
  dest: string
  contracts: string[]
  contractsDest: string
}

const git = async (...args: string[]) => (await Bun.$`git -C ${source} ${args}`.text()).trim()

if ((await git("rev-parse", `v${manifest.version}^{commit}`)) !== manifest.revision)
  throw new Error("The design system release tag does not match the reviewed revision")
if ((await git("rev-parse", "HEAD")) !== manifest.producerRevision)
  throw new Error("Check out the reviewed producer revision from design-system.manifest.json")
if (await git("status", "--porcelain", "--", "scripts/producer"))
  throw new Error("The DS producer has local changes; review and pin it before synchronizing")

const producer = (file: string) => import(pathToFileURL(join(source, "scripts/producer/src", file)).href)
const { planConsumerStyles, writeConsumerStyles } = await producer("consumer-styles.ts")
const { assemblePackage } = await producer("packaging.ts")

const destination = join(root, manifest.dest)
const contractsDestination = join(root, manifest.contractsDest)
const work = mkdtempSync(join(tmpdir(), "redcode-ds-sync-"))

try {
  const release = join(work, "release")
  await Bun.$`git clone --quiet --shared --branch v${manifest.version} ${source} ${release}`
  if ((await Bun.$`git -C ${release} rev-parse HEAD`.text()).trim() !== manifest.revision)
    throw new Error("Cloned release revision mismatch")

  rmSync(destination, { recursive: true, force: true })
  const plan = planConsumerStyles(release, manifest.styles)
  const pkg = assemblePackage(JSON.parse(readFileSync(join(release, "package.json"), "utf8")), [], [], plan.profiles)
  writeConsumerStyles(destination, plan)
  writeFileSync(join(destination, "package.json"), JSON.stringify(pkg, null, 2) + "\n")

  rmSync(contractsDestination, { recursive: true, force: true })
  mkdirSync(contractsDestination, { recursive: true })
  const sources = ["base", "app"].flatMap((kit) => walk(join(release, "kits", kit, "src")))
  for (const name of manifest.contracts) copyContract(name, sources, contractsDestination)

  // The style delivery ships font bytes, so keep their licenses from the same pin.
  for (const family of ["space-grotesk", "jetbrains-mono"]) {
    const target = join(destination, "licenses", `${family}-OFL.txt`)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(release, "vendor/brand/fonts", family, "OFL.txt"), target)
  }
  // The Color Layer is the portable, resolved contract for developer surfaces such as redcode: syntax, diff,
  // Markdown and terminal colors that cannot read CSS custom properties.
  const color = join(root, manifest.dest, "../color")
  rmSync(color, { recursive: true, force: true })
  mkdirSync(color, { recursive: true })
  for (const file of ["index.ts", "light.json", "dark.json"]) cpSync(join(release, "packages/color/src", file), join(color, file))
  // The reddb.io house endorsement mark signs every sibling product (brand identity/house.md). The design system does
  // not publish it yet, so it is read from the Brand Assets release the design system itself pins.
  const brandVersion = JSON.parse(readFileSync(join(release, "vendor/brand/brand.lock.json"), "utf8")).version as string
  const endorsement = join(destination, "endorsement")
  mkdirSync(endorsement, { recursive: true })
  for (const name of ["color", "inverse", "black", "white"]) {
    const file = `assets/endorsement/reddb-endorsement-${name}.svg`
    writeFileSync(join(endorsement, `reddb-endorsement-${name}.svg`), await Bun.$`git -C ${brand} show ${brandVersion}:${file}`.text())
  }
  // Brand marks are the Logo's assets; the app places them as-is and never recolors them.
  const marks = join(destination, "marks")
  mkdirSync(marks, { recursive: true })
  for (const file of walk(join(release, "kits/base/src/marks")).filter((file) => file.endsWith(".svg")))
    cpSync(file, join(marks, file.split("/").at(-1)!))
} finally {
  rmSync(work, { recursive: true, force: true })
}

writeFileSync(
  join(root, "design-system.lock.json"),
  JSON.stringify(
    {
      source: manifest.source,
      version: manifest.version,
      revision: manifest.revision,
      producerRevision: manifest.producerRevision,
      files: Object.fromEntries(digests(destination)),
      color: Object.fromEntries(digests(join(destination, "../color"))),
      contracts: Object.fromEntries(digests(contractsDestination)),
    },
    null,
    2,
  ) + "\n",
)
console.log(`Synced ${manifest.version}: ${manifest.styles.join(", ")}; ${manifest.contracts.length} contracts.`)

// A contract and the plain-TypeScript helpers it imports (tone, type-roles, sibling variants) land together.
// A contract that imports a Svelte component is a Kit seam, not a contract, and is refused.
function copyContract(name: string, sources: string[], to: string) {
  const found = sources.filter((file) => file.endsWith(`/${name}.variants.ts`))
  if (found.length !== 1) throw new Error(`Contract ${name} must exist exactly once; found ${found.length}`)
  const queue = [found[0]!]
  const done = new Set<string>()
  while (queue.length) {
    const file = queue.pop()!
    if (done.has(file)) continue
    done.add(file)
    for (const match of readFileSync(file, "utf8").matchAll(/from\s+"(\.\/[^"]+)"/g)) {
      const specifier = match[1]!
      if (specifier.endsWith(".svelte")) throw new Error(`Contract ${name} imports a Svelte component: ${specifier}`)
      const next = join(dirname(file), `${specifier}.ts`)
      if (!existsSync(next)) throw new Error(`Contract ${name} imports ${specifier}, which is not plain TypeScript`)
      queue.push(next)
    }
    cpSync(file, join(to, file.split("/").at(-1)!))
  }
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    return entry.isDirectory() ? walk(file) : [file]
  })
}

function digests(directory: string, prefix = ""): [string, string][] {
  return readdirSync(directory, { withFileTypes: true })
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const name = prefix + entry.name
      const file = join(directory, entry.name)
      return entry.isDirectory()
        ? digests(file, `${name}/`)
        : [[name, createHash("sha256").update(readFileSync(file)).digest("hex")] as [string, string]]
    })
}
