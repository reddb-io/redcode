import { expect, test } from "bun:test"
import type { Session, Snapshot } from "../src/redskilled-client"
import { statusSessions } from "../src/redskilled-status"

const snapshot: Snapshot = {
  state: { project_id: "p", project_label: "project", workspace_path: "/work", workers: [] },
  control: {
    version: 1,
    project_id: "p",
    project_label: "project",
    workspace_path: "/work",
    drain_intent: "inactive",
    revision: 1,
    updates: [],
  },
}

function factory(read: () => Promise<Snapshot> = async () => snapshot) {
  const sessions: { directory: string; closed: boolean }[] = []
  return {
    sessions,
    create: async (directory: string): Promise<Session> => {
      const record = { directory, closed: false }
      sessions.push(record)
      return {
        snapshot: read,
        control: () => Promise.reject(new Error("unused")),
        workflow: () => Promise.reject(new Error("unused")),
        close: () => {
          record.closed = true
        },
      }
    },
  }
}

test("shares one session between sequential and concurrent reads of a directory", async () => {
  const fake = factory()
  const status = statusSessions({ create: fake.create })
  await status.snapshot("/a")
  await Promise.all([status.snapshot("/a"), status.snapshot("/a"), status.snapshot("/a")])
  await status.snapshot("/b")
  expect(fake.sessions.map((session) => session.directory)).toEqual(["/a", "/b"])
  expect(fake.sessions.some((session) => session.closed)).toBe(false)
  status.reset("/a")
  status.reset("/b")
})

test("closes a session once reads stop for the idle time", async () => {
  const fake = factory()
  const status = statusSessions({ create: fake.create, idleMs: 20 })
  await status.snapshot("/a")
  await Bun.sleep(10)
  await status.snapshot("/a")
  await Bun.sleep(10)
  expect(fake.sessions).toEqual([{ directory: "/a", closed: false }])
  await Bun.sleep(40)
  expect(fake.sessions).toEqual([{ directory: "/a", closed: true }])
  await status.snapshot("/a")
  expect(fake.sessions).toEqual([
    { directory: "/a", closed: true },
    { directory: "/a", closed: false },
  ])
  status.reset("/a")
})

test("repeats a failed read without starting another session until the cooldown ends", async () => {
  const failing = { value: true }
  const fake = factory(async () => {
    if (failing.value) throw new Error("adapter is broken")
    return snapshot
  })
  const status = statusSessions({ create: fake.create, cooldownMs: 30 })
  await expect(status.snapshot("/a")).rejects.toThrow("adapter is broken")
  await expect(status.snapshot("/a")).rejects.toThrow("adapter is broken")
  expect(fake.sessions).toEqual([{ directory: "/a", closed: true }])
  failing.value = false
  await Bun.sleep(40)
  expect(await status.snapshot("/a")).toEqual(snapshot)
  expect(fake.sessions).toEqual([
    { directory: "/a", closed: true },
    { directory: "/a", closed: false },
  ])
  status.reset("/a")
})

test("cools down a session that fails to start", async () => {
  const starts: string[] = []
  const status = statusSessions({
    create: async (directory) => {
      starts.push(directory)
      throw new Error("Unable to start red-skills-redskilled acp: not found")
    },
  })
  await expect(status.snapshot("/a")).rejects.toThrow("not found")
  await expect(status.snapshot("/a")).rejects.toThrow("not found")
  expect(starts).toEqual(["/a"])
})

test("reset closes the shared session and clears the cooldown", async () => {
  const fake = factory()
  const status = statusSessions({ create: fake.create })
  await status.snapshot("/a")
  status.reset("/a")
  await Bun.sleep(0)
  expect(fake.sessions).toEqual([{ directory: "/a", closed: true }])
  await status.snapshot("/a")
  expect(fake.sessions).toHaveLength(2)
  status.reset("/a")

  const starts: string[] = []
  const broken = statusSessions({
    create: (directory) => {
      starts.push(directory)
      return Promise.reject(new Error("missing"))
    },
  })
  await expect(broken.snapshot("/b")).rejects.toThrow("missing")
  await expect(broken.snapshot("/b")).rejects.toThrow("missing")
  broken.reset("/b")
  await expect(broken.snapshot("/b")).rejects.toThrow("missing")
  expect(starts).toEqual(["/b", "/b"])
})
