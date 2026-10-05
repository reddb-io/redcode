import { describe, expect, test } from "bun:test"
import { ShellPolling } from "@opencode/core/tool/shell-polling"

// What the maintainer's session sent: a wait on CI that no native probe can watch.
const WAIT = `sleep 30; gh pr checks 5013 2>&1 | head -20; gh pr view 5013 --json headRefOid,statusCheckRollup -q '.headRefOid'`

describe("ShellPolling.boundedRefusal", () => {
  test("hands over the same command in the background, not a retry loop", () => {
    const detection = ShellPolling.detect(WAIT)
    expect(detection).toBeDefined()
    expect(detection?.probe).toBeUndefined()
    const text = ShellPolling.boundedRefusal(detection!, WAIT, "/work/repo")
    expect(text).toContain("Not run:")
    expect(text).toContain(JSON.stringify({ command: WAIT, background: true, workdir: "/work/repo" }))
    expect(text).toContain("Do not write your own retry loop")
    // The refusal used to teach `for i in 1 2 3 4 5; do …; sleep 5; done`, which a model then copied.
    expect(text).not.toContain("for i in 1 2 3 4 5; do")
    expect(text).not.toContain("single bounded wait")
  })

  test("a sleep in front of the real work still says to run that work now", () => {
    const command = "sleep 45 && npm test"
    const detection = ShellPolling.detect(command)
    expect(detection).toBeDefined()
    const text = ShellPolling.boundedRefusal(detection!, command)
    expect(text).toContain(JSON.stringify({ command: "npm test" }))
    expect(text).not.toContain("background")
  })

  test("short waits stay allowed", () => {
    expect(ShellPolling.detect("sleep 20; gh pr checks 5013 2>&1 | head -20")).toBeUndefined()
  })
})
