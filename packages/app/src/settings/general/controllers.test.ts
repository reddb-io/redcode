import { describe, expect, test, vi } from "bun:test"
import { createShellOptions, createSoundPreviewController } from "./behavior"

describe("settings controllers", () => {
  test("normalizes shell names and preserves an unavailable configured shell", () => {
    expect(
      createShellOptions({
        shells: [
          { path: "/bin/bash", name: "bash", acceptable: true },
          { path: "/opt/bash", name: "bash", acceptable: false },
          { path: "/bin/zsh", name: "zsh", acceptable: true },
        ],
        current: "fish",
      }),
    ).toEqual([
      { id: "auto", value: "", name: "", terminalOnly: false },
      { id: "/bin/bash", value: "/bin/bash", name: "/bin/bash", terminalOnly: false },
      { id: "/opt/bash", value: "/opt/bash", name: "/opt/bash", terminalOnly: true },
      { id: "/bin/zsh", value: "zsh", name: "zsh", terminalOnly: false },
      { id: "fish", value: "fish", name: "fish", terminalOnly: false },
    ])
  })

  test("debounces previews and stops audio when its owner releases the preview", async () => {
    vi.useFakeTimers()

    try {
      const played: string[] = []
      const stopped: string[] = []

      const preview = createSoundPreviewController(async (id) => {
        played.push(id ?? "")

        return () => stopped.push(id ?? "")
      })

      preview.play("first")
      vi.advanceTimersByTime(99)
      expect(played).toEqual([])

      preview.play("second")
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(played).toEqual(["second"])

      preview.stop()
      expect(stopped).toEqual(["second"])
    } finally {
      vi.useRealTimers()
    }
  })
})
