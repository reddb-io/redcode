import { describe, expect, test } from "bun:test"
import { BrowserTunnelMachine } from "../src/tunnel-machine.js"

const replay = (events: readonly BrowserTunnelMachine.Event[], state = BrowserTunnelMachine.initial()) =>
  events.reduce<BrowserTunnelMachine.Transition>((last, event) => BrowserTunnelMachine.transition(last.state, event), {
    state,
    effects: [],
  })
const opened = (id: string): BrowserTunnelMachine.Event[] => [
  { type: "open.started", id },
  { type: "open.connected", id },
]
const size = (state: BrowserTunnelMachine.State) => (state.status === "active" ? state.entries.size : -1)

describe("browser tunnel lifecycle", () => {
  test("claims capacity before connect and frees completed tunnels without close", () => {
    const full = replay(
      Array.from({ length: BrowserTunnelMachine.MAX_TUNNELS }, (_, index) => ({
        type: "open.started" as const,
        id: `t${index}`,
      })),
    )
    expect(BrowserTunnelMachine.openError(full.state)?.message).toContain("64-connection limit")

    const finished = replay([
      ...opened("a"),
      { type: "write.started", id: "a" },
      { type: "write.settled", id: "a", end: true, outcome: "ok", socketClosed: false },
      { type: "read.started", id: "a" },
      { type: "read.settled", id: "a", outcome: "eof", socketClosed: false },
    ])
    expect(size(finished.state)).toBe(0)
  })

  test("rejects a connect that lands after close or attachment disposal", () => {
    const closed = replay([
      { type: "open.started", id: "a" },
      { type: "tunnel.closed", id: "a" },
      { type: "open.connected", id: "a" },
    ])
    expect(closed.effects).toEqual([{ type: "destroy-socket", id: "a" }])
    expect(BrowserTunnelMachine.isOpen(closed.state, "a")).toBe(false)

    const disposed = replay([
      { type: "open.started", id: "b" },
      { type: "disposed" },
      { type: "open.connected", id: "b" },
    ])
    expect(disposed.state.status).toBe("disposed")
    expect(BrowserTunnelMachine.isOpen(disposed.state, "b")).toBe(false)
  })

  test("an interrupted write evicts the tunnel and an interrupted read releases only the read", () => {
    const written = replay([
      ...opened("a"),
      { type: "write.started", id: "a" },
      { type: "write.settled", id: "a", end: false, outcome: "interrupted", socketClosed: false },
    ])
    expect(size(written.state)).toBe(0)

    const read = replay([
      ...opened("b"),
      { type: "read.started", id: "b" },
      { type: "read.settled", id: "b", outcome: "interrupted", socketClosed: false },
    ])
    expect(BrowserTunnelMachine.readError(read.state, "b")).toBeUndefined()
  })
})
