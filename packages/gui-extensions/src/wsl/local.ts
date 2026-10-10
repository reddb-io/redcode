import { execFile } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** Development only: builds the Linux CLI from this checkout so WSL runs the same source. */
export async function buildLocalWslCli(input: { version: string; script: string; output: string }) {
  const directory = await mkdtemp(join(tmpdir(), "opencode-wsl-cli-"))
  const root = join(dirname(input.script), "../../..")

  const build = async () => {
    const packageManager = (
      JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { packageManager: string }
    ).packageManager

    const target = `linux-${process.arch}`
    const environment = {
      ...process.env,
      OPENCODE_VERSION: input.version,
      REDCODE_VERSION: input.version,
      REDCODE_BUILD: "1",
    }
    await execFileAsync("bunx", [packageManager, "install", "--os=*", "--cpu=*", "--frozen-lockfile"], {
      cwd: root,
      env: process.env,
      windowsHide: true,
    })
    const sidecarDir = join(directory, "sidecar")
    const sidecar = join(sidecarDir, `redcode-rpc-sidecar-${target}`)
    await execFileAsync("bunx", [packageManager, join(root, "packages/rpc-sidecar/script/build.ts")], {
      cwd: root,
      env: {
        ...environment,
        REDCODE_RPC_SIDECAR_OUTPUT: sidecar,
        REDCODE_RPC_SIDECAR_TARGET: `${process.arch === "arm64" ? "aarch64" : "x86_64"}-linux-gnu`,
      },
      windowsHide: true,
    })
    await execFileAsync(
      "bunx",
      [
        packageManager,
        input.script,
        `--target=redcode-${target}`,
        "--skip-install",
        "--skip-web-ui",
        `--outdir=${join(directory, "cli")}`,
      ],
      { cwd: root, env: { ...environment, REDCODE_RPC_SIDECAR_DIR: sidecarDir }, windowsHide: true },
    )
    await execFileAsync(
      "bunx",
      [
        packageManager,
        join(root, "packages/design-app/script/build.ts"),
        `--target=redcode-design-${target}`,
        "--skip-install",
        `--outdir=${join(directory, "design")}`,
      ],
      {
        cwd: root,
        env: environment,
        windowsHide: true,
      },
    )
    await mkdir(dirname(input.output), { recursive: true })
    await copyFile(join(directory, "cli", `redcode-${target}`, "bin", "redcode"), input.output)
    await copyFile(sidecar, join(dirname(input.output), "redcode-rpc-sidecar"))
    await copyFile(
      join(directory, "design", `redcode-design-${target}`, "redcode-design"),
      join(dirname(input.output), "redcode-design"),
    )

    return input.output
  }

  return build().finally(() => rm(directory, { recursive: true, force: true }))
}
