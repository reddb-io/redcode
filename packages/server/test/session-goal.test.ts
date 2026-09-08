import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { webHandler } from "../src/routes"

const directory = await mkdtemp(path.join(os.tmpdir(), "goal-api-"))
const web = webHandler()
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (request) => web.handler(request),
})
const api = (route: string, method = "GET", input?: unknown) =>
  fetch(new URL(route, server.url), {
    method,
    headers: { "content-type": "application/json" },
    body: input === undefined ? undefined : JSON.stringify(input),
  })
afterAll(async () => {
  await server.stop(true)
  await web.dispose()
  await rm(directory, { recursive: true, force: true })
})

test("Goal API preserves identity through controls and admits a prompt in the selected mode", async () => {
  const created = await api("/api/session", "POST", { location: { directory }, agent: "plan" })
  expect(created.status).toBe(200)
  const session = await created.json()
  const route = `/api/session/${session.data.id}/goal`
  expect(await (await api(route)).json()).toEqual({ data: null })
  const started = await api(route, "POST", {
    objective: "Prepare a concrete implementation plan; gate: true",
    agent: "plan",
    maxTurns: 1,
  })
  expect(started.status).toBe(200)
  const goal = (await started.json()).data
  expect(goal.stopAfter).toBe("plan")
  expect(goal.executePlan).toBe(false)
  expect(goal.gates).toEqual(["true"])
  const paused = await api(route + "/control", "POST", { action: "pause" })
  expect(paused.status).toBe(200)
  expect((await paused.json()).data).toMatchObject({ id: goal.id, status: "paused" })
  const budget = await api(route + "/control", "POST", { action: "budget", maxTurns: 3 })
  expect((await budget.json()).data).toMatchObject({ id: goal.id, turns: { max: 3 } })
  const transcript = await (await api(`/api/session/${session.data.id}/history`)).json()
  expect(JSON.stringify(transcript)).toContain("Prepare a concrete implementation plan")
  expect((await api(route + "/control", "POST", { action: "drop" })).status).toBe(200)
  expect(await (await api(route)).json()).toEqual({ data: null })
  expect((await api(route, "POST", { objective: "Invalid", maxTurns: 0 })).status).toBe(400)
}, 30000)
