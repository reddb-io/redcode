import type { Page } from "@playwright/test"
import type { HostResourcesSnapshot } from "@opencode/client/promise"
import { Worker } from "@opencode/schema/worker"
import { Schema } from "effect"
import { currentSession, type MockSession } from "./mock-server"
import { workerEnrollmentPage } from "../../../server/src/worker-enrollment-page"

export async function mockWorkerEnrollmentPage(page: Page) {
  await page.route("**/auth/worker", (route) => route.fulfill({ contentType: "text/html", body: workerEnrollmentPage }))
}

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

export async function mockWorkerTaskInspection(page: Page) {
  const batch = Schema.decodeUnknownSync(Worker.Batch)({
    id: "batch-inspection",
    createdAt: "2026-10-20T10:00:00Z",
    observing: true,
    manifest: {
      tasks: [
        {
          id: "task-review",
          prompt: "Review ARM checkout",
          worker: "pi-requested",
          tags: ["arm64"],
          resources: { cpu: 2, memoryBytes: 1024 ** 3 },
          model: { providerID: "configured-provider", id: "requested-model" },
        },
        { id: "task-unreported", prompt: "Build docs" },
      ],
    },
    report: {
      fingerprint: "fixture",
      tasks: [
        {
          id: "task-review",
          state: "waiting",
          worker: "pi-a",
          directory: "/srv/review",
          sessionID: "ses_assigned",
          messageID: "msg_assigned",
        },
      ],
    },
  })
  const otherBatch: Worker.Batch = {
    ...batch,
    id: "batch-other",
    manifest: { tasks: [{ ...batch.manifest.tasks[0], prompt: "Review another checkout" }] },
    report: {
      fingerprint: "fixture",
      tasks: [{ ...batch.report!.tasks[0], worker: "pi-b", directory: "/srv/other", sessionID: "ses_other" }],
    },
  }
  return { batch, otherBatch, ...(await mockRemoteWorkers(page, { batches: [batch, otherBatch] })) }
}

export async function mockWorkerDistribution(page: Page) {
  const batch = Schema.decodeUnknownSync(Worker.Batch)({
    id: "batch-distribution",
    createdAt: "2026-10-21T10:00:00Z",
    observing: true,
    manifest: {
      tasks: [
        { id: "build-api", prompt: "Implement the API", worker: "pi-requested" },
        { id: "test-api", prompt: "Test the API" },
        { id: "build-web", prompt: "Implement the page" },
        { id: "test-web", prompt: "Test the page" },
        { id: "write-docs", prompt: "Document the API", worker: "pi-b" },
        { id: "review-docs", prompt: "Review the documentation", worker: "pi-requested" },
      ],
    },
    report: {
      fingerprint: "fixture",
      tasks: [
        { id: "build-api", state: "running", worker: "pi-a", directory: "/srv/api", sessionID: "ses_api" },
        { id: "test-api", state: "waiting", worker: "pi-b", directory: "/srv/tests", sessionID: "ses_tests" },
        { id: "build-web", state: "succeeded", worker: "pi-a" },
        { id: "test-web", state: "failed", worker: "pi-b" },
        { id: "write-docs", state: "queued", queueReason: "cpu-capacity" },
      ],
    },
  })
  const workers: Worker.Status[] = [
    {
      worker: { id: "pi-a", url: "http://pi-a:4096", directories: ["/srv/api"], tags: [], passwordEnv: "fixture_a" },
      connection: "online",
    },
    {
      worker: { id: "pi-b", url: "http://pi-b:4096", directories: ["/srv/tests"], tags: [], passwordEnv: "fixture_b" },
      connection: "offline",
    },
  ]
  return { batch, workers, ...(await mockRemoteWorkers(page, { batches: [batch], workers })) }
}

export async function mockRemoteWorkers(
  page: Page,
  initial?: {
    server?: string
    workers?: Worker.Status[]
    batches?: Worker.Batch[]
    inbox?: Worker.Inbox
    resources?: Record<string, HostResourcesSnapshot>
  },
) {
  const snapshot: { available: boolean; workers: Worker.Status[]; batches: Worker.Batch[] } = {
    available: true,
    workers: initial?.workers ?? [],
    batches: initial?.batches ?? [],
  }
  const requests: { path: string; method: string; body: unknown }[] = []
  const invitations = new Map<string, Worker.Invitation>()
  const inbox = { data: [...(initial?.inbox?.data ?? [])], unavailable: [...(initial?.inbox?.unavailable ?? [])] }
  const patch =
    "diff --git a/result.txt b/result.txt\nnew file mode 100644\n--- /dev/null\n+++ b/result.txt\n@@ -0,0 +1 @@\n+Worker result\n"
  await page.route(initial?.server ? `${initial.server}/api/workers**` : "**/api/workers**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const body: unknown = request.method() === "POST" ? request.postDataJSON() : undefined
    requests.push({ path, method: request.method(), body })
    if (path === "/api/workers/invitations" && request.method() === "POST") {
      const value = Schema.decodeUnknownSync(Worker.InvitationRequest)(body)
      const invitation = {
        ...value,
        code: String(invitations.size + 1).padStart(43, "a"),
        expiresAt: Date.now() + 600_000,
      }
      invitations.set(invitation.code, invitation)
      return route.fulfill({ json: invitation })
    }
    if (path.startsWith("/api/workers/invitations/") && request.method() === "DELETE") {
      invitations.delete(path.split("/").at(-1)!)
      return route.fulfill({ status: 200, body: "" })
    }
    if (path.endsWith("/resources")) {
      const sample = initial?.resources?.[path.split("/")[3]]
      return sample
        ? route.fulfill({ json: sample })
        : route.fulfill({ status: 503, json: { message: "Resources unavailable" } })
    }
    if (path.endsWith("/recover")) {
      const input = Schema.decodeUnknownSync(Schema.Struct({ task: Worker.Name }))(body)
      const batch = snapshot.batches.find((batch) => batch.id === path.split("/")[4])
      if (
        !batch?.report ||
        !batch.report.tasks.some((task) => task.id === input.task && ["unknown", "dispatching"].includes(task.state))
      )
        return route.fulfill({ status: 400, json: { message: "Unknown recovery assignment" } })
      const recovered: Worker.Batch = {
        ...batch,
        observing: false,
        report: {
          ...batch.report,
          tasks: batch.report.tasks.map((task) =>
            task.id === input.task
              ? {
                  ...task,
                  state: "running",
                  recoveryReason: undefined,
                  ...(task.lease
                    ? {
                        lease: {
                          ...task.lease,
                          holder: "recovered-coordinator",
                          generation: task.lease.generation + 1,
                        },
                      }
                    : {}),
                }
              : task,
          ),
        },
      }
      snapshot.batches[snapshot.batches.indexOf(batch)] = recovered
      return route.fulfill({ json: recovered })
    }
    if (path.endsWith("/control")) {
      const control = Schema.decodeUnknownSync(Worker.Control)(body)
      const batchID = path.split("/")[4]
      const batch = snapshot.batches.find((batch) => batch.id === batchID)
      if (!batch?.report || !batch.report.tasks.some((task) => task.id === control.task))
        return route.fulfill({ status: 400, json: { message: "Unknown assignment" } })
      if (control.kind === "interrupt" || control.kind === "cancel")
        snapshot.batches[snapshot.batches.indexOf(batch)] = {
          ...batch,
          report: {
            ...batch.report,
            tasks: batch.report.tasks.map((task) =>
              task.id === control.task ? { ...task, state: "interrupted", queueReason: undefined } : task,
            ),
          },
        }
      return route.fulfill({ status: 200, body: "" })
    }
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
  return {
    requests,
    patch,
    setWorkers: (workers: Worker.Status[]) => {
      snapshot.workers = workers
    },
    setAvailable: (available: boolean) => {
      snapshot.available = available
    },
    setBatches: (batches: Worker.Batch[]) => {
      snapshot.batches = batches
    },
    update: (batch: Worker.Batch) => {
      const index = snapshot.batches.findIndex((item) => item.id === batch.id)
      if (index < 0) throw new Error("Unknown fixture batch")
      snapshot.batches[index] = batch
    },
  }
}
