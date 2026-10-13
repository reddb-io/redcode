import type { Page } from "@playwright/test"
import { Worker } from "@opencode/schema/worker"
import { Schema } from "effect"
import { currentSession, type MockSession } from "./mock-server"

export async function mockWaitingWorker(page: Page, session: MockSession) {
  const inbox = Schema.decodeUnknownSync(Worker.Inbox)({
    data: [
      {
        task: { id: "task-review", state: "waiting", worker: "pi-a", sessionID: session.id },
        attention: {
          session: Object.fromEntries(
            Object.entries(currentSession(session)).filter((entry) => entry[1] !== undefined),
          ),
          permissions: [{ id: "per_worker_edit", sessionID: session.id, action: "edit", resources: ["worker.txt"] }],
          forms: [
            {
              id: "frm_worker_choice",
              sessionID: session.id,
              title: "Worker question",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "q0",
                  type: "string",
                  title: "Implementation",
                  description: "Which implementation should the worker use?",
                  options: [
                    { value: "minimal", label: "Minimal" },
                    { value: "extended", label: "Extended" },
                  ],
                  custom: true,
                },
              ],
            },
          ],
        },
      },
    ],
    unavailable: [],
  })
  const batch: Worker.Batch = {
    id: "batch-waiting",
    createdAt: "2026-10-13T00:00:00Z",
    observing: true,
    manifest: { tasks: [{ id: "task-review", prompt: "Review the checkout" }] },
    report: { fingerprint: "fixture", tasks: inbox.data.map((pending) => pending.task) },
  }
  return mockRemoteWorkers(page, { batches: [batch], inbox })
}

export async function mockRemoteWorkers(
  page: Page,
  initial?: { workers?: Worker.Status[]; batches?: Worker.Batch[]; inbox?: Worker.Inbox },
) {
  const snapshot: { available: boolean; workers: Worker.Status[]; batches: Worker.Batch[] } = {
    available: true,
    workers: initial?.workers ?? [],
    batches: initial?.batches ?? [],
  }
  const requests: { path: string; method: string; body: unknown }[] = []
  const inbox = { data: [...(initial?.inbox?.data ?? [])], unavailable: [...(initial?.inbox?.unavailable ?? [])] }
  const patch =
    "diff --git a/result.txt b/result.txt\nnew file mode 100644\n--- /dev/null\n+++ b/result.txt\n@@ -0,0 +1 @@\n+Worker result\n"
  await page.route("**/api/workers**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const body: unknown = request.method() === "POST" ? request.postDataJSON() : undefined
    requests.push({ path, method: request.method(), body })
    if (path.endsWith("/attention")) return route.fulfill({ json: inbox })
    if (path.endsWith("/answer")) {
      const answer = body as Worker.Answer
      const index = inbox.data.findIndex((item) => item.task.id === answer.task)
      const pending = inbox.data[index]
      if (!pending) return route.fulfill({ status: 400, json: { message: "Unknown assignment" } })
      if (answer.kind === "permission")
        inbox.data[index] = {
          ...pending,
          attention: {
            ...pending.attention,
            permissions: pending.attention.permissions.filter((permission) => permission.id !== answer.requestID),
          },
        }
      if (answer.kind !== "permission")
        inbox.data[index] = {
          ...pending,
          attention: {
            ...pending.attention,
            forms: pending.attention.forms.filter((form) => form.id !== answer.formID),
          },
        }
      return route.fulfill({ status: 204 })
    }
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
