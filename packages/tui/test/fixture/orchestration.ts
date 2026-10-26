import type { SessionInfo } from "@opencode/client"
import { directory, json } from "./tui-client"

export function orchestrationFixture() {
  const sessions: SessionInfo[] = [
    { id: "ses_orch_root", title: "Ship the API", agent: "build" },
    { id: "ses_orch_search", title: "Map authentication", agent: "explore", parentID: "ses_orch_root" },
    { id: "ses_orch_test", title: "Check API tests", agent: "general", parentID: "ses_orch_root" },
  ].map((item) => ({
    ...item,
    projectID: "proj_test",
    location: { directory },
    model: { providerID: "red-router", id: item.parentID ? "worker-model" : "chosen-model" },
    cost: 0.012,
    tokens: { input: 1200, output: 90, reasoning: 0, cache: { read: 400, write: 0 } },
    time: { created: 1000, updated: 2000 },
  }))
  const requests: Array<{ path: string; query: string; method: string; body?: unknown }> = []
  const state = { fail: false }
  return {
    sessions,
    requests,
    fail: () => {
      state.fail = true
    },
    fetch: async (url: URL, request: Request) => {
      requests.push({
        path: url.pathname,
        query: url.search,
        method: request.method,
        ...(request.method === "POST"
          ? {
              body: await request
                .clone()
                .json()
                .catch(() => undefined),
            }
          : {}),
      })
      if (url.pathname === "/api/experimental/intelligence")
        return json({
          settings: {
            enabled: true,
            reasoning: "dual",
            onboarding: "completed",
            evaluator: { transport: "red-router", baseURL: "https://private-gateway.invalid", model: "jev-fixture" },
            fast: { providerID: "red-router", id: "review-model" },
          },
          environment: "",
          evaluators: [],
          effective: { reasoning: "dual", source: "config" },
        })
      if (url.pathname === "/api/experimental/intelligence/history") {
        if (state.fail && url.searchParams.get("limit") === "6") return new Response("Offline", { status: 503 })
        return json([
          {
            id: `evaluation-${url.searchParams.get("sessionID")}`,
            fingerprint: "fixture",
            sessionID: url.searchParams.get("sessionID"),
            operation: "tool_usage",
            mode: "observe",
            policy: "fixture",
            decision: "accepted",
            model: "jev-fixture",
            answers: {},
            issues: [],
            created: 2000,
            duration: 42,
            usage: { input_tokens: 21, output_tokens: 3 },
          },
        ])
      }
      if (url.pathname === "/api/session/active")
        return json({ data: { ses_orch_search: { type: "running" }, ses_orch_test: { type: "running" } } })
      if (url.pathname === "/api/session") {
        const parent = url.searchParams.get("parentID")
        return json({
          data: sessions.filter((item) => (parent && parent !== "null" ? item.parentID === parent : !item.parentID)),
          cursor: {},
        })
      }
      const match = /^\/api\/session\/([^/]+)(?:\/(message|inbox|permission|form|todo|interrupt|prompt))?$/.exec(
        url.pathname,
      )
      if (!match || !sessions.some((item) => item.id === match[1])) return
      if (match[2] === "interrupt") return json({ interrupted: true })
      if (match[2] === "prompt") return json({ data: {} })
      if (match[2]) return json({ data: [], cursor: {} })
      return json({ data: sessions.find((item) => item.id === match[1]) })
    },
  }
}
