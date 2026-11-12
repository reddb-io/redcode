import type { Page } from "@playwright/test"
import { CreatorComponent } from "@opencode/schema/creator-component"
import { Design } from "@opencode/schema/design"
import { Session } from "@opencode/schema/session"
import { Schema } from "effect"
import { CreatorFrame } from "../../../core/src/creator/frame"
import { SERVER } from "./app"
import type { mockOpenCodeServer } from "./mock-server"

export function creatorComponent(sessionID: string, revision = "rev_creator_one") {
  return CreatorComponent.Info.make({
    id: CreatorComponent.ID.make("creator_counter"),
    name: "Project counter",
    description: "A locally installed interactive component",
    sessionID: Session.ID.make(sessionID),
    designID: Design.ID.make("design_creator_counter"),
    revision,
    enabled: true,
    version: 1,
    created: 1,
    updated: 1,
  })
}

export async function mockCreatorComponents(
  page: Page,
  input: {
    directory: string
    push: Awaited<ReturnType<typeof mockOpenCodeServer>>["push"]
    initial?: CreatorComponent.Info[]
    sessionID?: string
    server?: string
  },
) {
  let components = input.initial ?? []
  let published = "rev_creator_one"
  let rejection: string | undefined
  const sessionID = input.sessionID ?? input.initial?.[0]?.sessionID ?? "ses_creator_source"
  const source: Design.Info = {
    id: Design.ID.make("design_creator_counter"),
    sessionID: Session.ID.make(sessionID),
    name: "Counter artifact",
    journey: "new",
    engine: "html",
    kind: "screen",
    target: "web",
    root: "/project/work",
    application: input.directory,
    entry: "index.html",
    brief: {
      objective: "Interactive counter",
      audience: "Developers",
      content: "Counter",
      constraints: "No network",
      references: [],
    },
    decisions: [],
    questions: [],
    scenarios: [],
    designSystem: "none",
    sources: [],
    tweaks: {},
    revision: published,
    approvedRevision: null,
    ended: false,
    updated: 1,
  }
  await page.route(`${input.server ?? SERVER}/api/experimental/session/${sessionID}/design`, (route) =>
    route.fulfill({ json: { data: [{ ...source, revision: published }] } }),
  )
  const operations: { method: string; path: string; directory: string | null; body?: Schema.Json }[] = []
  const html = (revision: string) =>
    CreatorFrame.html(
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Installed counter</title><h1>${revision === "rev_creator_two" ? "Updated counter" : "Counter component"}</h1><button id="increment">Increment</button><button id="fail">Trigger failure</button><button id="reject">Reject promise</button><output role="status">0</output><script>let count=0;document.getElementById('increment').onclick=()=>document.querySelector('output').textContent=String(++count);document.getElementById('fail').onclick=()=>{throw new Error('Creator fixture exception')};document.getElementById('reject').onclick=()=>{void Promise.reject(new Error('Creator fixture rejection'))}</script>`,
    )
  await page.route(`${input.server ?? SERVER}/api/creator/component**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const directory = url.searchParams.get("location[directory]")
    const body = request.postData() ? Schema.decodeUnknownSync(Schema.Json)(request.postDataJSON()) : undefined
    operations.push({ method: request.method(), path: url.pathname, directory, body })
    if (directory !== input.directory)
      return route.fulfill({
        status: 400,
        json: { _tag: "InvalidRequestError", message: "Wrong Creator project scope" },
      })
    const location = { directory }
    if (url.pathname === "/api/creator/component") {
      if (request.method() === "GET") return route.fulfill({ json: { location, data: components } })
      const install = Schema.decodeUnknownSync(CreatorComponent.Install)(body)
      const component = CreatorComponent.Info.make({
        ...creatorComponent(install.sessionID, install.revision),
        ...install,
      })
      components = [...components, component]
      await route.fulfill({ json: { location, data: component } })
      await input.push([
        {
          id: "evt_creator_install",
          created: Date.now(),
          type: "creator.component.updated",
          location,
          data: { componentID: component.id },
        },
      ])
      return
    }
    const id = url.pathname.split("/")[4]
    const component = components.find((item) => item.id === id)
    if (!component)
      return route.fulfill({
        status: 404,
        json: { _tag: "CreatorComponentNotFoundError", message: "Creator component not found" },
      })
    if (request.method() === "GET" && url.pathname.endsWith("/preview"))
      return route.fulfill({
        json: {
          location,
          data: { html: html(component.revision), revision: component.revision, version: component.version },
        },
      })
    const expected = url.pathname.endsWith("/control")
      ? Schema.decodeUnknownSync(CreatorComponent.Control)(body)
      : request.method() === "DELETE"
        ? Schema.decodeUnknownSync(CreatorComponent.Remove)(body)
        : Schema.decodeUnknownSync(CreatorComponent.Update)(body)
    if (expected.expectedVersion !== component.version)
      return route.fulfill({
        status: 409,
        json: { _tag: "ConflictError", message: "The installed component changed. Reload before updating." },
      })
    if (rejection && "revision" in expected) {
      const message = rejection
      rejection = undefined
      return route.fulfill({ status: 409, json: { _tag: "ConflictError", message } })
    }
    const next = {
      ...component,
      ...("enabled" in expected
        ? { enabled: expected.enabled }
        : "revision" in expected
          ? {
              revision: expected.revision,
              name: expected.name ?? component.name,
              description: expected.description ?? component.description,
            }
          : {}),
      version: component.version + 1,
      updated: component.updated + 1,
    }
    components =
      request.method() === "DELETE"
        ? components.filter((item) => item.id !== id)
        : components.map((item) => (item.id === id ? next : item))
    await route.fulfill(request.method() === "DELETE" ? { status: 204 } : { json: { location, data: next } })
    await input.push([
      {
        id: `evt_creator_${next.version}`,
        created: Date.now(),
        type: "creator.component.updated",
        location,
        data: { componentID: component.id },
      },
    ])
  })
  return {
    operations,
    list: () => components,
    publishRevision: (revision: string) => {
      published = revision
    },
    rejectNextUpdate: (message: string) => {
      rejection = message
    },
  }
}
