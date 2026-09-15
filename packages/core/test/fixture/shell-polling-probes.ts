/**
 * The sleep-polling probe cases, shared by the core detector test and the legacy shell tool test.
 * `decode` checks a suggested retry against the bash parameters of the runtime under test.
 */
import { describe, expect, test } from "bun:test"
import { ShellPolling } from "@reddb-io/redcode-core/tool/shell-polling"
import type { Monitor } from "@reddb-io/redcode-schema/monitor"

export function shellPollingProbes(decode: (call: unknown) => unknown, decodeProbe?: (call: unknown) => unknown) {
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

    test("turns a readiness loop into a brisk, short monitor whose success is the exit code", () => {
      const { call, refusal } = retry("until curl -sf http://localhost:3000/health; do sleep 2; done", "/repo/app")
      expect(call).toEqual({
        command: "curl -sf http://localhost:3000/health",
        workdir: "/repo/app",
        monitor: { mode: "poll", interval_ms: 2_000, deadline_ms: 120_000 },
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
        expect({ command, change: ShellPolling.mutating(command) }).toMatchObject({
          command,
          change: expect.any(String),
        })
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

    test("lets batch loops that act on each item run, whatever they call", () => {
      for (const command of [
        "for c in $(docker ps -q); do docker stop $c; sleep 1; done",
        "for r in api web worker; do gh api repos/acme/$r/pulls --jq length; sleep 2; done",
        'for f in *.json; do curl -sf "https://example.com/check/${f}"; sleep 1; done',
        "while read repo; do gh api repos/$repo; sleep 1; done < repos.txt",
        "while IFS= read -r url; do curl -s $url; sleep 5; done < urls.txt",
      ])
        expect({ command, detection: ShellPolling.detect(command) }).toEqual({ command, detection: undefined })
      // The same check against a fixed target is still a wait, even over a list.
      expect(ShellPolling.detect("for i in a b c d e f; do gh run view 42 --json status; sleep 10; done")?.kind).toBe(
        "loop",
      )
    })

    test("names what came after the wait, so it runs once the monitor reports", () => {
      const { detection, call, refusal } = retry(
        "docker compose up -d && until docker compose exec db pg_isready; do sleep 1; done && pnpm migrate && pnpm test",
      )
      expect(detection.before).toBe("docker compose up -d")
      expect(detection.after).toBe("pnpm migrate && pnpm test")
      expect(call).toEqual({
        command: "docker compose exec db pg_isready",
        monitor: { mode: "poll", interval_ms: 1_000, deadline_ms: 120_000 },
      })
      expect(refusal).toContain(
        "When the monitor reports success, run what came after the wait as its own bash call: pnpm migrate && pnpm test",
      )
      expect(retry("sleep 300 && gh pr checks 3 && gh pr merge 3 --squash").detection.after).toBe(
        "gh pr merge 3 --squash",
      )
      expect(retry("gh run watch 42 && ./deploy.sh").detection.after).toBe("./deploy.sh")
    })

    test("a sleep in front of real work suggests running that work as a one-shot monitor", () => {
      const { detection, call, refusal } = retry("sleep 45 && npm test")
      expect(detection.kind).toBe("sleep")
      expect(call).toEqual({ command: "npm test", monitor: { mode: "once" } })
      expect(refusal).toContain("one-shot bash monitor")
      expect(refusal).not.toContain("gh pr checks 123")
      // Inside a loop there is no single command to hand over.
      expect(ShellPolling.detect("for i in 1 2 3; do echo $i; sleep 60; done")?.suggestion).toBeUndefined()
    })

    test("a timeout in front bounds the wait: short enough it runs, otherwise it caps the deadline", () => {
      const capped = retry(`timeout 60 bash -c 'until curl -sf localhost:3000; do sleep 5; done'`)
      expect(capped.detection.waitMs).toBe(60_000)
      expect(capped.call.monitor.deadline_ms).toBe(60_000)
      const long = retry(`timeout 10m sh -c 'for i in $(seq 1 12); do sleep 300; gh run view 7 --json status; done'`)
      expect(long.call.monitor.deadline_ms).toBe(600_000)
      for (const command of [
        "timeout 20 bash -c 'until pg_isready; do sleep 1; done'",
        "timeout 25 sh -c 'while ! curl -sf localhost:3000; do sleep 2; done'",
        "timeout 20 gh run watch 42",
      ])
        expect({ command, detection: ShellPolling.detect(command) }).toEqual({ command, detection: undefined })
    })

    test("refuses open-ended wait loops around local checks, with a brisk exit-code monitor", () => {
      const ci = retry("until grep -q PASSED ci.log; do sleep 5; done && pnpm deploy", "/repo")
      expect(ci.detection).toMatchObject({ kind: "loop", after: "pnpm deploy" })
      expect(ci.detection.waitMs).toBeUndefined()
      expect(ci.call).toEqual({
        command: "grep -q PASSED ci.log",
        workdir: "/repo",
        monitor: { mode: "poll", interval_ms: 2_000, deadline_ms: 120_000 },
      })
      expect(ci.refusal).toContain("exit code 0 means done")
      expect(ci.refusal).toContain("run what came after the wait as its own bash call: pnpm deploy")
      for (const [command, check] of [
        ["until test -f /tmp/ready; do sleep 1; done", "test -f /tmp/ready"],
        ["until [ -e build/done ]; do sleep 2; done", "[ -e build/done ]"],
        ["while [ ! -e build/done ]; do sleep 2; done", "[ -e build/done ]"],
        ["while ! test -s out.json; do sleep 1; done", "test -s out.json"],
        ["until nc -z localhost 5432; do sleep 1; done", "nc -z localhost 5432"],
        ["until pg_isready -h localhost; do sleep 1; done", "pg_isready -h localhost"],
        ["until ls dist/index.js >/dev/null 2>&1; do sleep 1; done", "ls dist/index.js >/dev/null 2>&1"],
        ["while pgrep -f 'vite build'; do sleep 2; done", "! pgrep -f 'vite build'"],
        [
          `while docker inspect -f '{{.State.Health.Status}}' db | grep -qv healthy; do sleep 2; done`,
          `! docker inspect -f '{{.State.Health.Status}}' db | grep -qv healthy`,
        ],
        ["while true; do grep -q PASSED ci.log && break; sleep 1; done", "grep -q PASSED ci.log"],
        ["while :; do if [ -f /tmp/ready ]; then break; fi; sleep 1; done", "[ -f /tmp/ready ]"],
        ["for i in $(seq 1 $N); do test -f ready && break; sleep 1; done", "test -f ready"],
      ]) {
        const { detection, call } = retry(command!)
        expect({ command, kind: detection.kind, check: call.command, monitor: call.monitor }).toEqual({
          command,
          kind: "loop",
          check,
          monitor: { mode: "poll", interval_ms: call.monitor.interval_ms, deadline_ms: 120_000 },
        })
        expect(call.monitor.interval_ms).toBeLessThanOrEqual(2_000)
      }
      // A counted wait of 30 s or more is refused too, with the deadline it meant.
      const counted = retry("for i in $(seq 1 60); do test -f ready && break; sleep 1; done")
      expect(counted.detection.waitMs).toBe(60_000)
      expect(counted.call).toEqual({
        command: "test -f ready",
        monitor: { mode: "poll", interval_ms: 1_000, deadline_ms: 61_000 },
      })
      const counter = retry("n=0; until grep -q PASSED ci.log || [ $n -ge 60 ]; do sleep 1; n=$((n+1)); done")
      expect(counter.detection.waitMs).toBe(60_000)
      expect(counter.detection.before).toBe("n=0")
      expect(counter.call.command).toBe("grep -q PASSED ci.log")
    })

    test("refuses an endless sleep loop that checks nothing", () => {
      for (const command of ["while true; do date; sleep 1; done", "while :; do ./tick.sh; sleep 2; done"]) {
        const detection = ShellPolling.detect(command)
        expect({ command, kind: detection?.kind }).toEqual({ command, kind: "loop" })
        expect(detection?.suggestion).toBeUndefined()
      }
    })

    test("lets local retries bounded under 30 s and local batch loops run", () => {
      for (const command of [
        "timeout 20 bash -c 'until grep -q PASSED ci.log; do sleep 1; done'",
        "timeout 25 sh -c 'while [ ! -e build/done ]; do sleep 5; done'",
        "for i in 1 2 3 4 5; do test -f ready && break; sleep 5; done",
        "for i in $(seq 1 10); do grep -q PASSED ci.log && break; sleep 2; done",
        "n=0; until test -f ready || [ $n -ge 20 ]; do sleep 1; n=$((n+1)); done",
        "i=0; while [ $i -lt 10 ]; do ls out; i=$((i+1)); sleep 2; done",
        "tries=0; while true; do grep -q ok log && break; tries=$((tries+1)); [ $tries -ge 5 ] && break; sleep 5; done",
        'for f in logs/*.log; do grep -q ERROR "$f" && echo "$f"; sleep 1; done',
        "for f in $(ls dist); do test -s dist/$f; sleep 1; done",
        "for h in a b c d e f g h i j k l; do ssh $h uptime; sleep 5; done",
        "while read f; do test -f $f; sleep 1; done < files.txt",
      ])
        expect({ command, detection: ShellPolling.detect(command) }).toEqual({ command, detection: undefined })
    })

    test("catches poll commands that change something through gh api, publishing, curl --json and shell wrappers", () => {
      for (const command of [
        "gh api repos/acme/app/issues -f title=broken",
        "gh api -X POST repos/acme/app/dispatches",
        "gh api --method PATCH repos/acme/app",
        "gh api repos/acme/app/releases --input body.json",
        "npm publish",
        "pnpm publish --access public",
        "curl --json '{\"a\":1}' https://example.com/deploy",
        "bash -c 'git push origin main'",
        'sh -c "rm -rf dist"',
      ])
        expect({ command, change: ShellPolling.mutating(command) }).toMatchObject({
          command,
          change: expect.any(String),
        })
      for (const command of [
        "gh api repos/acme/app/actions/runs --jq .total_count",
        "gh api -X GET repos/acme/app",
        "npm view redcode version",
        "bash -c 'gh pr checks 12'",
      ])
        expect({ command, change: ShellPolling.mutating(command) }).toEqual({ command, change: undefined })
    })
  })

  describe("shell polling guard native probes", () => {
    test("offers an http probe for a curl readiness loop, keeping the bash poll as the fallback", () => {
      const { detection, call, refusal } = retry(
        "until curl -fsS http://localhost:3000/health; do sleep 2; done",
        "/repo/app",
      )
      expect(detection.probe).toEqual({
        probe: { type: "http", url: "http://localhost:3000/health" },
        interval_ms: 2_000,
        deadline_ms: 120_000,
      })
      const probeLine = ShellPolling.probeCall(detection.probe!, "/repo/app")
      const lines = refusal.split("\n")
      expect(lines).toContain(probeLine)
      // The probe comes first: it is the retry a model should send.
      expect(lines.indexOf(probeLine)).toBeLessThan(
        lines.indexOf(ShellPolling.call(detection.suggestion!, "/repo/app")),
      )
      expect(refusal).toContain("Retry with this monitor tool call:")
      expect(call.command).toBe("curl -fsS http://localhost:3000/health")
      const probeCall = JSON.parse(probeLine)
      expect(probeCall).toEqual({
        action: "probe",
        probe: { type: "http", url: "http://localhost:3000/health" },
        interval_ms: 2_000,
        deadline_ms: 120_000,
      })
      if (decodeProbe) expect(() => decodeProbe(probeCall)).not.toThrow()
      // The v2 runtime has no monitors: its refusal never offers a probe.
      expect(ShellPolling.boundedRefusal(detection)).not.toContain('"action":"probe"')
    })

    test("maps the checks that clearly correspond to a probe, and nothing else", () => {
      const cases: [string, Monitor.Probe][] = [
        ["curl -fs http://localhost:3000/health", { type: "http", url: "http://localhost:3000/health" }],
        ["curl --fail --silent https://api.example.com/ready", { type: "http", url: "https://api.example.com/ready" }],
        ["test -f dist/app.js", { type: "file", path: "dist/app.js", state: "exists" }],
        ["[ -e build/done ]", { type: "file", path: "build/done", state: "exists" }],
        ["[[ -f 'out dir/report.json' ]]", { type: "file", path: "out dir/report.json", state: "exists" }],
        ["! test -e /tmp/lock", { type: "file", path: "/tmp/lock", state: "missing" }],
        ["[ ! -e /tmp/lock ]", { type: "file", path: "/tmp/lock", state: "missing" }],
        ["test -s out.json", { type: "file", path: "out.json", state: "exists", min_size: 1 }],
        [
          "pgrep -f 'vite build' >/dev/null 2>&1",
          { type: "process", name: "vite build", match: "cmdline", state: "running" },
        ],
        ["! pgrep -f 'vite build'", { type: "process", name: "vite build", match: "cmdline", state: "exited" }],
        ["pgrep -x postgres", { type: "process", name: "postgres", state: "running" }],
      ]
      for (const [check, probe] of cases) {
        expect({ check, probe: ShellPolling.nativeProbe(check) }).toEqual({ check, probe })
        if (decodeProbe) expect(() => decodeProbe({ action: "probe", probe })).not.toThrow()
      }
      for (const check of [
        "curl -s http://localhost:3000/health",
        "curl -fs -H 'Authorization: x' http://localhost:3000/health",
        "curl -fsk https://localhost/health",
        "! curl -fs http://localhost/health",
        "curl -fs http://localhost/health | grep ok",
        'test -f "$OUT"',
        "test -f dist/*.js",
        "[ -s out.json ] && echo ok",
        "pgrep -u root vite",
        "pgrep vite node",
        // pgrep patterns are regular expressions: bare pgrep matches name substrings, and metacharacters are not literal.
        "pgrep vite",
        "pgrep -f 'vite.*build'",
        "pgrep -f '^node'",
        "pgrep -fx vite",
        "gh pr checks 12",
      ])
        expect({ check, probe: ShellPolling.nativeProbe(check) }).toEqual({ check, probe: undefined })
    })

    test("keeps a relative file path relative to the bash workdir", () => {
      expect(
        JSON.parse(
          ShellPolling.probeCall(
            { probe: { type: "file", path: "dist/app.js", state: "exists" }, interval_ms: 1_000 },
            "/repo",
          ),
        ).probe.path,
      ).toBe("/repo/dist/app.js")
    })

    test("keeps what the loop waits for across until and while, with and without !", () => {
      const file = { type: "file", path: "build/done" } as const
      const proc = { type: "process", name: "vite build", match: "cmdline" } as const
      const http = { type: "http", url: "http://localhost:3000/health" } as const
      const cases: [string, Monitor.Probe | undefined][] = [
        ["until test -e build/done; do sleep 1; done", { ...file, state: "exists" }],
        ["until ! test -e build/done; do sleep 1; done", { ...file, state: "missing" }],
        ["while test -e build/done; do sleep 1; done", { ...file, state: "missing" }],
        ["while ! test -e build/done; do sleep 1; done", { ...file, state: "exists" }],
        ["until [ ! -e build/done ]; do sleep 1; done", { ...file, state: "missing" }],
        ["while [ ! -e build/done ]; do sleep 1; done", { ...file, state: "exists" }],
        ["until pgrep -f 'vite build'; do sleep 2; done", { ...proc, state: "running" }],
        ["until ! pgrep -f 'vite build'; do sleep 2; done", { ...proc, state: "exited" }],
        ["while pgrep -f 'vite build'; do sleep 2; done", { ...proc, state: "exited" }],
        ["while ! pgrep -f 'vite build'; do sleep 2; done", { ...proc, state: "running" }],
        ["until curl -fs http://localhost:3000/health; do sleep 2; done", http],
        ["while ! curl -fs http://localhost:3000/health; do sleep 2; done", http],
        // An http probe has no "down" state: waiting for an endpoint to stop answering stays a command poll.
        ["until ! curl -fs http://localhost:3000/health; do sleep 2; done", undefined],
        ["while curl -fs http://localhost:3000/health; do sleep 2; done", undefined],
        // A pgrep pattern is a regular expression; only a plain literal with -f or -x maps onto a probe.
        ["while pgrep -f 'vite.*build'; do sleep 2; done", undefined],
        ["until pgrep postgres; do sleep 1; done", undefined],
        ["while test -s out.json; do sleep 1; done", undefined],
        ["until test -f a || test -f b; do sleep 1; done", undefined],
        ["for i in $(seq 1 60); do test -f ready && break; sleep 1; done", undefined],
        ["timeout 600 bash -c 'until test -e build/done; do sleep 5; done'", { ...file, state: "exists" }],
      ]
      for (const [command, probe] of cases) {
        expect({ command, probe: ShellPolling.loopProbe(command) }).toEqual({ command, probe })
        if (probe && decodeProbe) expect(() => decodeProbe({ action: "probe", probe })).not.toThrow()
        // Whichever of these loops the guard refuses, the probe it offers is exactly this one, never an inverted one.
        const detection = ShellPolling.detect(command)
        const offered = detection?.suggestion && detection.kind === "loop" ? probe : undefined
        expect({ command, offered: detection?.probe?.probe }).toEqual({ command, offered })
      }
    })
  })
}
