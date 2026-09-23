import { Redcode } from "@reddb-io/redcode-client"
import readline from "node:readline"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"
import { DesignTerminal } from "./design-terminal"
import { ServerAuth } from "@/server/auth"
import { errorMessage } from "@/util/error"
import { DesignServer } from "./design-server"
import { DesignBrowser } from "@/design/browser"
import { DesignReviewPresence } from "@reddb-io/redcode-core/design/review-presence"
import { DesignBrowserLauncher } from "@reddb-io/redcode-core/design/browser-launcher"
import { Effect } from "effect"
import { withTimeout } from "@/util/timeout"
import { DesignProposalPrompt } from "./design-proposal"

export async function run(args: {
  prompt?: string[]
  session?: string
  agent?: "design" | "plan" | "build"
  model?: string
  directory?: string
  attach?: string
  open?: boolean
  target?: "web" | "app" | "presentation"
  platform?: "ios" | "android"
}) {
  if (args.platform && args.target !== "app") throw new Error("--platform applies only with --target app.")
  // The terminal's own server reads the forced target from its environment (see DesignTarget.forced);
  // an attached server runs elsewhere with its own.
  if (args.target && args.attach)
    throw new Error("--target applies to the Design terminal's own server; it cannot be combined with --attach.")
  if (args.target) process.env["REDCODE_DESIGN_TARGET"] = args.target
  if (args.platform) process.env["REDCODE_DESIGN_PLATFORM"] = args.platform
  const selectedModel = args.model ? DesignTerminal.model(args.model) : undefined
  const directory = path.resolve(args.directory ?? process.cwd())
  // Asked before the server opens the location, so an adopted design system is read with its config.
  // An attached server may run elsewhere: its config is not this machine's to write, so it is not asked.
  const browser = args.attach
    ? await DesignProposalPrompt.browser(directory)
    : (await DesignProposalPrompt.prompt(directory)).browser
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
  // `--open` and `/review` claim the launch on the server, which counts connected review pages and sees
  // the Design tool's and the TUI's launches: no tab while a page is connected or one was just requested.
  // A server without the `design.host` launch route (an older one) cannot report pages opened elsewhere,
  // so the claim falls back to this process and says so.
  const local = DesignReviewPresence.make()
  const review = async (sessionID: string) => {
    const id = encodeURIComponent(sessionID)
    const url = new URL(`/api/session/${id}/design/review`, baseUrl).toString()
    const post = (route: string, body: unknown) =>
      fetch(new URL(route, baseUrl), {
        method: "POST",
        headers: { ...ServerAuth.headers(), "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      })
    const disabled = DesignBrowserLauncher.disabledBy()
    const result = await DesignReviewPresence.openExplicit({
      sessionID,
      disabled,
      url,
      local,
      claim: async () => {
        const response = await post(`/api/design/session/${id}/launch`, { explicit: true })
        if (!response.ok) return undefined
        const reply = DesignReviewPresence.parseClaim(await response.json())
        return reply && { ...reply, url }
      },
      release: (token) => post(`/api/design/session/${id}/launch/release`, { token }),
      launch: (target) => Effect.runPromise(DesignBrowser.open(target, { browser })),
    })
    const note = {
      opened: "",
      failed: " (could not open a browser)",
      connected: " (already open in a browser tab; switch to it there)",
      pending: " (a browser tab was just requested)",
      disabled: ` (browser launch disabled by ${disabled})`,
      unavailable: "",
    }[result.status]
    write(
      `Review: ${url}${note}${result.local ? " · this server does not report open review pages, so one may already be open" : ""}`,
    )
  }
  const terminal = await DesignTerminal.create({
    client: Redcode.make({ baseUrl, headers: ServerAuth.headers() }),
    directory,
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
