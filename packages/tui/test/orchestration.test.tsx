import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { orchestrationFixture } from "./fixture/orchestration"

test("orchestration preserves the selected assignment across resize and uses explicit native controls", async () => {
  await using state = await tmpdir()
  const fixture = orchestrationFixture()
  await using app = await createAppFixture({
    state: state.path,
    width: 150,
    height: 55,
    config: { animations: false, tabs: { mode: "off" }, session: { sidebar: "hide" } },
    args: { sessionID: fixture.sessions[0].id },
    fetch: fixture.fetch,
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("commands"))
  expect(fixture.requests.filter((item) => item.query.includes("limit=6"))).toHaveLength(0)
  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("Suggested"))
  await app.mockInput.typeText("Open orchestration")
  await app.waitForFrame((frame) => frame.includes("Open orchestration") && !frame.includes("Open Subagents drawer"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("3 sessions") && frame.includes("Map authentication"))
  expect(app.captureCharFrame()).toContain("Model: red-router / chosen-model")
  expect(app.captureCharFrame()).not.toContain("Quality checks")
  expect(app.captureCharFrame()).not.toContain("Usage")
  expect(fixture.requests.filter((item) => item.query.includes("limit=6"))).toHaveLength(0)
  expect(app.captureCharFrame()).not.toContain("private-gateway")
  expect(app.captureCharFrame()).not.toContain("100%")
  if (process.env.REDCODE_ORCHESTRATION_CAPTURE) await capture(app, "wide")
  app.mockInput.pressArrow("down")
  await app.waitForFrame((frame) => frame.includes("Model: red-router / worker-model"))
  app.resize(62, 30)
  await app.waitForFrame((frame) => frame.includes("├─ Map authentication"))
  expect(app.captureCharFrame()).toMatch(/Map authentication\s+Running/)
  if (process.env.REDCODE_ORCHESTRATION_CAPTURE) await capture(app, "narrow")
  const reads = fixture.requests.filter((item) => item.query.includes("limit=6")).length
  app.events.emit({
    id: "evt_orch_renamed",
    created: 3000,
    type: "session.renamed",
    durable: { aggregateID: "ses_orch_search", seq: 1, version: 1 },
    data: { sessionID: "ses_orch_search", title: "Review authentication" },
  })
  await app.waitForFrame((frame) => frame.includes("Review authentication"))
  expect(app.captureCharFrame()).toContain("Model: red-router / worker-model")
  expect(fixture.requests.filter((item) => item.query.includes("limit=6"))).toHaveLength(reads)
  app.mockInput.pressKey("i")
  await app.waitForFrame((frame) => frame.includes("Agent details"))
  app.resize(150, 55)
  await app.waitForFrame((frame) => frame.includes("jev-fixture") && frame.includes("Accepted · tool usage"))
  expect(fixture.requests.filter((item) => item.query.includes("limit=6"))).toHaveLength(1)
  expect(app.captureCharFrame()).not.toContain("private-gateway")
  if (process.env.REDCODE_ORCHESTRATION_CAPTURE) await capture(app, "details")
  app.resize(62, 30)
  await app.waitForVisualIdle()
  await app.mockInput.pressKeys(["\u001b[6~", "\u001b[6~", "\u001b[6~"])
  await app.waitForFrame((frame) => frame.includes("Accepted · tool usage"))
  app.mockInput.pressKey("e")
  await app.waitForFrame((frame) => frame.includes("Steer selected agent"))
  await app.mockInput.typeText("Inspect only authentication")
  app.mockInput.pressEnter()
  await app.waitFor(() => fixture.requests.some((item) => item.path.endsWith("/prompt")))
  expect(fixture.requests.filter((item) => item.path.endsWith("/prompt"))).toEqual([
    expect.objectContaining({
      path: "/api/session/ses_orch_search/prompt",
      method: "POST",
      body: { text: "Inspect only authentication", delivery: "steer" },
    }),
  ])
  app.mockInput.pressKey("d", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("Interrupt selected agent"))
  expect(fixture.requests.filter((item) => item.path.endsWith("/interrupt"))).toHaveLength(0)
  app.mockInput.pressEnter()
  await app.waitFor(() => fixture.requests.some((item) => item.path.endsWith("/interrupt")))
  expect(fixture.requests.filter((item) => item.path.endsWith("/interrupt"))).toEqual([
    expect.objectContaining({ path: "/api/session/ses_orch_search/interrupt", method: "POST" }),
  ])
  fixture.fail()
  app.mockInput.pressKey("r")
  await app.waitForFrame((frame) => frame.includes("Evaluation data is unavailable"))
  expect(app.captureCharFrame()).not.toContain("Accepted · tool usage")
  app.mockInput.pressKey("i")
  await app.waitForFrame((frame) => frame.includes("Execution") && frame.includes("Model: red-router / worker-model"))
  expect(app.captureCharFrame()).not.toContain("Evaluation data is unavailable")
  const closedReads = fixture.requests.filter((item) => item.query.includes("limit=6")).length
  app.mockInput.pressKey("r")
  await app.renderOnce()
  expect(fixture.requests.filter((item) => item.query.includes("limit=6"))).toHaveLength(closedReads)
  expect(fixture.requests.filter((item) => /\/ses_orch_(search|test)\/message$/.test(item.path))).toHaveLength(0)
  app.mockInput.pressEnter()
  await app.waitFor(() => fixture.requests.some((item) => item.path === "/api/session/ses_orch_search/message"))
})

async function capture(app: Awaited<ReturnType<typeof createAppFixture>>, name: string) {
  await Bun.write(
    `${process.env.REDCODE_ORCHESTRATION_CAPTURE}-${name}.json`,
    JSON.stringify({
      frame: app.captureCharFrame(),
      lines: app.captureSpans().lines.map((line) =>
        line.spans.map((span) => ({
          text: span.text,
          fg: span.fg.toInts(),
          bg: span.bg.toInts(),
          attributes: span.attributes,
        })),
      ),
    }),
  )
}

test("orchestration honors custom controls and stops reading evaluations when closed", async () => {
  await using state = await tmpdir()
  const fixture = orchestrationFixture()
  await using app = await createAppFixture({
    state: state.path,
    width: 80,
    height: 35,
    config: {
      animations: false,
      theme: { mode: "light" },
      tabs: { mode: "off" },
      session: { sidebar: "hide" },
      keybinds: {
        "composer.orchestration.down": "f6",
        "composer.orchestration.steer": "none",
        "composer.orchestration.details": "f7",
      },
    },
    args: { sessionID: fixture.sessions[0].id },
    fetch: fixture.fetch,
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("commands"))
  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("Suggested"))
  await app.mockInput.typeText("Open orchestration")
  await app.waitForFrame((frame) => frame.includes("Open orchestration"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("3 sessions"))
  app.mockInput.pressArrow("down")
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("Model: red-router / chosen-model")
  app.mockInput.pressKey("F6")
  await app.waitForFrame((frame) => frame.includes("Model: red-router / worker-model"))
  app.mockInput.pressKey("e")
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toContain("Steer selected agent")
  expect(fixture.requests.some((item) => item.method === "POST")).toBe(false)
  app.resize(44, 24)
  await app.waitForFrame((frame) => frame.includes("├─ Map authentication"))
  if (process.env.REDCODE_ORCHESTRATION_CAPTURE) await capture(app, "light-small")
  app.mockInput.pressKey("i")
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toContain("Agent details")
  expect(fixture.requests.filter((item) => item.query.includes("limit=6"))).toHaveLength(0)
  app.mockInput.pressKey("F7")
  await app.waitForFrame((frame) => frame.includes("Agent details"))
  await app.waitFor(() => fixture.requests.some((item) => item.query.includes("limit=6")))
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("Orchestration"))
  const reads = fixture.requests.filter((item) => item.query.includes("limit=6")).length
  app.events.emit({
    id: "evt_orch_closed",
    created: 3000,
    type: "session.renamed",
    durable: { aggregateID: "ses_orch_search", seq: 1, version: 1 },
    data: { sessionID: "ses_orch_search", title: "Renamed while closed" },
  })
  app.mockInput.pressKey("r")
  await app.renderOnce()
  expect(fixture.requests.filter((item) => item.query.includes("limit=6"))).toHaveLength(reads)
  expect(fixture.requests.some((item) => item.method === "POST")).toBe(false)
})

test.skipIf(!process.env.REDCODE_COMPOSER_BENCH)("production session frame benchmark", async () => {
  await using state = await tmpdir()
  const fixture = orchestrationFixture()
  await using app = await createAppFixture({
    state: state.path,
    args: { sessionID: fixture.sessions[0].id },
    fetch: fixture.fetch,
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("Ship the API"))
  const samples: number[] = []
  for (let index = 0; index < 45; index++) {
    const started = performance.now()
    await app.renderOnce()
    if (index >= 5) samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  expect(samples).toHaveLength(40)
  await Bun.write(
    process.env.REDCODE_COMPOSER_BENCH!,
    JSON.stringify(
      {
        component: "Session",
        width: 100,
        height: 30,
        samples: samples.length,
        medianMs: samples[Math.floor(samples.length / 2)],
        p95Ms: samples[Math.floor(samples.length * 0.95)],
      },
      null,
      2,
    ),
  )
})
