import { $ } from "bun"
import { chmod, copyFile, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.REDCODE_DESKTOP_CHANNEL

  if (raw === "dev" || raw === "beta" || raw === "prod") return raw

  return "dev"
}

const resources = resolve(import.meta.dirname, "../resources")

// Matches the archive names the Redcode release publishes (`redcode-<os>-<arch>`).
const target = (() => {
  const os = process.platform === "win32" ? "windows" : process.platform
  const arch = process.arch === "arm64" ? "arm64" : "x64"

  return `${os}-${arch}`
})()

/**
 * Places the Redcode binary the desktop app bundles in `resources/`, with its version beside it.
 *
 * `REDCODE_DESKTOP_BINARY` points at a local directory (or a single binary) and wins. Otherwise the archive for
 * this platform is downloaded from the Redcode release named by `REDCODE_DESKTOP_RELEASE`, or the latest one.
 */
export async function installCliToResources() {
  const local = Bun.env.REDCODE_DESKTOP_BINARY

  if (local) return copyCliToResources(await findBinary(resolve(local)))

  const archive = `redcode-${target}.${target.startsWith("linux-") ? "tar.gz" : "zip"}`
  const directory = await mkdtemp(join(tmpdir(), "redcode-desktop-"))

  try {
    const tag = Bun.env.REDCODE_DESKTOP_RELEASE
    await $`gh release download ${tag ? [tag] : []} --repo reddb-io/redcode --pattern ${archive} --dir ${directory}`
    const bin = join(directory, "bin")
    await $`mkdir ${bin}`

    if (archive.endsWith(".zip")) await $`unzip -q ${join(directory, archive)} -d ${bin}`
    else await $`tar -xzf ${join(directory, archive)} -C ${bin}`
    await copyCliToResources(await findBinary(bin))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

// The version file spares the desktop a spawn of the large binary on every launch. The build host always matches
// the packaged platform, so asking the binary itself is exact.
async function copyCliToResources(source: string) {
  const dest = join(resources, executableName())
  await rm(dest, { force: true })
  await copyFile(source, dest)

  if (process.platform !== "win32") await chmod(dest, 0o755)
  const output = (await $`${dest} --version`.text()).trim()
  // `redcode --version` prints `redcode v0.72.12`.
  const marker = output.lastIndexOf(" v")
  const version = marker === -1 ? output : output.slice(marker + 2)

  if (!version) throw new Error(`Bundled Redcode binary did not report a version: ${source}`)
  await Bun.write(versionFile(dest), version)
  console.log(`Bundled Redcode ${version} from ${source}`)
}

async function findBinary(source: string) {
  if (await Bun.file(source).exists()) return source
  const name = (await readdir(source)).find((file) => file === executableName())

  if (!name) throw new Error(`No ${executableName()} binary found in ${source}`)

  return join(source, name)
}

export function versionFile(cli: string) {
  return join(dirname(cli), "redcode.version")
}

function executableName() {
  return process.platform === "win32" ? "redcode.exe" : "redcode"
}
