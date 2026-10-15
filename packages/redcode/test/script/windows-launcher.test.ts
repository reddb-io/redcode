import { expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"

// Exercise npm's real global/local shim layout, including spaces and both companions.
// A renamed Bun executable stands in for Redcode and reports its own image and argv.
test.skipIf(process.platform !== "win32")(
  "npm Windows shims invoke the native binary in CMD, PowerShell and Bash",
  async () => {
    await using temporary = {
      path: await mkdtemp(path.join(os.tmpdir(), "redcode launcher ")),
      async [Symbol.asyncDispose]() {
        if (path.dirname(path.resolve(this.path)) !== path.resolve(os.tmpdir()))
          throw new Error("Unexpected test directory")
        await rm(this.path, { recursive: true, force: true })
      },
    }
    const root = temporary.path
    const environment = {
      ...process.env,
      REDCODE_BIN_PATH: undefined,
      OPENCODE_BIN_PATH: undefined,
      REDCODE_RPC_SIDECAR_PATH: undefined,
    }
    const source = path.join(root, "package")
    const binary = path.join(root, "native tools", "redcode.exe")
    await mkdir(path.join(source, "bin"), { recursive: true })
    await mkdir(path.dirname(binary), { recursive: true })
    await copyFile(process.execPath, binary)
    for (const command of ["redcode", "redcode-rpc-sidecar"]) {
      await copyFile(path.join(import.meta.dir, "../../bin/redcode"), path.join(source, "bin", command))
    }
    await copyFile(path.join(import.meta.dir, "../../postinstall.cjs"), path.join(source, "postinstall.cjs"))
    await writeFile(
      path.join(source, "package.json"),
      JSON.stringify({
        name: "@reddb-io/redcode",
        version: "0.0.0-test",
        bin: { redcode: "bin/redcode", "redcode-rpc-sidecar": "bin/redcode-rpc-sidecar" },
        scripts: { postinstall: "node postinstall.cjs" },
      }),
    )
    const packed = await $`npm pack --json --ignore-scripts`.cwd(source).quiet()
    const tarball = path.join(source, JSON.parse(packed.stdout.toString())[0].filename)
    const probe = path.join(root, "probe.js")
    await writeFile(
      probe,
      "console.log(JSON.stringify({ image: process.execPath, args: process.argv.slice(2) })); process.exit(23)",
    )
    for (const global of [true, false]) {
      const prefix = path.join(root, global ? "global prefix" : "local prefix")
      await $`npm install ${tarball} --prefix ${prefix} ${global ? ["--global"] : []} --offline --no-audit --no-fund`
        .env({ ...process.env, REDCODE_BIN_PATH: binary, REDCODE_RPC_SIDECAR_PATH: binary })
        .quiet()
      const directory = global ? prefix : path.join(prefix, "node_modules", ".bin")
      for (const command of ["redcode", "redcode-rpc-sidecar"]) {
        for (const extension of [".cmd", ".ps1", ""]) {
          expect(await readFile(path.join(directory, command + extension), "utf8")).not.toContain("node.exe")
        }
        const cmd = spawnSync(
          "cmd.exe",
          ["/d", "/s", "/c", `""${path.join(directory, command + ".cmd")}" "${probe}" "two words" 世界"`],
          { encoding: "utf8", windowsVerbatimArguments: true, timeout: 15_000, env: environment },
        )
        const ps = spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); & '${path.join(directory, command + ".ps1").replaceAll("'", "''")}' '${probe.replaceAll("'", "''")}' 'two words' '世界'; exit $LASTEXITCODE`,
          ],
          { encoding: "utf8", timeout: 15_000, env: environment },
        )
        const gitBash = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
        const bash = spawnSync(
          (await Bun.file(gitBash).exists()) ? gitBash : "bash",
          [path.join(directory, command), probe, "two words", "世界"],
          {
            encoding: "utf8",
            timeout: 15_000,
            env: environment,
          },
        )
        for (const [shell, result] of Object.entries({ cmd, ps, bash })) {
          expect({ shell, status: result.status, error: result.error?.message, stderr: result.stderr }).toEqual({
            shell,
            status: 23,
            error: undefined,
            stderr: "",
          })
          expect(JSON.parse(result.stdout)).toEqual({ image: binary, args: ["two words", "世界"] })
        }
      }
    }
  },
  120_000,
)
