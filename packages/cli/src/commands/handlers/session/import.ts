import { autocomplete, cancel, isCancel } from "@clack/prompts"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Session } from "@opencode/schema/session"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { Effect, Option, Schema } from "effect"
import { EOL } from "node:os"
import path from "node:path"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(
  Commands.commands.session.commands.import,
  Effect.fn("cli.session.import")(function* (input) {
    const source = Option.getOrUndefined(input.from)
    if (source) return yield* importForeign(input, source === "claude" ? "claude-code" : source)
    const file = Option.getOrUndefined(input.file)
    if (!file) return yield* Effect.fail(new Error("Pass a JSON file or URL to import, or --from <source>"))
    const text = yield* Effect.tryPromise({
      try: () =>
        file.startsWith("http://") || file.startsWith("https://")
          ? fetch(file).then((response) => {
              if (!response.ok) throw new Error(`Failed to fetch session data: ${response.statusText}`)
              return response.text()
            })
          : Bun.file(file).text(),
      catch: (cause) =>
        new Error(`Failed to read session data: ${cause instanceof Error ? cause.message : String(cause)}`),
    })
    const data = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SessionTransfer.Data))(text)
    const encoded = Schema.encodeSync(SessionTransfer.Data)(data)
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({
      baseUrl: server.endpoint.url,
      headers: Service.headers(server.endpoint),
    })
    const location = yield* Effect.promise(() =>
      client.location.get({
        location: { directory: path.resolve(Option.getOrElse(input.directory, () => process.cwd())) },
      }),
    )
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/experimental/session/import", server.endpoint.url), {
        method: "POST",
        headers: { ...Service.headers(server.endpoint), "content-type": "application/json" },
        body: JSON.stringify({
          ...encoded,
          location: { directory: location.directory },
        }),
      }),
    )
    if (response.status === 409) {
      process.stderr.write(`Session already exists${EOL}`)
      return
    }
    if (!response.ok) yield* Effect.fail(new Error(`Failed to import session: ${response.statusText}`))
    const imported = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ data: Session.Info })))(
      yield* Effect.promise(() => response.text()),
    )
    process.stdout.write(`Imported session: ${imported.data.id}${EOL}`)
  }),
)

const names = { opencode: "OpenCode", "claude-code": "Claude Code" } as const

/** Import a session from another coding agent's local history through the server, which reads that store read-only. */
const importForeign = Effect.fn("cli.session.import.foreign")(
  function* (input: Runtime.Input<typeof Commands.commands.session.commands.import>, source: keyof typeof names) {
    const requested = Option.getOrUndefined(input.file)
    if (input.pick && !process.stdin.isTTY)
      return yield* Effect.fail(new Error("--pick requires an interactive terminal"))
    if (!requested && !input.latest && !input.pick && !process.stdin.isTTY)
      return yield* Effect.fail(new Error("Pass a session ID, --latest, or --pick"))
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    const ref = requested ?? (yield* choose(client, source, input))
    if (!ref) return
    const target = Option.getOrUndefined(input.directory)
    const location = target
      ? yield* Effect.tryPromise({
          try: () => client.location.get({ location: { directory: path.resolve(target) } }),
          catch: (cause) => cause,
        })
      : undefined
    const imported = yield* Effect.tryPromise({
      try: () =>
        client.session.foreign.import({
          source,
          ref,
          location: location ? { directory: location.directory } : undefined,
        }),
      catch: (cause) => cause,
    }).pipe(Effect.catchIf(isConflict, (error) => Effect.succeed({ conflict: error.resource })))
    if ("conflict" in imported) {
      process.stdout.write(`Session already imported: ${imported.conflict}${EOL}${openHint(imported.conflict)}`)
      return
    }
    imported.warnings.slice(0, 10).forEach((warning) => process.stderr.write(`Warning: ${warning}${EOL}`))
    if (imported.warnings.length > 10)
      process.stderr.write(`Warning: ${imported.warnings.length - 10} more import warnings${EOL}`)
    const subagents = imported.sessions.length - 1
    process.stdout.write(
      `Imported session: ${imported.session.id} from ${names[source]}` +
        (subagents > 0 ? ` with ${subagents} subagent session${subagents === 1 ? "" : "s"}` : "") +
        EOL +
        openHint(imported.session.id),
    )
  },
  Effect.catch((error) =>
    Effect.sync(() => {
      process.stderr.write(errorMessage(error) + EOL)
      process.exitCode = 1
    }),
  ),
)

const choose = Effect.fnUntraced(function* (
  client: ReturnType<typeof OpenCode.make>,
  source: keyof typeof names,
  input: Runtime.Input<typeof Commands.commands.session.commands.import>,
) {
  const directory = input.all ? undefined : path.resolve(process.cwd())
  const sessions = yield* Effect.tryPromise({
    try: () => client.session.foreign.list({ source, directory, limit: input.latest ? 1 : 50 }),
    catch: (cause) => cause,
  })
  if (sessions.length === 0)
    return yield* Effect.fail(
      new Error(
        directory
          ? `No ${names[source]} sessions found in ${directory}; pass --all to include every directory`
          : `No ${names[source]} sessions found`,
      ),
    )
  if (input.latest) return sessions[0]?.ref
  const selected = yield* Effect.tryPromise({
    try: () =>
      autocomplete({
        message: `Select a ${names[source]} session to import`,
        maxItems: 10,
        options: sessions.map((session) => ({
          label: session.title,
          value: session.ref,
          hint: [
            new Date(session.time.updated).toLocaleString(),
            `${session.messages} messages`,
            ...(session.model ? [session.model] : []),
            ...(directory ? [] : [session.directory]),
          ].join(" · "),
        })),
        output: process.stderr,
      }),
    catch: (cause) => cause,
  })
  if (isCancel(selected)) {
    cancel("Cancelled", { output: process.stderr })
    process.exitCode = 130
    return undefined
  }
  return selected
})

function isConflict(error: unknown): error is Error & { readonly resource: string } {
  return (
    error instanceof Error &&
    error.name === "ConflictError" &&
    "resource" in error &&
    typeof error.resource === "string"
  )
}

function openHint(sessionID: string) {
  return `Open it with: ${Commands.name} -s ${sessionID} (or from the desktop app's session list)${EOL}`
}
