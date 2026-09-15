import path from "node:path"
import readline from "node:readline"
import { stripVTControlCharacters } from "node:util"
import { Effect } from "effect"
import { DesignProposal } from "@reddb-io/redcode-core/design/proposal"
import { Global } from "@reddb-io/redcode-core/global"

/** Maps a typed reply to an option label; anything but yes or no is "not now". */
export function choice(reply: string | undefined) {
  const value = reply?.trim().toLowerCase()
  if (value === "y" || value === "yes" || value === "1") return DesignProposal.YES
  if (value === "n" || value === "no" || value === "3") return DesignProposal.NO
  return DesignProposal.LATER
}

/** The effective `design.browser` for a directory, read without asking anything. */
export async function browser(directory: string, global = Global.make().config) {
  return (await DesignProposal.configured(directory, global).catch(() => undefined))?.browser
}

/**
 * `redcode design`'s proposal: before the session starts, offer the detected design system when the
 * project configures none. Returns the effective `design.browser` for review launches.
 */
export async function run(input: {
  readonly directory: string
  /** Reads one reply; undefined when the prompt was dismissed or the input ended. */
  readonly ask: (prompt: string) => Promise<string | undefined>
  readonly write: (text: string) => void
  readonly state?: string
  readonly global?: string
  readonly now?: number
}) {
  const global = input.global ?? Global.make().config
  const design = await DesignProposal.configured(input.directory, global).catch(() => undefined)
  const outcome = await Effect.runPromise(
    DesignProposal.offer({
      directory: input.directory,
      state: input.state ?? path.join(Global.make().state, DesignProposal.STATE),
      global,
      configured: design?.system !== undefined,
      now: input.now,
      ask: (request) =>
        Effect.promise(async () => {
          input.write(
            `${request.question}\n${request.options.map((option, index) => `  ${index + 1}) ${option.label}: ${option.description}`).join("\n")}`,
          )
          return choice(await input.ask(`${DesignProposal.QUESTION} [y]es / [e]dit later / [n]o: `))
        }),
    }),
  )
  if (outcome.status === "adopted")
    input.write(
      `Wrote design.system to ${path.relative(input.directory, outcome.file) || outcome.file}. ${outcome.manifest}.`,
    )
  if (outcome.status === "failed") input.write(`Could not adopt the detected design system: ${outcome.message}`)
  if (outcome.status === "declined") input.write("Design system proposal declined; it will not be asked again here.")
  if (outcome.status === "later") input.write("Design system proposal skipped; it will be offered again in a day.")
  const effective = outcome.status === "adopted" ? await DesignProposal.configured(input.directory, global) : design
  return { outcome, browser: effective?.browser }
}

/**
 * Runs the proposal on the terminal with its own readline. Ctrl+C and end of input (Ctrl+D) both
 * dismiss it as "not now" instead of waiting.
 */
export async function prompt(
  directory: string,
  options: {
    readonly input?: NodeJS.ReadableStream
    readonly output?: NodeJS.WritableStream
    readonly state?: string
    readonly global?: string
  } = {},
) {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const lines = readline.createInterface({ input, output, terminal: input === process.stdin && process.stdin.isTTY })
  let closed = false
  lines.once("close", () => {
    closed = true
  })
  const write = (text: string) =>
    output.write(stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "") + "\n")
  try {
    return await run({
      directory,
      write,
      state: options.state,
      global: options.global,
      ask: (query) =>
        new Promise((resolve) => {
          if (closed) return resolve(undefined)
          const controller = new AbortController()
          const finish = (reply: string | undefined) => {
            lines.off("SIGINT", cancel)
            lines.off("close", end)
            resolve(reply)
          }
          const cancel = () => {
            controller.abort()
            output.write("\n")
            finish(undefined)
          }
          const end = () => finish(undefined)
          lines.once("SIGINT", cancel)
          lines.once("close", end)
          lines.question(query, { signal: controller.signal }, (reply) => finish(reply))
        }),
    })
  } finally {
    lines.close()
  }
}

export * as DesignProposalPrompt from "./design-proposal"
