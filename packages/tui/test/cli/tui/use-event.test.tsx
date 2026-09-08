/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Event, GlobalEvent } from "@reddb-io/redcode-sdk/v2"
import { createSignal, onMount, Show } from "solid-js"
import { ProjectProvider, useProject } from "../../../src/context/project"
import { SDKProvider } from "../../../src/context/sdk"
import { useEvent } from "../../../src/context/event"
import { createEventSource, createFetch, directory } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"

const projectID = "proj_test"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function event(payload: Event, input: { directory: string; project?: string; workspace?: string }): GlobalEvent {
  return {
    directory: input.directory,
    project: input.project,
    workspace: input.workspace,
    payload,
  }
}

function vcs(branch: string): Event {
  return {
    id: `evt_vcs_${branch}`,
    type: "vcs.branch.updated",
    properties: {
      branch,
    },
  }
}

function update(version: string): Event {
  return {
    id: `evt_update_${version}`,
    type: "installation.update-available",
    properties: {
      version,
    },
  }
}

async function mount() {
  const events = createEventSource()
  const calls = createFetch()
  const seen: Event[] = []
  const workspaces: Array<string | undefined> = []
  let project!: ReturnType<typeof useProject>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Probe
            onReady={async (ctx) => {
              project = ctx.project
              await project.sync()
              done()
            }}
            seen={seen}
            workspaces={workspaces}
          />
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  await ready
  return { app, emit: events.emit, project, seen, workspaces }
}

function Probe(props: {
  seen: Event[]
  workspaces: Array<string | undefined>
  onReady: (ctx: { project: ReturnType<typeof useProject> }) => void
}) {
  const project = useProject()
  const event = useEvent()

  onMount(() => {
    event.subscribe((evt, { workspace }) => {
      props.seen.push(evt)
      props.workspaces.push(workspace)
    })
    props.onReady({ project })
  })

  return <box />
}

describe("useEvent", () => {
  test("unmounting consumers releases listeners, including explicit early unsubscribe", async () => {
    const events = createEventSource()
    const [shown, setShown] = createSignal(true)
    let callbacks = 0
    let mounts = 0
    function Child() {
      mounts++
      const event = useEvent()
      event.on("session.status", () => callbacks++)
      event.subscribe(() => (callbacks += 1000))()
      return <box />
    }
    const app = await testRender(() => (
      <SDKProvider url="http://test" events={events.source}>
        <Show when={shown()}>
          <Child />
        </Show>
      </SDKProvider>
    ))
    try {
      for (let index = 0; index < 100; index++) {
        setShown(false)
        setShown(true)
      }
      events.emit(
        event(
          { id: "evt_alive", type: "session.status", properties: { sessionID: "ses_test", status: { type: "idle" } } },
          { directory },
        ),
      )
      await wait(() => callbacks > 0)
      expect(mounts).toBe(101)
      expect(callbacks).toBe(1)
      setShown(false)
      events.emit(
        event(
          {
            id: "evt_disposed",
            type: "session.status",
            properties: { sessionID: "ses_test", status: { type: "idle" } },
          },
          { directory },
        ),
      )
      await Bun.sleep(30)
      expect(callbacks).toBe(1)
    } finally {
      app.renderer.destroy()
    }
  })

  test("a source subscription resolving after SDK disposal is released", async () => {
    let resolve!: (unsubscribe: () => void) => void
    let unsubscribed = 0
    const subscription = new Promise<() => void>((done) => {
      resolve = done
    })
    const app = await testRender(() => (
      <SDKProvider url="http://test" events={{ subscribe: () => subscription }}>
        <box />
      </SDKProvider>
    ))
    app.renderer.destroy()
    resolve(() => unsubscribed++)
    await wait(() => unsubscribed === 1)
  })
  test("delivers events for the current project", async () => {
    const { app, emit, seen, workspaces } = await mount()

    try {
      emit(event(vcs("main"), { directory: "/tmp/other", project: projectID, workspace: "ws_a" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([vcs("main")])
      expect(workspaces).toEqual(["ws_a"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers current project events regardless of active workspace", async () => {
    const { app, emit, project, seen } = await mount()

    try {
      project.workspace.set("ws_a")
      emit(event(vcs("ws"), { directory: "/tmp/other", project: projectID, workspace: "ws_b" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([vcs("ws")])
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers truly global events even when a workspace is active", async () => {
    const { app, emit, project, seen } = await mount()

    try {
      project.workspace.set("ws_a")
      emit(event(update("1.2.3"), { directory: "global" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([update("1.2.3")])
    } finally {
      app.renderer.destroy()
    }
  })
})
