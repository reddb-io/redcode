import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Vault } from "@opencode/schema/vault"
import { ServerConnection } from "../../../services/server-connection"

/**
 * Calls a vault method on the running server, routed to the current working directory's location so the server
 * acts on that project. Resolves to the raw RPC output for the caller to decode.
 */
export const callVault = Effect.fn("cli.vault.call")(function* (input: {
  server: string | undefined
  method: "set" | "import"
  input: Record<string, string>
}) {
  const server = yield* ServerConnection.resolve({ server: input.server })
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  return yield* Effect.tryPromise({
    try: (signal) =>
      client.rpc.call(
        {
          rpcID: Vault.Definition.id,
          method: input.method,
          input: input.input,
          location: { directory: process.cwd() },
        },
        { signal },
      ),
    catch: (cause) => cause,
  }).pipe(Effect.map((result): unknown => result.output))
})

/** A piped value without the one line break that `echo` or a file ending adds. */
export function pipedValue(text: string) {
  return text.replace(/\r?\n$/, "")
}

/** What `vault import` prints: the stored references and the skipped line count, never a value. */
export function importSummary(imported: Vault.Imported) {
  if (imported.unreadable === true) return ["The file could not be read; nothing was imported."]
  const stored = `Imported ${imported.names.length} ${imported.names.length === 1 ? "secret" : "secrets"}`
  return [
    imported.names.length ? `${stored}: ${imported.names.map(Vault.reference).join(", ")}` : stored,
    ...(imported.skipped > 0 ? [`Skipped ${imported.skipped} ${imported.skipped === 1 ? "line" : "lines"}`] : []),
  ]
}
