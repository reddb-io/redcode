/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount, wait } from "./sync-fixture"
import type { GlobalEvent } from "@reddb-io/redcode-sdk/v2"

function branchEvent(branch: string, workspace?: string): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    workspace,
    payload: {
      id: `evt_vcs_${branch}`,
      type: "vcs.branch.updated",
      properties: { branch },
    },
  }
}

describe("tui sync", () => {
  test("refresh scopes sessions by default and lists project sessions when disabled", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, kv, sync, session } = await mount(undefined, tmp.path)

    try {
      expect(kv.get("session_directory_filter_enabled", true)).toBe(true)
      expect(session.at(-1)?.searchParams.get("roots")).toBeNull()
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
      expect(session.at(-1)?.searchParams.get("path")).toBe("packages/tui")

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
      expect(session.at(-1)?.searchParams.get("roots")).toBeNull()
    } finally {
      app.renderer.destroy()
    }
  })

  test("vcs branch updates only apply for the active workspace", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, project, sync } = await mount(undefined, tmp.path)

    try {
      expect(sync.data.vcs?.branch).toBe("main")

      project.workspace.set("ws_a")
      emit(branchEvent("other", "ws_b"))
      await Bun.sleep(30)

      expect(sync.data.vcs?.branch).toBe("main")

      emit(branchEvent("feature", "ws_a"))
      await wait(() => sync.data.vcs?.branch === "feature")

      expect(sync.data.vcs?.branch).toBe("feature")
    } finally {
      app.renderer.destroy()
    }
  })

  test("a router catalog refresh reloads providers and announces the change", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const catalog = { providers: [] as unknown[] }
    const { app, emit, sync, toast } = await mount((url) => {
      if (url.pathname === "/config/providers") return json({ providers: catalog.providers, default: {} })
    }, tmp.path)

    try {
      expect(sync.data.provider).toEqual([])
      catalog.providers = [{ id: "red-router", name: "RedRouter", env: [], options: {}, source: "config", models: {} }]
      emit({
        directory,
        project: "proj_test",
        payload: {
          id: "evt_catalog",
          type: "provider.catalog.updated",
          properties: { providerID: "red-router", name: "RedRouter", added: 3, removed: 1, renamed: 2 },
        },
      })
      await wait(() => sync.data.provider.length === 1)
      expect(toast.currentToast?.message).toBe("RedRouter catalog updated: +3/−1 models, 2 renamed")
    } finally {
      app.renderer.destroy()
    }
  })

  test("a router catalog refresh that only changed limits reloads providers without a toast", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const catalog = { providers: [] as unknown[] }
    const { app, emit, sync, toast } = await mount((url) => {
      if (url.pathname === "/config/providers") return json({ providers: catalog.providers, default: {} })
    }, tmp.path)

    try {
      catalog.providers = [{ id: "red-router", name: "RedRouter", env: [], options: {}, source: "config", models: {} }]
      emit({
        directory,
        project: "proj_test",
        payload: {
          id: "evt_catalog_limits",
          type: "provider.catalog.updated",
          properties: { providerID: "red-router", name: "RedRouter", added: 0, removed: 0, renamed: 0 },
        },
      })
      await wait(() => sync.data.provider.length === 1)
      expect(toast.currentToast).toBeNull()
    } finally {
      app.renderer.destroy()
    }
  })
})
