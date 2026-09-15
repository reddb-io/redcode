import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ShellPolling } from "../../src/tool/shell/polling"
import { Parameters } from "../../src/tool/shell/prompt"

const decode = Schema.decodeUnknownSync(Parameters)

/** The retry a model would send, checked against the real bash parameters. */
function retry(command: string, workdir?: string) {
  const detection = ShellPolling.detect(command)
  expect(detection?.suggestion).toBeDefined()
  const call = JSON.parse(ShellPolling.call(detection!.suggestion!, workdir))
  expect(() => decode(call)).not.toThrow()
  // The refusal carries exactly that call, on a line of its own.
  const refusal = ShellPolling.refusal(detection!, workdir)
  expect(refusal.split("\n")).toContain(ShellPolling.call(detection!.suggestion!, workdir))
  return { detection: detection!, call, refusal }
}

describe("shell polling guard", () => {
  test("catches the gh run view sleep loop from production", () => {
    const { detection, call, refusal } = retry(
      `for i in {1..12}; do sleep 300; STATUS=$(gh run view 17234567890 --json status -q '.status'); case "$STATUS" in completed) break;; esac; done`,
    )
    expect(detection.kind).toBe("loop")
    expect(detection.waitMs).toBe(3_600_000)
    expect(call).toEqual({
      command: "gh run view 17234567890 --json status,conclusion",
      monitor: { mode: "poll", interval_ms: 300_000, deadline_ms: 3_900_000, success_contains: "completed" },
    })
    expect(refusal).toContain("for up to 1h")
  })

  test("catches the multi-line gh run view loop with a status and conclusion query", () => {
    const { call } = retry(
      [
        "for i in $(seq 1 12); do",
        "  sleep 300",
        "  STATUS=$(gh run view 42 --repo reddb-io/redcode --json status,conclusion -q .status)",
        '  if [ "$STATUS" = "completed" ]; then break; fi',
        "done",
      ].join("\n"),
    )
    expect(call.command).toBe("gh run view 42 --repo reddb-io/redcode --json status,conclusion")
    expect(call.monitor.success_contains).toBe("completed")
  })

  test("catches the gh pr checks pending-count loop from production", () => {
    const { detection, call } = retry(
      `for i in $(seq 1 30); do sleep 60; PENDING=$(gh pr checks 198 | grep -c pending); if [ "$PENDING" -eq 0 ]; then break; fi; done`,
    )
    expect(detection.kind).toBe("loop")
    expect(detection.waitMs).toBe(1_800_000)
    expect(call).toEqual({
      command: "gh pr checks 198",
      monitor: { mode: "poll", interval_ms: 60_000, deadline_ms: 1_860_000, failure_contains: "fail" },
    })
  })

  test("keeps the setup ahead of a loop out of the monitor", () => {
    const { detection, refusal } = retry(
      "git push origin feature && while gh pr checks 12 | grep -q pending; do sleep 90; done",
    )
    expect(detection.before).toBe("git push origin feature")
    expect(refusal).toContain("git push origin feature")
  })

  test("turns a readiness loop into a monitor whose success is the exit code", () => {
    const { call, refusal } = retry("until curl -sf http://localhost:3000/health; do sleep 2; done", "/repo/app")
    expect(call).toEqual({
      command: "curl -sf http://localhost:3000/health",
      workdir: "/repo/app",
      monitor: { mode: "poll", interval_ms: 2_000, deadline_ms: 3_600_000 },
    })
    expect(refusal).toContain("exit code 0 means done")
    expect(retry("while ! kubectl rollout status deploy/api --timeout=5s; do sleep 10; done").call.command).toBe(
      "kubectl rollout status deploy/api --timeout=5s",
    )
  })

  test("refuses a long single sleep, and builds the monitor from the check after it", () => {
    const bare = ShellPolling.detect("sleep 60")
    expect(bare).toMatchObject({ kind: "sleep", waitMs: 60_000 })
    expect(bare?.suggestion).toBeUndefined()
    const text = ShellPolling.refusal(bare!)
    for (const example of ShellPolling.EXAMPLES) expect(() => decode(JSON.parse(ShellPolling.call(example)))).not.toThrow()
    expect(text).toContain('{"command":"gh pr checks 123"')
    expect(ShellPolling.detect("Start-Sleep -Seconds 120")?.kind).toBe("sleep")

    const { detection, call } = retry("git push && sleep 5m && gh run view 42 --json status")
    expect(detection.before).toBe("git push")
    expect(call.command).toBe("gh run view 42 --json status,conclusion")
    expect(call.monitor.interval_ms).toBe(300_000)
  })

  test("handles watch and gh's own blocking watchers", () => {
    expect(retry("watch -n 10 kubectl get pods").call).toEqual({
      command: "kubectl get pods",
      monitor: { mode: "poll", interval_ms: 10_000, deadline_ms: 3_600_000 },
    })
    expect(retry("gh run watch 42").call.command).toBe("gh run view 42 --json status,conclusion")
    const checks = retry("gh pr checks 7 --watch --interval 30").call
    expect(checks.command).toBe("gh pr checks 7")
    expect(checks.monitor.interval_ms).toBe(30_000)
  })

  test("allows short sleeps, one-off checks and loops that observe nothing", () => {
    for (const command of [
      "sleep 2 && curl -s localhost:3000",
      "sleep 29",
      "sleep 0.5; gh pr checks 198",
      "gh pr checks 198",
      "gh run view 42 --json status,conclusion",
      'for f in src/*.ts; do echo "$f"; done',
      "for i in 1 2 3; do echo $i; sleep 1; done",
      "while read line; do curl -s \"$line\"; done < urls.txt",
      "git commit -m 'wait: for i in 1 2; do sleep 300; gh run view 1; done'",
      'echo "sleep 300 # later"',
      "bun test --timeout 60000",
      "docker compose up -d --wait",
      "gh run view 42 --log | grep -n watch",
    ])
      expect({ command, detection: ShellPolling.detect(command) }).toEqual({ command, detection: undefined })
  })
})
