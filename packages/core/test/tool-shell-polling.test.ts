import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Monitor } from "@reddb-io/redcode-schema/monitor"
import { ShellPolling } from "@reddb-io/redcode-core/tool/shell-polling"
import { shellPollingProbes } from "./fixture/shell-polling-probes"

/** The shape of a monitor retry, independent of any runtime's bash parameters. */
const Retry = Schema.Struct({
  command: Schema.String,
  workdir: Schema.optional(Schema.String),
  monitor: Monitor.Options,
})

const decodeControl = Schema.decodeUnknownSync(Monitor.Control)
shellPollingProbes(Schema.decodeUnknownSync(Retry), (call) => {
  const control = decodeControl(call)
  const problem = control.probe && Monitor.probeProblem(control.probe)
  if (problem) throw new Error(problem)
  return control
})

describe("shell polling guard without monitors", () => {
  const lines = (text: string) =>
    text
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line))

  test("offers a single check and a bounded wait that the guard itself allows, never a monitor", () => {
    for (const command of [
      `for i in 1..12; do sleep 300; gh run view 123 --json status -q .status | grep -q completed && break; done`,
      `for i in $(seq 1 30); do sleep 60; PENDING=$(gh pr checks 198 | grep -c pending); if [ "$PENDING" -eq 0 ]; then break; fi; done`,
      "until curl -sf http://localhost:3000/health; do sleep 2; done",
      "until grep -q PASSED ci.log; do sleep 5; done && pnpm deploy",
      "while pgrep -f 'vite build'; do sleep 2; done",
      "watch -n 10 kubectl get pods",
      "sleep 60",
    ]) {
      const refusal = ShellPolling.boundedRefusal(ShellPolling.detect(command)!, "/repo")
      expect(refusal).toContain("Long waits are not supported in this mode")
      expect(refusal).not.toContain('"monitor"')
      const calls = lines(refusal)
      expect(calls).toHaveLength(2)
      for (const call of calls) {
        expect(call.workdir).toBe("/repo")
        expect({ command: call.command, detection: ShellPolling.detect(call.command) }).toEqual({
          command: call.command,
          detection: undefined,
        })
      }
    }
  })

  test("keeps the success text of the loop in the bounded wait", () => {
    const refusal = ShellPolling.boundedRefusal(
      ShellPolling.detect(
        `for i in 1..12; do sleep 300; gh run view 123 --json status -q .status | grep -q completed && break; done`,
      )!,
    )
    expect(lines(refusal)).toEqual([
      { command: "gh run view 123 --json status,conclusion" },
      {
        command:
          "for i in 1 2 3 4 5; do gh run view 123 --json status,conclusion | grep -q 'completed' && break; sleep 5; done",
      },
    ])
  })

  test("a sleep in front of real work runs that work now", () => {
    const refusal = ShellPolling.boundedRefusal(ShellPolling.detect("git push && sleep 45 && npm test")!)
    expect(refusal).toContain("Run the part before the wait first, as its own bash call without any sleep: git push")
    expect(lines(refusal)).toEqual([{ command: "npm test" }])
  })
})
