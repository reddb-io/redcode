import { expect, test } from "bun:test"
import { CliRenderEvents, InputRenderable } from "@opentui/core"
import { once } from "node:events"
import type { SessionImportSourceInfo, SessionImportSummary } from "@opencode/client"
import { DialogSessionImport } from "../../src/component/dialog-session-import"
import { renderLocal, session } from "../fixture/local"
import { directory, json } from "../fixture/tui-client"

const sources: SessionImportSourceInfo[] = [
  { source: "opencode", name: "OpenCode", available: false, sessions: 0, warning: "No OpenCode history found" },
  { source: "claude-code", name: "Claude Code", available: true, path: "/home/kit/.claude/projects", sessions: 2 },
]

function summary(ref: string, title: string, input: Partial<SessionImportSummary> = {}): SessionImportSummary {
  return {
    source: "claude-code",
    ref,
    title,
    directory,
    messages: 12,
    subagents: 0,
    time: { created: Date.now() - 7_200_000, updated: Date.now() - 3_600_000 },
    ...input,
  }
}

async function render(input: {
  sessions: (url: URL) => SessionImportSummary[]
  import: (body: { source: string; ref: string; location?: { directory: string } }) => Response
}) {
  const requests: URL[] = []
  const opened: string[] = []
  const setup = await renderLocal({
    fetch: async (url, request) => {
      if (url.pathname === "/api/experimental/session/import/sources") return json({ data: sources })
      if (url.pathname === "/api/experimental/session/import/sessions") {
        requests.push(url)
        return json({ data: input.sessions(url) })
      }
      if (url.pathname === "/api/experimental/session/import/foreign") return input.import(await request.json())
    },
  })
  setup.dialog.replace(() => (
    <DialogSessionImport
      api={setup.client.session.foreign}
      directory={directory}
      onOpen={(sessionID) => opened.push(sessionID)}
    />
  ))
  return Object.assign(setup, {
    requests,
    opened,
    // The dialog paints before its deferred filter focus is ready for keys.
    async focused() {
      if (!(setup.renderer.currentFocusedRenderable instanceof InputRenderable))
        await once(setup.renderer, CliRenderEvents.FOCUSED_RENDERABLE)
    },
  })
}

test("imports a session from the preselected available source and opens it", async () => {
  const imported: unknown[] = []
  await using setup = await render({
    sessions: (url) =>
      url.searchParams.has("directory")
        ? [summary("one", "Fix the build", { estimated: true, messages: 340, subagents: 2, model: "anthropic/opus" })]
        : [summary("one", "Fix the build"), summary("two", "Elsewhere", { directory: "/srv/other" })],
    import: (body) => {
      imported.push(body)
      return json({ data: { session: session("ses_imported"), sessions: ["ses_imported"], warnings: [] } })
    },
  })
  await setup.waitForFrame(
    (frame) => frame.includes("Claude Code") && frame.includes("2 sessions") && frame.includes("No OpenCode history"),
  )
  await setup.focused()
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Fix the build") && frame.includes("~340 messages"))
  expect(setup.requests[0]?.searchParams.get("source")).toBe("claude-code")
  expect(setup.requests[0]?.searchParams.get("directory")).toBe(directory)

  setup.mockInput.pressKey("a", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Elsewhere") && frame.includes("all folders"))
  expect(setup.requests.at(-1)?.searchParams.has("directory")).toBe(false)

  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.opened.length > 0)
  expect(setup.opened).toEqual(["ses_imported"])
  expect(imported).toEqual([{ source: "claude-code", ref: "one" }])
  expect(setup.dialog.stack).toHaveLength(0)
})

test("opens the existing session when the server reports it was already imported", async () => {
  await using setup = await render({
    sessions: () => [summary("one", "Fix the build")],
    import: () =>
      json(
        { _tag: "ConflictError", message: "Session already imported: ses_existing", resource: "ses_existing" },
        { status: 409 },
      ),
  })
  await setup.waitForFrame((frame) => frame.includes("2 sessions"))
  await setup.focused()
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Fix the build"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.opened.length > 0)
  expect(setup.opened).toEqual(["ses_existing"])
})

test("explains an empty folder, offers every folder, and imports a session whose folder is gone here", async () => {
  await using setup = await render({
    sessions: (url) => (url.searchParams.has("directory") ? [] : [summary("gone", "Deleted worktree")]),
    import: (body) =>
      body.location?.directory === directory
        ? json({ data: { session: session("ses_moved"), sessions: ["ses_moved"], warnings: [] } })
        : json(
            {
              _tag: "LocationNotFoundError",
              message: "The session's directory no longer exists: /gone.",
              location: { directory: "/gone" },
            },
            { status: 404 },
          ),
  })
  await setup.waitForFrame((frame) => frame.includes("2 sessions"))
  await setup.focused()
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("No Claude Code sessions in this folder"))
  setup.mockInput.pressKey("a", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Deleted worktree"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("no longer exists") && frame.includes("Press enter to"))
  expect(setup.opened).toEqual([])
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.opened.length > 0)
  expect(setup.opened).toEqual(["ses_moved"])
})
