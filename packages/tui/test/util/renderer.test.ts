import { expect, test } from "bun:test"
import { destroyRenderer, setTerminalTitle } from "../../src/util/renderer"

test("removes control characters from terminal titles", () => {
  const calls: string[] = []
  setTerminalTitle(
    {
      setTerminalTitle(title) {
        calls.push(title)
      },
    },
    "Fix parser bug\nin tokenizer\u0000now",
  )
  expect(calls).toEqual(["Fix parser bug in tokenizer now"])
})

test("clears the terminal title before destroying the renderer", () => {
  const calls: string[] = []
  destroyRenderer({
    isDestroyed: false,
    setTerminalTitle(title) {
      calls.push(`title:${title}`)
    },
    destroy() {
      calls.push("destroy")
    },
  })
  expect(calls).toEqual(["title:", "destroy"])
})

test("still clears the title after renderer destruction", () => {
  const calls: string[] = []
  destroyRenderer({
    isDestroyed: true,
    setTerminalTitle(title) {
      calls.push(`title:${title}`)
    },
    destroy() {
      calls.push("destroy")
    },
  })
  expect(calls).toEqual(["title:"])
})
