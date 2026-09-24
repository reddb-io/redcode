/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { SubagentView } from "@reddb-io/redcode-core/session/subagent-view"
import {
  GuardTripLine,
  guardTripsAt,
  guardTripTitle,
  SubagentBrief,
  SubagentList,
  SubagentSummary,
} from "../../src/routes/session/subagent"
import { mountDialog } from "../fixture/dialog"
import { tmpdir } from "../fixture/fixture"

const model = { providerID: "anthropic", modelID: "claude-opus-5", variant: "high" }

type Setup = Awaited<ReturnType<typeof mountDialog>>

async function screen(children: () => JSX.Element, text: string) {
  await using tmp = await tmpdir()
  const setup = await mountDialog({ root: tmp.path, children })
  try {
    return await frameWith(setup, text)
  } finally {
    setup.renderer.destroy()
  }
}

/** Renders until the frame shows `text`: a click only changes state, the next render shows it. */
async function frameWith(setup: Setup, text: string, timeout = 10_000) {
  const start = Date.now()
  while (true) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (frame.includes(text)) return frame
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${JSON.stringify(text)}\n${frame}`)
    await Bun.sleep(10)
  }
}

function click(setup: Setup, label: string, row = 0) {
  const lines = setup.captureCharFrame().split("\n")
  const matches = lines.flatMap((line, index) => (line.includes(label) ? [index] : []))
  const y = matches[row]
  if (y === undefined) throw new Error(`no "${label}" on screen`)
  return setup.mockMouse.click(lines[y]!.indexOf(label) + 1, y)
}

test("a task row shows the model and variant, each verdict badge and the checkpoint state", async () => {
  const frame = await screen(
    () => (
      <box>
        <text>
          <SubagentSummary model={model} decision="verified" checkpoint={{ type: "in_scope" }} />
        </text>
        <text>
          <SubagentSummary
            model={{ providerID: "openai", modelID: "gpt-6" }}
            decision="inconclusive"
            checkpoint={{ type: "corrected", line: "S1 · no progress for 5 steps" }}
          />
        </text>
        <text>
          <SubagentSummary decision="needs_revision" checkpoint={{ type: "in_scope" }} />
        </text>
        <text>
          <SubagentSummary
            decision="unverified"
            checkpoint={{
              type: "stopped",
              line: "S1 · no progress for 9 steps",
              reason: "it is waiting on something outside the session",
            }}
          />
        </text>
      </box>
    ),
    "unverified",
  )
  expect(frame).toContain("claude-opus-5 (high) · ✓ verified · in scope")
  expect(frame).toContain("gpt-6 · ? inconclusive · corrected (hint sent)")
  expect(frame).toContain("! needs revision · in scope")
  expect(frame).toContain("~ unverified · stopped · it is waiting on something outside the session")
})

test("a task row falls back to the child session's model and reads a background verdict from the child", () => {
  const child = {
    model: { id: "claude-sonnet-5", providerID: "anthropic", variant: "low" },
    metadata: {
      [SubagentView.BRIEF_KEY]: { brief: "Find the bug", result: { decision: "needs_revision", issues: [] } },
    },
  }
  expect(SubagentView.model({}, child)).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-5", variant: "low" })
  expect(SubagentView.model({ model: { providerID: "openai", modelID: "gpt-6" }, variant: "max" }, child)).toEqual({
    providerID: "openai",
    modelID: "gpt-6",
    variant: "max",
  })
  expect(SubagentView.decision({}, child.metadata)).toBe("needs_revision")
  expect(SubagentView.decision({ review: { decision: "verified" } }, child.metadata)).toBe("verified")
})

test("the subagent footer keeps the brief collapsed to its goal and lists the checkpoints", async () => {
  await using tmp = await tmpdir()
  const setup = await mountDialog({
    root: tmp.path,
    children: () => (
      <SubagentBrief
        brief={{
          goal: "Find why the login test fails",
          scope: ["packages/auth/**"],
          criteria: ["the failing test passes"],
          returnFormat: "a short report",
        }}
        checkpoints={[
          { action: "steer", line: "S1 · no progress for 5 steps", at: 1 },
          { action: "stop", line: "S1 · no progress for 9 steps", reason: "it is going around in circles", at: 2 },
        ]}
      />
    ),
  })
  try {
    const collapsed = await frameWith(setup, "Brief")
    expect(collapsed).toContain("▸ Brief — Find why the login test fails")
    expect(collapsed).not.toContain("packages/auth/**")
    expect(collapsed).toContain("S1 · no progress for 5 steps · hint sent")
    expect(collapsed).toContain("S1 · no progress for 9 steps · stopped: it is going around in circles")

    await click(setup, "Brief")
    const open = await frameWith(setup, "packages/auth/**")
    expect(open).toContain("▾ Brief")
    expect(open).toContain("Goal Find why the login test fails")
    expect(open).toContain("the failing test passes")
    expect(open).toContain("Return format a short report")
  } finally {
    setup.renderer.destroy()
  }
})

test("the sidebar lists subagents with status, model and verdict, and opens or kills one", async () => {
  await using tmp = await tmpdir()
  const calls: string[] = []
  const setup = await mountDialog({
    root: tmp.path,
    children: () => (
      <SubagentList
        items={[
          { id: "ses_running", title: "Scan the logs", status: "running", model },
          { id: "ses_done", title: "Fix the parser", status: "done", decision: "verified" },
          { id: "ses_stopped", title: "Wait for the phone", status: "stopped" },
        ]}
        onOpen={(id) => calls.push(`open ${id}`)}
        onSteer={(id) => calls.push(`steer ${id}`)}
        onKill={(id) => calls.push(`kill ${id}`)}
      />
    ),
  })
  try {
    const frame = await frameWith(setup, "Wait for the phone")
    expect(frame).toContain("● Scan the logs")
    expect(frame).toContain("running · claude-opus-5 (high)")
    expect(frame).toContain("✓ Fix the parser")
    expect(frame).toContain("done · ✓ verified")
    expect(frame).toContain("■ Wait for the phone")
    expect(frame).toContain("stopped")
    // Only a running subagent can be steered or killed.
    expect(frame.split("kill")).toHaveLength(2)
    expect(frame.split("steer")).toHaveLength(2)

    await click(setup, "open", 1)
    await click(setup, "kill")
    await click(setup, "steer")
    expect(calls).toEqual(["open ses_done", "kill ses_running", "steer ses_running"])
  } finally {
    setup.renderer.destroy()
  }
})

test("a guard trip shows as one collapsed line that expands to its detail", async () => {
  await using tmp = await tmpdir()
  const detail = "task updates kept failing (8 in a row); the turn was ended so the model stops retrying the same call"
  const setup = await mountDialog({
    root: tmp.path,
    children: () => (
      <GuardTripLine trip={{ id: "evt_1", guard: "loop", action: "stop", subject: "todowrite", detail, time: 1 }} />
    ),
  })
  try {
    const collapsed = await frameWith(setup, "Guard")
    expect(collapsed).toContain("▸ Guard · loop guard stopped · todowrite — task updates kept failing")
    expect(collapsed).not.toContain("retrying the same call")

    await click(setup, "Guard")
    expect((await frameWith(setup, "▾ Guard")).replace(/\s+/g, " ")).toContain("retrying the same call")
  } finally {
    setup.renderer.destroy()
  }
})

test("each guard trip sits after the message that was latest when it tripped", () => {
  const messages = [{ time: { created: 100 } }, { time: { created: 200 } }, { time: { created: 300 } }]
  const trip = (id: string, time: number) => ({ id, guard: "stop_loss", action: "correct", detail: "", time })
  const trips = [trip("early", 50), trip("first", 150), trip("second", 250), trip("late", 900)]
  expect(guardTripsAt(messages, trips, 0).map((item) => item.id)).toEqual(["early", "first"])
  expect(guardTripsAt(messages, trips, 1).map((item) => item.id)).toEqual(["second"])
  expect(guardTripsAt(messages, trips, 2).map((item) => item.id)).toEqual(["late"])
  expect(guardTripTitle({ guard: "stop_loss", action: "correct" })).toBe("stop-loss corrected")
  expect(guardTripTitle({ guard: "new_guard", action: "warn", subject: "bash" })).toBe("new_guard warned · bash")
})
