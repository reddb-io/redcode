import { expect, test } from "bun:test"
import { allowsAudioCapture } from "./media-permission"

test.each([
  [{ renderer: true, mainFrame: true, types: ["audio"] }, true],
  [{ renderer: true, mainFrame: true, types: ["video"] }, false],
  [{ renderer: true, mainFrame: true, types: ["audio", "video"] }, false],
  [{ renderer: true, mainFrame: false, types: ["audio"] }, false],
  [{ renderer: false, mainFrame: true, types: ["audio"] }, false],
  [{ renderer: true, mainFrame: true, types: [] }, false],
  [{ renderer: true, mainFrame: true }, false],
] as const)("microphone permission %p → %p", (input, allowed) => expect(allowsAudioCapture(input)).toBe(allowed))
