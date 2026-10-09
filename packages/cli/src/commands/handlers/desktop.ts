import { confirm, log } from "@clack/prompts"
import { Global } from "@opencode/util/global"
import { Effect, FileSystem } from "effect"
import { stat } from "node:fs/promises"
import { EOL } from "node:os"
import path from "node:path"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { DesktopApp } from "../../services/desktop-app"
import { handlePromptErrors, prompt } from "../../ui/prompt"
import { OPENCODE_VERSION } from "../../version"

export default Runtime.handler(
  Commands.commands.desktop,
  Effect.fn("cli.desktop")(function* (input) {
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const target = DesktopApp.target()
    const cli = DesktopApp.cli()
    const located = yield* Effect.tryPromise({
      try: () =>
        DesktopApp.locate({
          env: process.env,
          target,
          executable: cli ?? process.execPath,
          cache: global.cache,
          version: OPENCODE_VERSION,
          source: DesktopApp.checkout(),
        }),
      catch: (cause) => cause,
    })
    if (input.path) {
      process.stdout.write(located.app + EOL)
      return
    }

    // The pointer records the installation the app was last prepared for; a new version or path prepares it again.
    const file = DesktopApp.pointer(global.state)
    const record = cli ? DesktopApp.record({ version: OPENCODE_VERSION, cli, app: located.app }) : undefined
    const current = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
    if (input.refresh || current !== record)
      yield* Effect.forEach(DesktopApp.preparation(located, target, process.env), (command) =>
        Effect.tryPromise(() => DesktopApp.run(command, "ignore")).pipe(
          Effect.flatMap((code) => (code === 0 ? Effect.void : Effect.fail(code))),
          Effect.catch(() => Effect.sync(() => log.warn(`Could not prepare Redcode Desktop: ${command.join(" ")}`))),
        ),
      )

    const helper = path.join(path.dirname(located.executable), "chrome-sandbox")
    const sandbox = DesktopApp.sandbox(located, target, yield* Effect.promise(() => stat(helper).catch(() => undefined)))
    if (sandbox) yield* fixSandbox(sandbox)

    if (record && current !== record) {
      yield* fs.makeDirectory(path.dirname(file), { recursive: true })
      yield* fs.writeFileString(file, record)
    }
    if (input.refresh) {
      process.stdout.write(`Redcode Desktop is ready: ${located.app}` + EOL)
      return
    }
    yield* Effect.tryPromise({ try: () => DesktopApp.launch(located, cli), catch: (cause) => cause })
  }, handlePromptErrors),
)

// Electron refuses to start on Linux when its setuid sandbox helper lost root ownership, which unpacking it as a user
// always does. The fix needs root, so it is offered, never run silently.
const fixSandbox = Effect.fnUntraced(function* (sandbox: NonNullable<ReturnType<typeof DesktopApp.sandbox>>) {
  const command = sandbox.commands.map((item) => item.map(quote).join(" ")).join(" && ")
  const explanation = `Redcode Desktop needs its Chromium sandbox helper to be owned by root with the setuid bit: ${sandbox.helper}`
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    return yield* Effect.fail(new Error(`${explanation}. Run:${EOL}  ${command}`))
  log.warn(explanation)
  log.message(`  ${command}`)
  const accepted = yield* prompt(() => confirm({ message: "Run this with sudo now?", initialValue: true }))
  if (!accepted) return yield* Effect.fail(new Error(`Redcode Desktop cannot start until you run:${EOL}  ${command}`))
  yield* Effect.forEach(sandbox.commands, (item) =>
    Effect.tryPromise({ try: () => DesktopApp.run(item), catch: (cause) => cause }).pipe(
      Effect.flatMap((code) => (code === 0 ? Effect.void : Effect.fail(new Error(`${item.join(" ")} exited with ${code}`)))),
    ),
  )
})

function quote(value: string) {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}
