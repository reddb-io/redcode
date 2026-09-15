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
  test("catches the gh run view sleep loops from production, with the one-hour deadline they meant", () => {
    for (const command of [
      `for i in 1..12; do sleep 300; gh run view 123 --json status -q .status | grep -q completed && break; done`,
      `for i in 1..12; do sleep 300; S=$(gh run view 123 --json status -q .status); case $S in completed) break;; esac; done`,
      `for i in {1..12}; do sleep 300; STATUS=$(gh run view 123 --json status -q '.status'); case "$STATUS" in completed) break;; esac; done`,
    ]) {
      const { detection, call, refusal } = retry(command)
      expect(detection).toMatchObject({ kind: "loop", waitMs: 3_600_000 })
      expect(call).toEqual({
        command: "gh run view 123 --json status,conclusion",
        monitor: { mode: "poll", interval_ms: 300_000, deadline_ms: 3_900_000, success_contains: "completed" },
      })
      expect(refusal).toContain("for up to 1h")
    }
  })

  test("catches the multi-line gh run view loop", () => {
    const { detection, call } = retry(
      [
        "for i in $(seq 1 12)",
        "do",
        "  sleep 300",
        "  STATUS=$(gh run view 42 --repo reddb-io/redcode --json status,conclusion -q .status)",
        '  if [ "$STATUS" = "completed" ]; then break; fi',
        "done",
      ].join("\n"),
    )
    expect(detection.waitMs).toBe(3_600_000)
    expect(call.command).toBe("gh run view 42 --repo reddb-io/redcode --json status,conclusion")
    expect(call.monitor.success_contains).toBe("completed")
  })

  test("catches the gh pr checks loops from production", () => {
    expect(
      retry(
        `for i in $(seq 1 30); do sleep 60; PENDING=$(gh pr checks 198 | grep -c pending); if [ "$PENDING" -eq 0 ]; then break; fi; done`,
      ).call,
    ).toEqual({
      command: "gh pr checks 198",
      monitor: { mode: "poll", interval_ms: 60_000, deadline_ms: 1_860_000, failure_contains: "fail" },
    })
    const { detection, call } = retry(`for i in $(seq 1 12); do sleep 60; gh pr checks 241 | grep -c pending; done`)
    expect(detection.waitMs).toBe(720_000)
    expect(call.command).toBe("gh pr checks 241")
  })

  test("refuses unbounded polling loops, whatever the sleep", () => {
    expect(retry(`while true; do gh run view 5 --json status; sleep 60; done`).detection.waitMs).toBeUndefined()
    expect(retry(`while :; do gh pr checks 1 && break; sleep $D; done`).call.command).toBe("gh pr checks 1")
    const docker = retry(`docker compose up -d && until docker compose exec db pg_isready; do sleep 1; done`)
    expect(docker.detection.before).toBe("docker compose up -d")
    expect(docker.call.command).toBe("docker compose exec db pg_isready")
  })

  test("keeps the setup ahead of a loop out of the monitor, and keeps it in the background", () => {
    const { detection, refusal } = retry(
      "git push origin feature && while gh pr checks 12 | grep -q pending; do sleep 90; done",
    )
    expect(detection.before).toBe("git push origin feature")
    expect(refusal).toContain("git push origin feature")
    expect(
      retry("bun run dev > /tmp/dev.log 2>&1 & until curl -sf localhost:3000; do sleep 1; done").detection.before,
    ).toBe("bun run dev > /tmp/dev.log 2>&1 &")
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

  test("reads the script inside bash -c and sh -c instead of cutting fragments out of the quotes", () => {
    for (const command of [
      `bash -c "for i in 1 2 3; do sleep 300; gh pr checks 1; done"`,
      `sh -c 'for i in 1 2 3; do sleep 300; gh pr checks 1; done'`,
    ]) {
      const { detection, call, refusal } = retry(command)
      expect(detection).toMatchObject({ kind: "loop", waitMs: 900_000 })
      expect(detection.before).toBeUndefined()
      expect(call.command).toBe("gh pr checks 1")
      expect(refusal).not.toContain("bash -c")
    }
    const wrapped = retry(`timeout 600 bash -c 'until curl -sf localhost:3000; do sleep 5; done'`)
    expect(wrapped.detection.before).toBeUndefined()
    expect(wrapped.call.command).toBe("curl -sf localhost:3000")
    expect(ShellPolling.detect(`bash -c 'echo ready; sleep 1'`)).toBeUndefined()
  })

  test("refuses a long single sleep, and builds the monitor from the check after it", () => {
    for (const command of ["sleep 60", "sleep 5m"]) {
      const bare = ShellPolling.detect(command)
      expect(bare?.kind).toBe("sleep")
      expect(bare?.suggestion).toBeUndefined()
      expect(ShellPolling.refusal(bare!)).toContain('{"command":"gh pr checks 123"')
    }
    for (const example of ShellPolling.EXAMPLES)
      expect(() => decode(JSON.parse(ShellPolling.call(example)))).not.toThrow()

    const { detection, call } = retry("git push && sleep 5m && gh run view 42 --json status")
    expect(detection.before).toBe("git push")
    expect(call.command).toBe("gh run view 42 --json status,conclusion")
    expect(call.monitor.interval_ms).toBe(300_000)
    expect(retry("sleep 300 && gh pr checks 3").call.command).toBe("gh pr checks 3")
    expect(retry("Start-Sleep 60; gh pr checks 1").detection.kind).toBe("sleep")
    expect(retry("timeout /t 60 && gh pr checks 1").call.command).toBe("gh pr checks 1")
  })

  test("handles watch and gh's own blocking watchers, behind timeout too", () => {
    expect(retry("watch -n 10 kubectl get pods").call).toEqual({
      command: "kubectl get pods",
      monitor: { mode: "poll", interval_ms: 10_000, deadline_ms: 3_600_000 },
    })
    expect(retry("watch -n 30 gh pr checks 9").call).toMatchObject({
      command: "gh pr checks 9",
      monitor: { interval_ms: 30_000 },
    })
    expect(retry("gh run watch 42").call.command).toBe("gh run view 42 --json status,conclusion")
    const timed = retry("timeout 600 gh run watch 42")
    expect(timed.detection).toMatchObject({ kind: "watch" })
    expect(timed.detection.before).toBeUndefined()
    const checks = retry("gh pr checks 7 --watch --interval 30").call
    expect(checks.command).toBe("gh pr checks 7")
    expect(checks.monitor.interval_ms).toBe(30_000)
  })

  test("allows short sleeps, short retry loops, one-off checks and loops that observe nothing", () => {
    for (const command of [
      "sleep 2 && curl -s localhost:3000",
      "sleep 29",
      "sleep 0.5; gh pr checks 198",
      "gh pr checks 198",
      "gh run view 42 --json status,conclusion",
      `for i in 1 2 3; do curl -fsS https://api.example.com && break; sleep 2; done`,
      `bun run dev > /tmp/dev.log 2>&1 & for i in $(seq 1 20); do curl -sf localhost:3000 >/dev/null && break; sleep 0.5; done`,
      'for f in src/*.ts; do echo "$f"; done',
      "for i in 1 2 3; do echo $i; sleep 1; done",
      'while read line; do curl -s "$line"; done < urls.txt',
      "git commit -m 'wait: for i in 1 2; do sleep 300; gh run view 1; done'",
      "git commit -F - <<'EOF'\nfix: retry\n\nsleep 60 between attempts\nEOF",
      `gh pr create --title x --body "Retries: sleep 60; then gh pr checks"`,
      'echo "sleep 300 # later"',
      "bun test test/foo.test.ts --timeout 120000",
      "./scripts/wait-ci.sh",
      "docker compose up -d --wait",
      "gh run view 42 --log | grep -n watch",
    ])
      expect({ command, detection: ShellPolling.detect(command) }).toEqual({ command, detection: undefined })
  })

  test("names poll commands that would repeat a change, and leaves read-only ones alone", () => {
    for (const command of [
      "gh pr create --fill",
      "gh workflow run deploy.yml",
      "git push origin main",
      "kubectl apply -f deploy.yaml",
      "curl -X POST https://api.example.com/deploy",
      "curl -sf https://api.example.com --data '{}'",
      "docker compose up -d",
      "rm -rf dist",
    ])
      expect({ command, change: ShellPolling.mutating(command) }).toMatchObject({ command, change: expect.any(String) })
    for (const command of [
      "gh pr checks 12",
      "gh run view 42 --json status,conclusion",
      "curl -sf http://localhost:3000/health",
      "kubectl rollout status deploy/api",
      "docker compose ps",
      "git status --short",
      "test -f ready && printf ready",
    ])
      expect({ command, change: ShellPolling.mutating(command) }).toEqual({ command, change: undefined })
    const refusal = ShellPolling.mutatingRefusal(ShellPolling.mutating("gh pr create --fill")!)
    expect(refusal).toContain("Not started")
    for (const line of refusal.split("\n").filter((line) => line.startsWith("{")))
      expect(() => decode(JSON.parse(line))).not.toThrow()
  })
})
