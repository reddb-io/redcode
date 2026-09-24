import { describe, expect, test } from "bun:test"
import { deck, type PresentEvent, type Presenting } from "@reddb-io/redcode-design/slides"

const logic = deck()
const ids = ["s1", "s2", "s3"]
const slides = ids.map((id) => ({ id, name: id }))
const goto = (slide: string, time: number, from: string) => ({ type: "goto", slide, time, from, sender: from })
/** A window whose slide frame has announced the deck and shows `slide`. */
const ready = (self: string, slide = "s1") =>
  logic.update(logic.start(self, slide, 0), {
    type: "frame",
    slides,
    current: slide,
    origin: "command",
    seq: 0,
    now: 0,
  }).host

describe("presentation window ordering", () => {
  test("applies only gotos newer than its show, never its own, and never passes one on", () => {
    const first = logic.update(ready("b"), { type: "channel", message: goto("s2", 5, "a"), now: 0 })
    expect(first.host.show).toMatchObject({ slide: "s2", time: 5, from: "a" })
    expect(first.post).toBeUndefined()
    for (const message of [
      goto("s3", 4, "c"),
      // The same move again, and one of the same time from a lower sender id.
      goto("s2", 5, "a"),
      goto("s3", 5, "0"),
      // This window's own message, however new.
      goto("s3", 9, "b"),
    ]) {
      const result = logic.update(first.host, { type: "channel", message, now: 0 })
      expect(result.host.show).toEqual(first.host.show)
      expect(result.post).toBeUndefined()
    }
    const tie = logic.update(first.host, { type: "channel", message: goto("s3", 5, "c"), now: 0 })
    expect(tie.host.show).toMatchObject({ slide: "s3", time: 5, from: "c" })
    expect(tie.post).toBeUndefined()
  })

  test("two windows that move at once settle on the same slide", () => {
    const a = logic.update(ready("a"), { type: "move", slide: "s2" })
    const c = logic.update(ready("c"), { type: "move", slide: "s3" })
    expect(a.post).toEqual({ type: "goto", slide: "s2", time: 1, from: "a", sender: "a" })
    const left = logic.update(a.host, { type: "channel", message: c.post, now: 0 }).host
    const right = logic.update(c.host, { type: "channel", message: a.post, now: 0 }).host
    expect([left.show.slide, right.show.slide]).toEqual(["s3", "s3"])
  })

  test("two new windows that answer each other's hello settle on one slide", () => {
    const a = logic.sync({ slide: "s1", started: 0, time: 0, from: "" }, { type: "hello", sender: "b" }, "a")
    const b = logic.sync({ slide: "s2", started: 0, time: 0, from: "" }, { type: "hello", sender: "a" }, "b")
    const left = logic.sync(a.show, b.reply, "a").show
    const right = logic.sync(b.show, a.reply, "b").show
    expect(left.slide).toBe(right.slide)
  })

  test("a move is stamped after every move the window has seen", () => {
    const host = logic.update(ready("a"), { type: "channel", message: goto("s2", 7, "b"), now: 0 }).host
    expect(logic.update(host, { type: "move", slide: "s3" }).post).toEqual({
      type: "goto",
      slide: "s3",
      time: 8,
      from: "a",
      sender: "a",
    })
  })
})

describe("slide frame echoes", () => {
  test("the frame's report of a command never moves the show; a move made inside it does", () => {
    const moved = logic.update(ready("a"), { type: "channel", message: goto("s2", 1, "b"), now: 0 }).host
    const sent = logic.command(moved)
    expect(sent.message).toEqual({ type: "design:screen", id: "s2", seq: 1 })
    // Nothing new to show: no second command.
    expect(logic.command(sent.host).message).toBeUndefined()
    for (const announcement of [
      // Sent before command 1 arrived, by a key or by a mutation.
      { current: "s1", origin: "user", seq: 0 },
      { current: "s1", origin: "command", seq: 0 },
      // The report of command 1 itself.
      { current: "s2", origin: "command", seq: 1 },
      // A frame that does not say.
      { current: "s3", origin: undefined, seq: undefined },
    ]) {
      const result = logic.update(sent.host, { type: "frame", slides, ...announcement, now: 0 })
      expect(result.host.show).toEqual(sent.host.show)
      expect(result.post).toBeUndefined()
    }
    const followed = logic.update(sent.host, { type: "frame", slides, current: "s3", origin: "user", seq: 1, now: 0 })
    expect(followed.host.show).toEqual({ slide: "s3", started: 0, time: 2, from: "a" })
    expect(followed.post).toEqual({ type: "goto", slide: "s3", time: 2, from: "a", sender: "a" })
    // The frame is already there, so it is not told again.
    expect(logic.command(followed.host).message).toBeUndefined()
  })

  test("the first announcement keeps the slide the link asked for and sends the frame there", () => {
    const host = logic.update(logic.start("a", "s3", 0), {
      type: "frame",
      slides,
      current: "s1",
      origin: "command",
      seq: 0,
      now: 0,
    }).host
    expect(host.show.slide).toBe("s3")
    expect(logic.command(host).message).toEqual({ type: "design:screen", id: "s3", seq: 1 })
  })
})

describe("deck boundaries", () => {
  test("previous on the first slide and next on the last are no moves anywhere", () => {
    for (const input of [{ key: "ArrowLeft" }, { key: "ArrowUp" }, { key: "PageUp" }, { key: " ", shift: true }])
      expect(logic.step(input, 0, 3)).toBeUndefined()
    for (const input of [{ key: "ArrowRight" }, { key: "ArrowDown" }, { key: "PageDown" }, { key: " " }])
      expect(logic.step(input, 2, 3)).toBeUndefined()
    expect(logic.step({ key: "Home" }, 0, 3)).toBeUndefined()
    expect(logic.step({ key: "End" }, 2, 3)).toBeUndefined()
    expect(logic.button("previous", 0, 3)).toBeUndefined()
    expect(logic.button("next", 2, 3)).toBeUndefined()
    expect(logic.button("next", -1, 3)).toBeUndefined()
    expect(logic.button("previous", 1, 3)).toBe(0)
    expect(logic.button("next", 1, 3)).toBe(2)
    const host = ready("a")
    expect(logic.update(host, { type: "move", slide: "s1" })).toEqual({ host, draw: false })
  })
})

describe("loop guard", () => {
  test("counts the moves of the last second", () => {
    const burst = Array.from({ length: 50 }, (_, index) => index)
    expect(logic.guard([], 0)).toEqual({ recent: [0], paused: false })
    expect(logic.guard(burst.slice(1), 100).paused).toBe(false)
    expect(logic.guard(burst, 100).paused).toBe(true)
    expect(logic.guard(burst, 1100)).toEqual({ recent: [1100], paused: false })
  })

  test("a burst of moves nobody made here pauses sync until a key or click", () => {
    const flooded = Array.from({ length: 60 }, (_, index) => index + 1).reduce(
      (host, time) =>
        logic.update(host, { type: "channel", message: goto(time % 2 ? "s2" : "s1", time, "b"), now: 500 }).host,
      ready("a"),
    )
    expect(flooded).toMatchObject({ paused: true, clock: 60, show: { slide: "s1", time: 50 } })
    // Paused, a move reported by the frame is not followed and the frame is put back.
    const reported = logic.update(flooded, {
      type: "frame",
      slides,
      current: "s3",
      origin: "user",
      seq: flooded.seq,
      now: 600,
    })
    expect(reported.host.show.slide).toBe("s1")
    expect(reported.post).toBeUndefined()
    expect(logic.command(reported.host).message).toMatchObject({ type: "design:screen", id: "s1" })
    // A key resumes, asks the others where the show went, and moves after every move seen.
    const resumed = logic.update(reported.host, { type: "input" })
    expect(resumed.host.paused).toBe(false)
    expect(resumed.post).toEqual({ type: "hello", sender: "a" })
    expect(logic.update(resumed.host, { type: "move", slide: "s2" }).post).toMatchObject({ slide: "s2", time: 61 })
  })
})

/**
 * Windows and their slide frames exchanging messages through an in-memory bus, one message per task,
 * in order. Each host is wired as present.ts wires it; each frame behaves as the screens runtime does:
 * a command records its number, a key is the reader's move, and every change is announced a task later.
 * A frame also announces again on its own, as a mutation of its slides makes it, which can cross a
 * command in flight.
 */
function bus() {
  const queue: (() => void)[] = []
  const windows = new Map<
    string,
    { host: Presenting; frame: { current: string; origin: "user" | "command"; seq: number }; visited: string[] }
  >()
  const tasks = { run: 0 }
  const post = (from: string, message: unknown) => {
    for (const name of windows.keys())
      if (name !== from) queue.push(() => dispatch(name, { type: "channel", message, now: tasks.run }))
  }
  const dispatch = (name: string, event: PresentEvent) => {
    const entry = windows.get(name)!
    const result = logic.update(entry.host, event)
    entry.host = result.host
    if (result.post) post(name, result.post)
    if (!result.draw) return
    const sent = logic.command(entry.host)
    entry.host = sent.host
    const message = sent.message
    if (message) queue.push(() => command(name, message))
    if (entry.visited.at(-1) !== entry.host.show.slide) entry.visited.push(entry.host.show.slide)
  }
  const announce = (name: string) => {
    const frame = { ...windows.get(name)!.frame }
    queue.push(() => dispatch(name, { type: "frame", slides, ...frame, now: tasks.run }))
    queue.push(() => {
      const again = { ...windows.get(name)!.frame }
      queue.push(() => dispatch(name, { type: "frame", slides, ...again, now: tasks.run }))
    })
  }
  const command = (name: string, message: { id: string; seq: number }) => {
    const frame = windows.get(name)!.frame
    frame.origin = "command"
    frame.seq = message.seq
    if (frame.current === message.id) return
    frame.current = message.id
    announce(name)
  }
  return {
    windows,
    queue,
    open: (name: string, hash: string) => {
      windows.set(name, {
        host: logic.start(name, hash, 0),
        frame: { current: "s1", origin: "command", seq: 0 },
        visited: [],
      })
      post(name, { type: "hello", sender: name })
      announce(name)
    },
    /** A key pressed in a window, outside its slide frame. */
    key: (name: string, key: string) => {
      dispatch(name, { type: "input" })
      const host = windows.get(name)!.host
      const next = logic.step(
        { key },
        host.slides.findIndex((item) => item.id === host.show.slide),
        host.slides.length,
      )
      if (next !== undefined) dispatch(name, { type: "move", slide: host.slides[next].id })
    },
    /** A key pressed inside a window's slide frame. */
    press: (name: string, key: string) => {
      const frame = windows.get(name)!.frame
      const next = logic.step({ key }, ids.indexOf(frame.current), ids.length)
      if (next === undefined) return
      frame.current = ids[next]
      frame.origin = "user"
      announce(name)
    },
    /** Delivers every message until none is left; fails when the windows never stop talking. */
    settle: () => {
      while (queue.length) {
        tasks.run++
        if (tasks.run > 5000) throw new Error("the windows never settle")
        queue.shift()!()
      }
    },
  }
}

describe("two windows and their frames", () => {
  const agree = (show: ReturnType<typeof bus>, slide: string) => {
    for (const entry of show.windows.values()) {
      expect(entry.host.show.slide).toBe(slide)
      expect(entry.frame.current).toBe(slide)
      expect(entry.host.paused).toBe(false)
      // No window ever came back to a slide it had left: no oscillation.
      expect(new Set(entry.visited).size).toBe(entry.visited.length)
    }
  }

  test("back on the first slide settles, even after moves that cross in flight", () => {
    const show = bus()
    show.open("presenter", "")
    show.open("audience", "")
    show.settle()
    agree(show, "s1")
    // Back on the first slide, in either window or either frame, says nothing to anyone.
    show.press("presenter", "ArrowLeft")
    show.key("audience", "ArrowLeft")
    show.key("presenter", "PageUp")
    show.press("audience", "ArrowUp")
    expect(show.queue).toHaveLength(0)
    // A move inside one frame crosses a move in the other window, then the reader goes back past slide 1.
    show.press("presenter", "ArrowRight")
    show.key("audience", "ArrowRight")
    show.press("presenter", "ArrowLeft")
    show.settle()
    const slide = show.windows.get("presenter")!.host.show.slide
    for (const entry of show.windows.values()) {
      expect(entry.host.show.slide).toBe(slide)
      expect(entry.frame.current).toBe(slide)
    }
    show.key("presenter", "Home")
    show.settle()
    show.press("presenter", "ArrowLeft")
    show.key("audience", "ArrowLeft")
    show.press("audience", "ArrowLeft")
    expect(show.queue).toHaveLength(0)
    for (const entry of show.windows.values()) {
      expect(entry.host.show.slide).toBe("s1")
      expect(entry.frame.current).toBe("s1")
      expect(entry.host.paused).toBe(false)
    }
  })

  test("a window joining a running show takes its slide without moving it", () => {
    const show = bus()
    show.open("presenter", "")
    show.settle()
    show.press("presenter", "ArrowRight")
    show.settle()
    show.key("presenter", "ArrowRight")
    show.settle()
    agree(show, "s3")
    const before = [...show.windows.get("presenter")!.visited]
    // The audience window opens on a link to another slide, as a stale tab would.
    show.open("audience", "s1")
    show.settle()
    agree(show, "s3")
    expect(show.windows.get("presenter")!.visited).toEqual(before)
  })
})
