import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { installScript } from "./remote-cli"

test("stages a development CLI with both desktop companions and rejects incomplete bundles", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-wsl-install-"))
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash"
  const source = path.join(root, "source")
  const shell = async (version: string) => {
    const child = Bun.spawn(
      [
        bash,
        "-c",
        `set -eu\n${process.platform === "win32" ? 'HOME="$(cygpath -u "$REDCODE_TEST_HOME")"' : 'HOME="$REDCODE_TEST_HOME"'}\n${installScript({ version, binary: '"$HOME/source/redcode"' })}`,
      ],
      {
        env: { ...process.env, REDCODE_TEST_HOME: root },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, code }
  }
  try {
    await fs.mkdir(source)
    await Bun.write(path.join(source, "redcode"), "#!/bin/sh\nprintf 'Redcode v0.75.0\\n'\n")
    await Bun.write(path.join(source, "redcode-rpc-sidecar"), "#!/bin/sh\nexit 0\n")
    expect((await shell("0.75.0")).code).not.toBe(0)
    expect(await Bun.file(path.join(root, ".red/code/bin/redcode")).exists()).toBe(false)
    await Bun.write(path.join(source, "redcode-design"), "#!/bin/sh\nexit 0\n")
    expect(await shell("0.75.0")).toMatchObject({ code: 0, stderr: "" })
    for (const name of ["redcode", "redcode-rpc-sidecar", "redcode-design"]) {
      expect(await Bun.file(path.join(root, ".red/code/bin", name)).text()).toBe(
        await Bun.file(path.join(source, name)).text(),
      )
    }
    expect((await shell("0.76.0")).code).not.toBe(0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}, 20_000)
