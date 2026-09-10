import { describe, expect } from "bun:test"
import type {
  CloseSessionResponse,
  ListSessionsResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  ResumeSessionResponse,
} from "@agentclientprotocol/sdk"
import { Duration, Effect, Fiber } from "effect"
import { cliIt } from "../../lib/cli-process"
import { pollWithTimeout } from "../../lib/effect"
import { expectOk, selectConfigOption } from "./acp-test-client"
import { createAcpClient, initialize, newSession, verifierConfig } from "./helpers"

describe("opencode acp lifecycle subprocess", () => {
  cliIt.live(
    "stdin EOF during startup exits cleanly",
    ({ opencode }) =>
      Effect.gen(function* () {
        const acp = yield* opencode.acp()
        acp.close()

        // Source execution includes transpilation and server startup before it can observe EOF.
        const code = yield* Effect.promise(() => acp.exited).pipe(Effect.timeout(Duration.seconds(15)))
        expect(code).toBe(0)
      }),
    60_000,
  )

  cliIt.live(
    "stdin EOF after initialization exits within the shutdown deadline",
    ({ opencode }) =>
      Effect.gen(function* () {
        const acp = yield* opencode.acp()
        yield* acp.send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 1, clientCapabilities: {} },
        })
        const ready = yield* acp.receive.pipe(Effect.timeout(Duration.seconds(15)))
        expect(ready).toMatchObject({ id: 1, result: { protocolVersion: 1 } })
        acp.close()

        const code = yield* Effect.promise(() => acp.exited).pipe(Effect.timeout(Duration.seconds(5)))
        expect(code).toBe(0)
      }),
    60_000,
  )

  cliIt.live(
    "governed child cancellation stays bound to the parent session",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpClient(
          { opencode },
          { REDCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
        )
        yield* initialize(acp)
        const session = expectOk(
          yield* acp.request<NewSessionResponse>("session/new", {
            cwd: home,
            mcpServers: [],
            _meta: {
              redskills: {
                childAgent: {
                  version: 1,
                  parentSessionId: "workflow-session",
                  workerId: "worker-17",
                  authority: "parent",
                  github: "parent-gateway",
                  permissions: "parent",
                },
              },
            },
          }),
        )

        yield* llm.hang
        const running = yield* acp
          .request<PromptResponse>("session/prompt", {
            sessionId: session.sessionId,
            prompt: [{ type: "text", text: "keep working" }],
          })
          .pipe(Effect.forkChild)
        // Title generation can be the first provider call. Wait until the prompt consumes
        // the queued hanging response, or the next prompt may inherit it after cancellation.
        yield* pollWithTimeout(
          llm.pending.pipe(Effect.map((pending) => (pending === 0 ? true : undefined))),
          "prompt provider never consumed the queued response",
          "15 seconds",
        )
        yield* acp.notify("session/cancel", { sessionId: session.sessionId })
        const cancelled = expectOk(yield* Fiber.join(running))

        expect(cancelled.stopReason).toBe("cancelled")
        expect(cancelled._meta).toEqual(session._meta)

        yield* llm.text("continued")
        const continued = expectOk(
          yield* acp.request<PromptResponse>("session/prompt", {
            sessionId: session.sessionId,
            prompt: [{ type: "text", text: "continue" }],
          }),
        )
        expect(continued.stopReason).toBe("end_turn")
        expect(continued._meta).toEqual(session._meta)
      }),
    60_000,
  )

  cliIt.live(
    "close capability and close request",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpClient(
          { opencode },
          { REDCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
        )
        const initialized = yield* initialize(acp)
        expect(initialized.agentCapabilities?.sessionCapabilities?.close).toEqual({})

        const session = yield* newSession(acp, home)
        expectOk(yield* acp.request<CloseSessionResponse>("session/close", { sessionId: session.sessionId }))
      }),
    60_000,
  )

  cliIt.live(
    "loadSession capability and load request return session config options",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpClient(
          { opencode },
          { REDCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
        )
        const initialized = yield* initialize(acp)
        expect(initialized.agentCapabilities?.loadSession).toBe(true)
        const session = yield* newSession(acp, home)
        const loaded = expectOk(
          yield* acp.request<LoadSessionResponse>("session/load", {
            cwd: home,
            sessionId: session.sessionId,
            mcpServers: [],
          }),
        )

        expect(selectConfigOption(loaded.configOptions, "model")?.category).toBe("model")
      }),
    60_000,
  )

  cliIt.live(
    "list request includes a live ACP-created session",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpClient(
          { opencode },
          { REDCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
        )
        yield* initialize(acp)
        const session = yield* newSession(acp, home)
        const listed = expectOk(yield* acp.request<ListSessionsResponse>("session/list", { cwd: home }))

        expect(listed.sessions.some((item) => item.sessionId === session.sessionId)).toBe(true)
      }),
    60_000,
  )

  cliIt.live(
    "resume capability advertisement",
    ({ opencode }) =>
      Effect.gen(function* () {
        const initialized = yield* initialize(yield* createAcpClient({ opencode }))

        expect(initialized.agentCapabilities?.sessionCapabilities?.resume).toEqual({})
      }),
    60_000,
  )

  cliIt.live(
    "resume request returns session config options",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpClient(
          { opencode },
          { REDCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
        )
        yield* initialize(acp)
        const session = yield* newSession(acp, home)
        const resumed = expectOk(
          yield* acp.request<ResumeSessionResponse>("session/resume", {
            cwd: home,
            sessionId: session.sessionId,
            mcpServers: [],
          }),
        )

        expect(selectConfigOption(resumed.configOptions, "model")?.category).toBe("model")
      }),
    60_000,
  )
})
