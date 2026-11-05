import { test, expect } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { SessionArtifacts } from "../src/session/artifacts"

test("session artifacts preserve revisions and reject stale updates and paths outside the workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-artifacts-"))
  try {
    const workspace = path.join(root, "workspace")
    const source = path.join(workspace, "report")
    await mkdir(source, { recursive: true })
    await Bun.write(path.join(source, "index.html"), "first revision")
    const store = SessionArtifacts.createStore(path.join(root, "data"))
    const sessionID = "ses_artifacts_test"
    const first = await store.publish({
      sessionID,
      directory: workspace,
      source: "report",
      title: "Report",
      entry: "index.html",
    })
    await Bun.write(path.join(source, "index.html"), "second revision")
    const second = await store.publish({
      sessionID,
      directory: workspace,
      source: "report",
      id: first.id,
      expectedRevision: first.revisions[0].id,
      entry: "index.html",
    })
    expect(second.revisions).toHaveLength(2)
    expect(
      new TextDecoder().decode(await store.content(sessionID, first.id, first.revisions[0].id, "index.html")),
    ).toBe("first revision")
    expect(
      new TextDecoder().decode(await store.content(sessionID, first.id, second.revisions[1].id, "index.html")),
    ).toBe("second revision")
    await expect(
      store.publish({
        sessionID,
        directory: workspace,
        source: "report",
        id: first.id,
        expectedRevision: first.revisions[0].id,
        entry: "index.html",
      }),
    ).rejects.toMatchObject({ code: "conflict" })
    await expect(store.read("ses_other", first.id)).rejects.toMatchObject({ code: "not-found" })
    await expect(
      store.publish({ sessionID, directory: workspace, source: "../", title: "Outside", entry: "index.html" }),
    ).rejects.toThrow()
    expect(await SessionArtifacts.createStore(path.join(root, "data")).list(sessionID)).toHaveLength(1)
    const concurrent = await Promise.allSettled(
      [1, 2].map(() =>
        store.publish({
          sessionID,
          directory: workspace,
          source: "report",
          id: first.id,
          expectedRevision: second.revisions[1].id,
          entry: "index.html",
        }),
      ),
    )
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
