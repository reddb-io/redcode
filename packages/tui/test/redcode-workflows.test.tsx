import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

test("Redcode setup, intelligence and Design commands reach their production UI without submitting a prompt", async () => {
  await using state = await tmpdir()
  const writes: string[] = []
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  await using setup = await createAppFixture({
    state: state.path,
    fetch: (url, request) => {
      if (request.method !== "GET") writes.push(url.pathname)
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: ["build", "plan", "design", "question"].map((id) => ({
            id,
            mode: "primary",
            hidden: false,
            permissions: [],
          })),
        })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            {
              id: "model",
              providerID: "provider",
              name: "Model",
              enabled: true,
              capabilities: { output: ["text"] },
              variants: [],
              time: { released: 0 },
              cost: [],
            },
          ],
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/experimental/design/conversations") return json([])
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Build") && frame.includes("Model"))
  await setup.mockInput.typeText("/setup")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Reasoning mode"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("System Two model"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("System Two model"))
  expect(writes).toEqual(["/api/session"])

  await setup.mockInput.typeText("/intelligence")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Global S2:"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Global S2:"))
  await setup.mockInput.typeText("/design-open")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Resume Design conversation"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Resume Design conversation"))
  await setup.mockInput.typeText("/design")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Design") && frame.includes("Model"))
  expect(writes).toEqual(["/api/session"])
})
