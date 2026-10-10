import { expect, test } from "bun:test"
import { binaryPath, parseRegistration } from "./bootstrap"
import { RemoteCli } from "./remote-cli"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

test("ignores stopped services and registrations that do not match the healthy endpoint", () => {
  const registration = { url: "http://127.0.0.1:1234", password: "secret", version: "2.0.0", pid: 42 }
  const frame = `OPENCODE_SSH_REGISTRATION_BEGIN\n${JSON.stringify(registration)}\nOPENCODE_SSH_REGISTRATION_END\n`
  expect(parseRegistration(`OPENCODE_SSH_STATUS=stopped\n${frame}`)).toBeUndefined()
  expect(parseRegistration(`OPENCODE_SSH_STATUS=http://127.0.0.1:9999\n${frame}`)).toBeUndefined()
  expect(
    parseRegistration(
      `OPENCODE_SSH_STATUS=${registration.url}\nOPENCODE_SSH_REGISTRATION_BEGIN\ninvalid\nOPENCODE_SSH_REGISTRATION_END\n`,
    ),
  ).toBeUndefined()
})

test("rejects unsafe versions and platforms in remote installation paths", () => {
  expect(() => binaryPath('2.0.0"; whoami')).toThrow()
  expect(RemoteCli.archiveUrl("linux-x64-baseline-musl", "2.0.0-beta.1")).toBe(
    "https://registry.npmjs.org/@reddb-io/redcode-linux-x64-baseline-musl/-/redcode-linux-x64-baseline-musl-2.0.0-beta.1.tgz",
  )
  expect(() => RemoteCli.installScript({ version: '2.0.0"; whoami', source: { type: "archive" } })).toThrow()
  expect(() => RemoteCli.archiveUrl("linux-x64;whoami", "2.0.0")).toThrow()
})

test("installs a CLI archive with its RPC sidecar and a separately uploaded Design archive", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-ssh-install-"))
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash"
  const shell = async (script: string, archive?: Uint8Array) => {
    const child = Bun.spawn(
      [
        bash,
        "-c",
        `set -eu\n${process.platform === "win32" ? 'HOME="$(cygpath -u "$REDCODE_TEST_HOME")"' : 'HOME="$REDCODE_TEST_HOME"'}\n${script}`,
      ],
      {
        env: { ...process.env, REDCODE_TEST_HOME: root },
        stdin: archive ? "pipe" : "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    if (archive && child.stdin) {
      child.stdin.write(archive)
      child.stdin.end()
    }
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, code }
  }
  try {
    const bin = path.join(root, "package", "bin")
    await fs.mkdir(bin, { recursive: true })
    await Bun.write(path.join(bin, "redcode"), "#!/bin/sh\nprintf 'Redcode v0.75.0\\n'\n")
    await Bun.write(path.join(bin, "redcode-rpc-sidecar"), "#!/bin/sh\nexit 0\n")
    expect((await shell('cd "$HOME"; tar -czf cli.tgz package')).code).toBe(0)
    const cliArchive = new Uint8Array(await Bun.file(path.join(root, "cli.tgz")).arrayBuffer())
    expect(
      await shell(RemoteCli.installScript({ version: "0.75.0", source: { type: "archive" } }), cliArchive),
    ).toMatchObject({ code: 0, stderr: "" })
    expect(await Bun.file(path.join(root, ".red/code/bin/redcode-rpc-sidecar")).exists()).toBe(true)
    await fs.rm(bin, { recursive: true, force: true })
    await fs.mkdir(bin)
    await Bun.write(path.join(bin, "redcode-design"), "#!/bin/sh\nexit 0\n")
    expect((await shell('cd "$HOME"; tar -czf design.tgz package')).code).toBe(0)
    const designArchive = new Uint8Array(await Bun.file(path.join(root, "design.tgz")).arrayBuffer())
    expect(
      await shell(
        RemoteCli.installScript({ version: "0.75.0", source: { type: "archive", companion: true } }),
        designArchive,
      ),
    ).toMatchObject({ code: 0, stderr: "" })
    expect(await Bun.file(path.join(root, ".red/code/bin/redcode-design")).exists()).toBe(true)
    expect(
      (await shell(RemoteCli.installScript({ version: "0.76.0", source: { type: "archive" } }), cliArchive)).code,
    ).not.toBe(0)
    expect(
      (await shell(RemoteCli.installScript({ version: "0.75.0", source: { type: "archive" } }), designArchive)).code,
    ).not.toBe(0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)
