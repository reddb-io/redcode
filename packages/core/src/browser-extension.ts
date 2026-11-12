export * as BrowserExtension from "./browser-extension.js"

import path from "node:path"
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createHash, createPublicKey } from "node:crypto"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@opencode/util/process"
import { AgentTools } from "@opencode/schema/agent-tools"
import { AbsolutePath } from "@opencode/schema/schema"

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const Plan = Schema.Struct({ extensionID: AgentTools.BrowserExtensionID, version: Schema.String })
const Manifest = Schema.Struct({ version: Schema.String.check(Schema.isPattern(/^\d+(?:\.\d+){0,3}$/)) })
const readOptional = (file: string) =>
  readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })

export const inspect = Effect.fn("BrowserExtension.inspect")(function* (root: string) {
  const chrome = Bun.which("google-chrome") ?? Bun.which("google-chrome-stable")
  if (!chrome) return { state: "chrome-missing", canAuthorize: false } satisfies AgentTools.BrowserExtension
  const canAuthorize = !!Bun.which("pkexec") && !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
  const saved = yield* Effect.tryPromise(() => readOptional(path.join(root, "setup.json")))
  if (!saved) return { state: "not-prepared", chrome: AbsolutePath.make(chrome), canAuthorize } satisfies AgentTools.BrowserExtension
  const plan = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Plan))(saved)
  const registration = yield* Effect.tryPromise(() =>
    readOptional(`/usr/share/google-chrome/extensions/${plan.extensionID}.json`),
  )
  const installed = registration
    ? Schema.decodeUnknownOption(
        Schema.fromJsonString(Schema.Struct({ external_crx: Schema.String, external_version: Schema.String })),
      )(registration)
    : undefined
  const expected = `/usr/local/share/redcode/browser-control/${plan.extensionID}/extension.crx`
  const registered = installed?._tag === "Some" && installed.value.external_crx === expected && installed.value.external_version === plan.version &&
    (yield* Effect.tryPromise(() => Bun.file(expected).exists()))
  return {
    state: registered ? "registered" : "administrator-required",
    chrome: AbsolutePath.make(chrome),
    extensionID: plan.extensionID,
    version: plan.version,
    command: `sudo /bin/sh ${quote(path.join(root, "install.sh"))}`,
    canAuthorize,
  } satisfies AgentTools.BrowserExtension
})

/** Package with Chrome's own CRX3 signer, leaving the user's running profile untouched. */
export const prepare = Effect.fn("BrowserExtension.prepare")(function* (input: { root: string; extensionDirectory: string }) {
  const processService = yield* AppProcess.Service
  const status = yield* inspect(input.root)
  if (!status.chrome) return yield* Effect.fail(new Error("Google Chrome is not installed on this Linux host"))
  yield* Effect.tryPromise(() => mkdir(input.root, { recursive: true, mode: 0o700 }))
  const staging = yield* Effect.tryPromise(() => mkdtemp(path.join(input.root, "prepare-")))
  return yield* Effect.gen(function* () {
    const key = path.join(input.root, "signing-key.pem")
    const savedKey = yield* Effect.tryPromise(() => Bun.file(key).exists())
    yield* Effect.tryPromise(() => cp(input.extensionDirectory, path.join(staging, "extension"), { recursive: true }))
    yield* processService.run(
      ChildProcess.make(status.chrome!, [
        "--no-message-box",
        `--user-data-dir=${path.join(staging, "profile")}`,
        `--pack-extension=${path.join(staging, "extension")}`,
        ...(savedKey ? [`--pack-extension-key=${key}`] : []),
      ]),
      { timeout: 30_000, maxOutputBytes: 4096, maxErrorBytes: 4096 },
    ).pipe(Effect.flatMap(AppProcess.requireSuccess))
    if (!savedKey) {
      yield* Effect.tryPromise(() => rename(path.join(staging, "extension.pem"), key))
      yield* Effect.tryPromise(() => chmod(key, 0o600))
    }
    const plan = yield* Effect.tryPromise(async () => {
      const publicKey = createPublicKey(await readFile(key)).export({ type: "spki", format: "der" })
      const extensionID = createHash("sha256").update(publicKey).digest().subarray(0, 16).toString("hex")
        .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)))
      const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(
        await readFile(path.join(staging, "extension", "manifest.json"), "utf8"),
      )
      const crx = await readFile(path.join(staging, "extension.crx"))
      if (crx.toString("ascii", 0, 4) !== "Cr24" || crx.readUInt32LE(4) !== 3)
        throw new Error("Chrome did not produce a CRX3 extension package")
      await copyFile(path.join(staging, "extension.crx"), path.join(input.root, "extension.crx"))
      return { extensionID, version: manifest.version, sha256: createHash("sha256").update(crx).digest("hex") }
    })
    const destination = `/usr/local/share/redcode/browser-control/${plan.extensionID}`
    const registration = `/usr/share/google-chrome/extensions/${plan.extensionID}.json`
    const script = `#!/bin/sh
set -eu
test "$(id -u)" = 0 || { echo 'Administrator access is required.' >&2; exit 1; }
test "$(sha256sum ${quote(path.join(input.root, "extension.crx"))} | cut -d ' ' -f 1)" = ${quote(plan.sha256)} || { echo 'Extension package changed. Prepare the installer again.' >&2; exit 1; }
install -d -m 755 ${quote(destination)} /usr/share/google-chrome/extensions
install -m 644 ${quote(path.join(input.root, "extension.crx"))} ${quote(destination + "/extension.crx")}
printf '%s\\n' ${quote(JSON.stringify({ external_crx: destination + "/extension.crx", external_version: plan.version }))} > ${quote(registration + ".tmp")}
chmod 644 ${quote(registration + ".tmp")}
mv -f ${quote(registration + ".tmp")} ${quote(registration)}
`
    yield* Effect.tryPromise(async () => {
      await writeFile(path.join(input.root, "install.sh"), script, { mode: 0o700 })
      await writeFile(path.join(input.root, "setup.json"), JSON.stringify({ extensionID: plan.extensionID, version: plan.version }), { mode: 0o600 })
    })
    return yield* inspect(input.root)
  }).pipe(Effect.ensuring(Effect.promise(() => rm(staging, { recursive: true, force: true }))))
})

export const install = Effect.fn("BrowserExtension.install")(function* (root: string) {
  const processService = yield* AppProcess.Service
  const status = yield* inspect(root)
  if (!status.canAuthorize || status.state !== "administrator-required") return status
  return yield* processService.run(
    ChildProcess.make(Bun.which("pkexec")!, ["--disable-internal-agent", "/bin/sh", path.join(root, "install.sh")]),
    { timeout: 120_000, maxOutputBytes: 4096, maxErrorBytes: 4096 },
  ).pipe(
    Effect.flatMap(AppProcess.requireSuccess),
    Effect.flatMap(() => inspect(root)),
    Effect.catch((error) => Effect.succeed({ ...status, error: error.message })),
  )
})
