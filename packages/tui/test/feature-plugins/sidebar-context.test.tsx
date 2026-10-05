/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { SidebarContext } from "../../src/feature-plugins/sidebar/context"

function context(options?: { cost?: number; tokens?: number; limit?: number }) {
  const color = RGBA.fromInts(200, 200, 200)
  return {
    theme: { text: { base: color, muted: color } },
    data: {
      session: {
        get: () => ({
          location: { directory: "/workspace" },
          cost: options?.cost ?? 0,
          tokens: { input: options?.tokens ?? 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
        cost: () => options?.cost ?? 0,
        message: {
          list: () =>
            options?.tokens
              ? [
                  {
                    id: "message",
                    type: "assistant",
                    time: { created: 1 },
                    model: { providerID: "provider", id: "model" },
                    tokens: {
                      input: options.tokens,
                      output: 0,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                  },
                ]
              : [],
        },
      },
      location: {
        model: {
          list: () =>
            options?.limit
              ? [{ providerID: "provider", id: "model", limit: { context: options.limit, output: 8_192 } }]
              : [],
        },
      },
    },
    client: {
      session: {
        budget: {
          get: async () => ({
            limits: {},
            override: {},
            spent: { cost: 0, tokens: 0, unpriced: 0 },
            exceeded: false,
            unknown: false,
            reason: "",
          }),
        },
        goal: { get: async () => null },
      },
    },
  } as unknown as Context
}

test("sidebar preserves the empty Redcode context summary", async () => {
  const app = await testRender(() => <SidebarContext context={context()} sessionID="session" />, {
    width: 42,
    height: 8,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Context")
    expect(app.captureCharFrame()).toContain("0 tokens")
    expect(app.captureCharFrame()).toContain("0% used")
    expect(app.captureCharFrame()).toContain("$0.00 spent")
    expect(app.captureCharFrame()).not.toContain("Not measured")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar shows available context usage", async () => {
  const app = await testRender(() => <SidebarContext context={context({ tokens: 1234 })} sessionID="session" />, {
    width: 42,
    height: 8,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Context")
    expect(app.captureCharFrame()).toContain("1,234 tokens")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar shows the context window the usage is measured against", async () => {
  const app = await testRender(
    () => <SidebarContext context={context({ tokens: 321_000, limit: 115_200 })} sessionID="session" />,
    { width: 42, height: 8 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("321,000 / 115,200 tokens")
    expect(app.captureCharFrame()).toContain("279% used")
  } finally {
    app.renderer.destroy()
  }
})
