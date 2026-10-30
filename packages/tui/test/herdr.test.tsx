import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { createData } from "@opencode/client/solid"
import type { OpenCodeEvent, SessionInfo } from "@opencode/client"
import type { Route } from "@opencode/plugin/tui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import path from "node:path"
import { chmod } from "node:fs/promises"
import { startHerdr } from "../src/herdr"
import { session } from "./fixture/local"
import { createApi, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const environment = {
  HERDR_ENV: "1",
  HERDR_BIN_PATH: "herdr",
  HERDR_PANE_ID: "w1:p1",
  HERDR_SOCKET_PATH: "fixture-socket",
}

function renderSessions(sessions: SessionInfo[]) {
  const events = createGlobalEmitter<{ [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }>()
  const client = createApi(
    createFetch((url) => {
      const found = sessions.find((session) => url.pathname === `/api/session/${session.id}`)
      if (found) return json({ data: found })
    }).fetch,
  )
  return createRoot((dispose) => {
    const data = createData({ api: () => client, directory, event: events })
    const [route, setRoute] = createStore<Route>({ type: "home" })
    return {
      data,
      route: {
        get data() {
          return route
        },
        navigate(next: Route) {
          setRoute(reconcile(next))
        },
      },
      events: { emit: (event: OpenCodeEvent) => events.emit(event.type, event) },
      async [Symbol.asyncDispose]() {
        dispose()
        events.clear()
      },
    }
  })
}

async function setup(report?: (args: readonly string[]) => Promise<boolean>) {
  const local = renderSessions([session("root"), { ...session("child"), parentID: "root" }, session("other")])
  await Promise.all(["root", "child", "other"].map((id) => local.data.session.sync(id)))
  local.route.navigate({ type: "session", sessionID: "root" })
  const [connected, setConnected] = createSignal(true)
  const reports: (readonly string[])[] = []
  const input = {
    data: local.data,
    route: () => local.route.data,
    connected,
    resume: (session: { id: string }) => [
      "redcode",
      "--server",
      "http://localhost:4096",
      "--auto",
      "--session",
      session.id,
    ],
    environment,
    report: async (args: readonly string[]) => {
      reports.push(args)
      return report ? report(args) : true
    },
  }
  const close = startHerdr(input)!
  return {
    ...local,
    input,
    reports,
    setConnected,
    close,
    async [Symbol.asyncDispose]() {
      await close()
      await local[Symbol.asyncDispose]()
    },
  }
}

function value(args: readonly string[], flag: string) {
  const index = args.indexOf(flag)
  return index < 0 ? undefined : args[index + 1]
}

async function until(ready: () => boolean) {
  const failure = new Error("Timed out waiting for Herdr report")
  const deadline = Date.now() + 3_000
  while (!ready()) {
    if (Date.now() > deadline) throw failure
    await Bun.sleep(5)
  }
}

test("stays inactive outside a complete Herdr pane environment", async () => {
  await using fixture = await setup()
  await until(() => fixture.reports.length === 1)
  for (const key of Object.keys(environment)) {
    expect(startHerdr({ ...fixture.input, environment: { ...environment, [key]: undefined } })).toBeUndefined()
  }
  expect(startHerdr({ ...fixture.input, environment: { ...environment, HERDR_ENV: "0" } })).toBeUndefined()
  expect(fixture.reports).toHaveLength(1)
})

test("reports the selected session family, approvals, forms, reconnects and resume argv", async () => {
  await using fixture = await setup()
  await until(() => fixture.reports.length === 1)
  const first = fixture.reports[0]
  expect(value(first, "--state")).toBe("idle")
  expect(value(first, "--agent-session-id")).toBe("root")
  expect(first.slice(first.indexOf("--") + 1)).toEqual(fixture.input.resume({ id: "root" }))
  expect(value(first, "--source")).toBe("redcode.tui")
  expect(value(first, "--agent")).toBe("redcode")

  fixture.data.session.setStatus("other", "running")
  await Bun.sleep(20)
  expect(fixture.reports).toHaveLength(1)
  fixture.data.session.setStatus("child", "running")
  await until(() => value(fixture.reports.at(-1)!, "--state") === "working")
  fixture.events.emit({
    id: "permission",
    created: 1,
    type: "permission.asked",
    data: { id: "approval", sessionID: "child", action: "edit", resources: [], metadata: {}, save: [] },
  })
  await until(() => value(fixture.reports.at(-1)!, "--state") === "blocked")
  fixture.events.emit({
    id: "reply",
    created: 2,
    type: "permission.replied",
    data: { sessionID: "child", requestID: "approval", reply: "once" },
  })
  await until(() => value(fixture.reports.at(-1)!, "--state") === "working")
  fixture.events.emit({
    id: "form",
    created: 3,
    type: "form.created",
    location: session("child").location,
    data: {
      form: { id: "frm_question", sessionID: "child", title: "Choose", fields: [{ key: "answer", type: "string" }] },
    },
  })
  await until(() => value(fixture.reports.at(-1)!, "--state") === "blocked")
  fixture.events.emit({
    id: "cancel",
    created: 4,
    type: "form.cancelled",
    data: { sessionID: "child", id: "frm_question" },
  })
  await until(() => value(fixture.reports.at(-1)!, "--state") === "working")
  fixture.data.session.setStatus("child", "idle")
  await until(() => value(fixture.reports.at(-1)!, "--state") === "idle")
  fixture.route.navigate({ type: "session", sessionID: "child" })
  fixture.route.navigate({ type: "home" })
  await Bun.sleep(20)
  expect(value(fixture.reports.at(-1)!, "--agent-session-id")).toBe("root")
  fixture.setConnected(false)
  await until(() => value(fixture.reports.at(-1)!, "--state") === "unknown")
  fixture.setConnected(true)
  await until(() => value(fixture.reports.at(-1)!, "--state") === "idle")
  fixture.route.navigate({ type: "session", sessionID: "other" })
  await until(() => value(fixture.reports.at(-1)!, "--agent-session-id") === "other")
  expect(value(fixture.reports.at(-1)!, "--state")).toBe("working")
  await fixture.close()
  expect(fixture.reports.at(-1)?.slice(0, 3)).toEqual(["pane", "release-agent", "w1:p1"])
  const sequences = fixture.reports.map((args) => Number(value(args, "--seq")))
  expect(sequences.every((seq, i) => i === 0 || seq > sequences[i - 1])).toBe(true)
  const count = fixture.reports.length
  fixture.data.session.setStatus("other", "idle")
  await fixture.close()
  expect(fixture.reports).toHaveLength(count)
})

test("coalesces pending reports and releases only after the in-flight report", async () => {
  const gate = Promise.withResolvers<boolean>()
  await using fixture = await setup((args) => (args[1] === "report-agent" ? gate.promise : Promise.resolve(true)))
  await until(() => fixture.reports.length === 1)
  fixture.data.session.setStatus("root", "running")
  fixture.route.navigate({ type: "session", sessionID: "other" })
  fixture.data.session.setStatus("other", "running")
  fixture.data.session.setStatus("other", "idle")
  expect(fixture.reports).toHaveLength(1)
  gate.resolve(true)
  await until(() => fixture.reports.length === 2)
  expect(value(fixture.reports[1], "--agent-session-id")).toBe("other")
  expect(value(fixture.reports[1], "--state")).toBe("idle")
  await fixture.close()
  expect(fixture.reports).toHaveLength(3)
  expect(fixture.reports[2][1]).toBe("release-agent")
})

test("retries failed delivery with the newest state without another UI event", async () => {
  const attempts = { count: 0 }
  await using fixture = await setup(async () => ++attempts.count > 1)
  await until(() => attempts.count === 1)
  fixture.data.session.setStatus("root", "running")
  await until(() => fixture.reports.length === 2)
  expect(value(fixture.reports[1], "--state")).toBe("working")
})

test("loads an uncached root on direct child attachment and tracks location-wide forms", async () => {
  await using local = renderSessions([session("root"), { ...session("child"), parentID: "root" }])
  await local.data.session.sync("child")
  local.route.navigate({ type: "session", sessionID: "child" })
  const reports: (readonly string[])[] = []
  const close = startHerdr({
    data: local.data,
    route: () => local.route.data,
    connected: () => true,
    resume: (session) => ["redcode", "--session", session.id],
    environment,
    report: async (args) => {
      reports.push(args)
      return true
    },
  })!
  await using cleanup = { [Symbol.asyncDispose]: close }
  await until(() => value(reports.at(-1) ?? [], "--agent-session-id") === "root")
  local.events.emit({
    id: "global-form",
    created: 1,
    type: "form.created",
    location: session("root").location,
    data: {
      form: { id: "frm_global", sessionID: "global", title: "Sign in", fields: [{ key: "code", type: "string" }] },
    },
  })
  await until(() => value(reports.at(-1)!, "--state") === "blocked")
  local.events.emit({
    id: "global-cancel",
    created: 2,
    type: "form.cancelled",
    location: session("root").location,
    data: { id: "frm_global", sessionID: "global" },
  })
  await until(() => value(reports.at(-1)!, "--state") === "idle")
})

test("clears the previous resume command when the selected session is deleted", async () => {
  await using fixture = await setup()
  await until(() => fixture.reports.length === 1)
  fixture.events.emit({
    id: "deleted",
    created: 1,
    type: "session.deleted",
    durable: { aggregateID: "root", seq: 1, version: 2 },
    data: { sessionID: "root" },
  })
  await until(() => fixture.reports.length >= 3)
  expect(fixture.reports[1][1]).toBe("release-agent")
  expect(fixture.reports[2][1]).toBe("report-agent")
  expect(fixture.reports[2]).not.toContain("--")
})

test.skipIf(process.platform === "win32")(
  "sends literal argv through a real executable and bounds a stalled Herdr",
  async () => {
    await using temporary = await tmpdir()
    await using fixture = await setup()
    await fixture.close()
    const binary = path.join(temporary.path, "herdr fixture")
    const output = path.join(temporary.path, "reports.jsonl")
    await Bun.write(
      binary,
      [
        "#!/bin/sh",
        'printf \'%s\\n\' "$@" >> "$HERDR_TEST_REPORTS"',
        "printf 'END\\n' >> \"$HERDR_TEST_REPORTS\"",
        'if [ "$HERDR_TEST_STALL" = 1 ]; then exec sleep 30; fi',
        "",
      ].join("\n"),
    )
    await chmod(binary, 0o755)
    const close = startHerdr({
      ...fixture.input,
      report: undefined,
      environment: { ...process.env, ...environment, HERDR_BIN_PATH: binary, HERDR_TEST_REPORTS: output },
    })!
    await until(() => Bun.file(output).size > 0)
    await close()
    const reports = (await Bun.file(output).text())
      .trim()
      .split("END")
      .filter((record) => record.trim())
      .map((record) => record.trim().split("\n"))
    expect(reports[0].slice(reports[0].indexOf("--") + 1)).toEqual(fixture.input.resume({ id: "root" }))
    expect(reports.at(-1)?.[1]).toBe("release-agent")
    const started = Date.now()
    const stop = startHerdr({
      ...fixture.input,
      report: undefined,
      environment: {
        ...process.env,
        ...environment,
        HERDR_BIN_PATH: binary,
        HERDR_TEST_REPORTS: output,
        HERDR_TEST_STALL: "1",
      },
    })!
    await stop()
    expect(Date.now() - started).toBeLessThan(3_000)
  },
)
