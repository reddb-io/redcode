import type { Page } from "@playwright/test"
import type { Worker } from "@opencode/schema/worker"

export async function mockRemoteWorkers(page: Page) {
  const snapshot: { available: boolean; workers: Worker.Status[]; batches: Worker.Batch[] } = {
    available: true,
    workers: [],
    batches: [],
  }
  const requests: { path: string; method: string; body: unknown }[] = []
  const patch =
    "diff --git a/result.txt b/result.txt\nnew file mode 100644\n--- /dev/null\n+++ b/result.txt\n@@ -0,0 +1 @@\n+Worker result\n"
  await page.route("**/api/workers**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const body: unknown = request.method() === "POST" ? request.postDataJSON() : undefined
    requests.push({ path, method: request.method(), body })
    if (path === "/api/workers" && request.method() === "GET") return route.fulfill({ json: snapshot })
    if (path === "/api/workers" && request.method() === "POST") {
      const registration = body as Worker.Register
      const status: Worker.Status = {
        worker: {
          id: registration.id,
          url: registration.url,
          directories: registration.directories,
          tags: registration.tags,
          passwordEnv: "cred_fixture",
        },
        connection: "online",
        platform: "linux arm64",
      }
      snapshot.workers.push(status)
      return route.fulfill({ json: status })
    }
    if (path === "/api/workers/batches") {
      const manifest = body as Worker.Manifest
      const batch: Worker.Batch = {
        id: "batch-fixture",
        createdAt: "2026-10-10T15:00:00Z",
        manifest,
        observing: false,
        report: {
          fingerprint: "fixture",
          tasks: manifest.tasks.map((task) => ({
            id: task.id,
            state: "succeeded",
            worker: "pi-a",
            sessionID: "ses_fixture",
            messageID: "msg_fixture",
            text: "Worker completed the task",
          })),
        },
      }
      snapshot.batches.push(batch)
      return route.fulfill({ json: batch })
    }
    if (path.endsWith("/collect")) {
      const task = (body as { task: string }).task
      const artifact: Worker.Artifact = {
        task: snapshot.batches[0].report!.tasks.find((entry) => entry.id === task)!,
        files: [{ file: "result.txt", patch, status: "added", additions: 1, deletions: 0 }],
        patch,
        patchSha256: "fixture-hash",
        collectedAt: "2026-10-10T15:01:00Z",
      }
      return route.fulfill({ json: artifact })
    }
    return route.fulfill({ status: 404, json: { message: "Unknown worker fixture request" } })
  })
  return { requests, patch }
}
