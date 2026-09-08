import { Redcode } from "@reddb-io/redcode-client"
import readline from "node:readline"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"
import { DesignTerminal } from "./design-terminal"
import { ServerAuth } from "@/server/auth"
import { errorMessage } from "@/util/error"
import { DesignServer } from "./design-server"
import { withTimeout } from "@/util/timeout"

export async function run(args: {
  prompt?: string[]
  session?: string
  agent?: "design" | "plan" | "build"
  model?: string
  directory?: string
  attach?: string
  open?: boolean
}) {
  const selectedModel = args.model ? DesignTerminal.model(args.model) : undefined
  const server = args.attach ? undefined : await DesignServer.start()
  const baseUrl = args.attach ?? server!.url
  const raw = process.stdin.isRaw
  const lines = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const closeInput = () => {
    lines.close()
    if (process.stdin.isTTY) process.stdin.setRawMode(raw ?? false)
  }
  const write = (text: string) => {
    // Tool output and model text cannot control the terminal or clipboard.
    const safe = stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    readline.clearLine(process.stdout, 0)
    readline.cursorTo(process.stdout, 0)
    process.stdout.write(safe + "\n")
    lines.prompt(true)
  }
  const review = async (sessionID: string) => {
    const url = new URL(`/api/session/${encodeURIComponent(sessionID)}/design/review`, baseUrl).toString()
    write(`Review: ${url}`)
    const open = await import("open")
    await open.default(url)
  }
  const terminal = await DesignTerminal.create({
    client: Redcode.make({ baseUrl, headers: ServerAuth.headers() }),
    directory: path.resolve(args.directory ?? process.cwd()),
    sessionID: args.session,
    agent: args.agent,
    model: selectedModel,
    write,
    mode: (agent) => lines.setPrompt(`${agent}> `),
    review,
  }).catch(async (error) => {
    closeInput()
    await server?.close()
    throw error
  })
  const interrupt = () => {
    void terminal.interrupt().then(
      () => write("Interrupted. /resume continues; /quit exits."),
      (error) => write(errorMessage(error)),
    )
  }
  lines.on("SIGINT", interrupt)
  try {
    if (args.open) await review(terminal.sessionID)
    if (args.prompt?.length) await terminal.line(args.prompt.join(" "))
    lines.prompt()
    for await (const value of lines) {
      if (value.trim() === "/quit" || value.trim() === "/exit") break
      await terminal.line(value).catch((error) => write(errorMessage(error)))
      lines.prompt()
    }
  } finally {
    lines.off("SIGINT", interrupt)
    closeInput()
    if (server) await withTimeout(terminal.interrupt(), 4000).catch((error) => write(errorMessage(error)))
    await terminal.close()
    await server?.close()
  }
}
