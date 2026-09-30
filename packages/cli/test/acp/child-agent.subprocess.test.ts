import type { NewSessionResponse, PromptResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { createAcpFixture, expectOk, initialize } from "./subprocess"

const childAgent = {
  version: 1,
  parentSessionId: "workflow-session",
  workerId: "worker-17",
  authority: "parent",
  github: "parent-gateway",
  permissions: "parent",
}

describe("acp governed child Agent subprocess", () => {
  test("binds every outcome of a child Agent session to its RedSkills parent", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn({ GITHUB_TOKEN: undefined, GH_TOKEN: undefined })
    await initialize(acp)
    const session = expectOk(
      await acp.request<NewSessionResponse>("session/new", {
        cwd: fixture.home,
        mcpServers: [],
        _meta: { redskills: { childAgent } },
      }),
    )
    const prompted = expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "work for the parent" }],
      }),
    )

    expect(session._meta).toEqual({
      redskills: {
        childAgent: { version: 1, parentSessionId: "workflow-session", workerId: "worker-17", authority: "parent" },
      },
    })
    expect(prompted.stopReason).toBe("end_turn")
    expect(prompted._meta).toEqual(session._meta)
    expect(await acp.close()).toBe(0)
  }, 60_000)

  test("refuses a child Agent launched with the parent's GitHub credentials", async () => {
    await using fixture = await createAcpFixture()
    const acp = fixture.spawn({ GITHUB_TOKEN: "leaked", GH_TOKEN: undefined })
    await initialize(acp)
    const refused = await acp.request<NewSessionResponse>("session/new", {
      cwd: fixture.home,
      mcpServers: [],
      _meta: { redskills: { childAgent } },
    })

    expect(refused.error?.code).toBe(-32602)
    expect(refused.error?.message).toContain("GitHub credentials belong to the parent")
  }, 60_000)
})
