import type { RedcodeClient } from "@reddb-io/redcode-sdk/v2"

/** Every awaited route read must still belong to the current view before changing its workspace/editor. */
export async function loadSessionRoute(input: {
  sessionID: string
  signal: AbortSignal
  current: () => boolean
  client: RedcodeClient
  workspace: string | undefined
  setWorkspace: (workspace: string | undefined) => void
  bootstrap: () => Promise<unknown>
  reconnect: (directory: string) => void
  sync: (sessionID: string) => Promise<void>
  ready: () => void
}) {
  const result = await input.client.session.get(
    { sessionID: input.sessionID },
    { throwOnError: true, signal: input.signal },
  )
  if (!input.current()) return
  if (!result.data) throw new Error(`Session not found: ${input.sessionID}`)
  if (result.data.workspaceID !== input.workspace) {
    input.setWorkspace(result.data.workspaceID)
    // A removed workspace may fail to sync while its historical session remains readable.
    await input.bootstrap().catch(() => {})
  }
  if (!input.current()) return
  input.reconnect(result.data.directory)
  await input.sync(input.sessionID)
  if (input.current()) input.ready()
}
