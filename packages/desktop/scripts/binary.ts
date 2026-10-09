import { $ } from "bun"
import { chmod, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const output = resolve(import.meta.dir, "../resources/bin")
const windows = process.platform === "win32"

// Matches the archive names the Redcode release publishes (`redcode-<os>-<arch>`).
const target = (() => {
  const os = process.platform === "win32" ? "windows" : process.platform
  const arch = process.arch === "arm64" ? "arm64" : "x64"
  return `${os}-${arch}`
})()

/**
 * Places the Redcode binaries the desktop app bundles in `resources/bin`.
 *
 * `REDCODE_DESKTOP_BINARY` points at a local directory (or a single binary) and wins. Otherwise the archive for
 * this platform is downloaded from the Redcode release named by `REDCODE_DESKTOP_RELEASE`, or the latest one.
 */
export async function installBinaries() {
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })

  const local = process.env.REDCODE_DESKTOP_BINARY
  if (local) {
    await copyBinaries(resolve(local))
    return
  }

  const archive = `redcode-${target}.${target.startsWith("linux-") ? "tar.gz" : "zip"}`
  const directory = await mkdtemp(join(tmpdir(), "redcode-desktop-"))
  try {
    const tag = process.env.REDCODE_DESKTOP_RELEASE
    await $`gh release download ${tag ? [tag] : []} --repo reddb-io/redcode --pattern ${archive} --dir ${directory}`
    if (archive.endsWith(".zip")) await $`unzip -q ${join(directory, archive)} -d ${join(directory, "bin")}`
    else await $`mkdir ${join(directory, "bin")} && tar -xzf ${join(directory, archive)} -C ${join(directory, "bin")}`
    await copyBinaries(join(directory, "bin"))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function copyBinaries(source: string) {
  const names = (await Bun.file(source).exists()) ? [source] : await readdirBinaries(source)
  if (!names.some((file) => file.replace(/\.exe$/, "").endsWith("redcode")))
    throw new Error(`No redcode binary found in ${source}`)
  for (const file of names) {
    const destination = join(output, file.split(/[\\/]/).at(-1)!)
    await cp(file, destination)
    if (!windows) await chmod(destination, 0o755)
  }
  console.log(`Installed ${names.length} Redcode binaries in ${output}`)
}

async function readdirBinaries(directory: string) {
  return (await readdir(directory)).filter((name) => name.startsWith("redcode")).map((name) => join(directory, name))
}

if (import.meta.main) await installBinaries()
