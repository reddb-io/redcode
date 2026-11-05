import { expect, test } from "bun:test"
import { persistentConnection } from "./persistent-connection"

test("restores and replays in order before transmitting user input", () => {
  const calls: string[] = []
  const callbacks: VoidFunction[] = []
  const sent: Uint8Array[] = []
  const connection = persistentConnection({
    attachmentID: "client-1",
    write(data, done) {
      calls.push(`write:${new TextDecoder().decode(data)}`)
      callbacks.push(done)
    },
    resize(size) {
      calls.push(`size:${size.cols}x${size.rows}`)
    },
    send(frame) {
      sent.push(frame)
    },
    overflow() {
      throw new Error("unexpected overflow")
    },
    incompatible() {
      throw new Error("unexpected protocol")
    },
  })
  connection.size({ cols: 90, rows: 30 })
  connection.restore({ size: { cols: 80, rows: 24 }, checkpoint: btoa("snapshot") })
  connection.message(
    JSON.stringify({ type: "attached", inputProtocol: 1, info: { size: { cols: 80, rows: 24 } }, role: "controller" }),
  )
  connection.output(new TextEncoder().encode("replay"))
  connection.input("hello")
  connection.message('{"type":"replay_complete"}')
  expect(sent).toHaveLength(0)
  expect(calls).toEqual(["size:80x24", "write:\x1bcsnapshot"])
  callbacks.shift()?.()
  expect(calls).toEqual(["size:80x24", "write:\x1bcsnapshot", "size:80x24", "write:replay"])
  callbacks.shift()?.()
  expect(sent).toHaveLength(1)
  expect([...sent[0]!.subarray(0, 5)]).toEqual([1, 0, 90, 0, 30])
  expect(new TextDecoder().decode(sent[0]!.subarray(5))).toBe("hello")
  connection.dispose()
})

test("bounds output if the renderer cannot keep up", () => {
  let overflow = 0
  const connection = persistentConnection({
    attachmentID: "slow",
    write() {},
    resize() {},
    send() {},
    overflow() {
      overflow++
    },
    incompatible() {
      throw new Error("unexpected protocol")
    },
  })
  connection.output(new Uint8Array(4 * 1024 * 1024))
  connection.output(new Uint8Array(1))
  expect(overflow).toBe(1)
  connection.dispose()
})

test("reconnection keeps unsent input and ignores completion of an obsolete render", () => {
  const callbacks: VoidFunction[] = []
  const sent: Uint8Array[] = []
  const connection = persistentConnection({
    attachmentID: "client",
    write(_data, done) {
      callbacks.push(done)
    },
    resize() {},
    send(frame) {
      sent.push(frame)
    },
    overflow() {
      throw new Error("unexpected overflow")
    },
    incompatible() {
      throw new Error("unexpected protocol")
    },
  })
  const attached = JSON.stringify({ type: "attached", inputProtocol: 1, info: { size: { cols: 80, rows: 24 } } })
  connection.restore({ size: { cols: 80, rows: 24 }, checkpoint: btoa("old") })
  connection.input("queued")
  connection.reconnect()
  connection.restore({ size: { cols: 80, rows: 24 }, checkpoint: btoa("new") })
  connection.message(attached)
  connection.message('{"type":"replay_complete"}')
  expect(callbacks).toHaveLength(1)
  callbacks.shift()?.()
  expect(sent).toHaveLength(0)
  expect(callbacks).toHaveLength(1)
  callbacks.shift()?.()
  expect(sent).toHaveLength(1)
  expect(new TextDecoder().decode(sent[0]!.subarray(5))).toBe("queued")
})
