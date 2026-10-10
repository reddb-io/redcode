import { expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

const cwd = path.join(import.meta.dir, "..")
const info = {
  id: "ses_foreign",
  projectID: "global",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  title: "Foreign work",
  location: { directory: cwd },
}
const summary = {
  source: "opencode",
  ref: "ses_latest",
  title: "Latest work",
  directory: cwd,
  messages: 4,
  subagents: 0,
  time: { created: 1, updated: 2 },
}

function run(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  return Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
}

function serve(handle: (request: Request, url: URL) => Response | undefined | Promise<Response | undefined>) {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info")
        return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: "/tmp/opencode" } })
      return (await handle(request, url)) ?? new Response("Not found", { status: 404 })
    },
  })
}

test("imports a foreign session by ID and explains how to open it", async () => {
  const requests: unknown[] = []
  const server = serve(async (request, url) => {
    if (url.pathname !== "/api/experimental/session/import/foreign") return undefined
    requests.push(await request.json())
    return Response.json({ data: { session: info, sessions: ["ses_foreign", "ses_child"], warnings: [] } })
  })
  try {
    const [stdout, , exitCode] = await run([
      "session",
      "import",
      "ses_foreign",
      "--from",
      "opencode",
      "--server",
      server.url.toString(),
    ])
    expect(exitCode).toBe(0)
    expect(requests).toEqual([{ source: "opencode", ref: "ses_foreign" }])
    expect(stdout).toBe(
      `Imported session: ses_foreign from OpenCode with 1 subagent session${os.EOL}` +
        `Open it with: opencode -s ses_foreign (or from the desktop app's session list)${os.EOL}`,
    )
  } finally {
    await server.stop(true)
  }
}, 15_000)

test("imports the latest session recorded in the current directory", async () => {
  const lists: Record<string, string>[] = []
  const imports: unknown[] = []
  const server = serve(async (request, url) => {
    if (url.pathname === "/api/experimental/session/import/sessions") {
      lists.push(Object.fromEntries(url.searchParams))
      return Response.json({ data: [summary] })
    }
    if (url.pathname !== "/api/experimental/session/import/foreign") return undefined
    imports.push(await request.json())
    return Response.json({ data: { session: { ...info, id: "ses_latest" }, sessions: ["ses_latest"], warnings: [] } })
  })
  try {
    const [stdout, , exitCode] = await run([
      "session",
      "import",
      "--from",
      "opencode",
      "--latest",
      "--server",
      server.url.toString(),
    ])
    expect(exitCode).toBe(0)
    expect(lists).toEqual([{ source: "opencode", directory: cwd, limit: "1" }])
    expect(imports).toEqual([{ source: "opencode", ref: "ses_latest" }])
    expect(stdout).toStartWith(`Imported session: ses_latest from OpenCode${os.EOL}`)

    const [, , allExitCode] = await run([
      "session",
      "import",
      "--from",
      "opencode",
      "--latest",
      "--all",
      "--server",
      server.url.toString(),
    ])
    expect(allExitCode).toBe(0)
    expect(lists[1]).toEqual({ source: "opencode", limit: "1" })
  } finally {
    await server.stop(true)
  }
}, 15_000)

test("imports a Claude Code session, accepting claude as the source name", async () => {
  const requests: unknown[] = []
  const server = serve(async (request, url) => {
    if (url.pathname !== "/api/experimental/session/import/foreign") return undefined
    requests.push(await request.json())
    return Response.json({
      data: {
        session: { ...info, id: "ses_claude" },
        sessions: ["ses_claude"],
        warnings: ["Dropped 2 hidden meta messages"],
      },
    })
  })
  try {
    const [stdout, stderr, exitCode] = await run([
      "session",
      "import",
      "11111111-1111-4111-8111-111111111111",
      "--from",
      "claude",
      "--server",
      server.url.toString(),
    ])
    expect(exitCode).toBe(0)
    expect(requests).toEqual([{ source: "claude-code", ref: "11111111-1111-4111-8111-111111111111" }])
    expect(stdout).toStartWith(`Imported session: ses_claude from Claude Code${os.EOL}`)
    expect(stderr).toBe(`Warning: Dropped 2 hidden meta messages${os.EOL}`)
  } finally {
    await server.stop(true)
  }
}, 15_000)

test("reports an already imported session with its existing ID", async () => {
  const server = serve((_request, url) =>
    url.pathname === "/api/experimental/session/import/foreign"
      ? Response.json(
          { _tag: "ConflictError", message: "Session already imported: ses_foreign", resource: "ses_foreign" },
          { status: 409 },
        )
      : undefined,
  )
  try {
    const [stdout, , exitCode] = await run([
      "session",
      "import",
      "ses_foreign",
      "--from",
      "opencode",
      "--server",
      server.url.toString(),
    ])
    expect(exitCode).toBe(0)
    expect(stdout).toStartWith(`Session already imported: ses_foreign${os.EOL}`)
  } finally {
    await server.stop(true)
  }
}, 15_000)

test("requires a session choice outside an interactive terminal", async () => {
  const server = serve(() => undefined)
  try {
    const [stdout, stderr, exitCode] = await run([
      "session",
      "import",
      "--from",
      "opencode",
      "--server",
      server.url.toString(),
    ])
    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toBe(`Pass a session ID, --latest, or --pick${os.EOL}`)
  } finally {
    await server.stop(true)
  }
})
