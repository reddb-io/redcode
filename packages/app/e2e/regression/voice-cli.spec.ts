import { expect, test } from "@playwright/test"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["microphone"],
})

test("the self-contained CLI recorder captures real browser audio and returns reviewed text", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const url = Promise.withResolvers<string>()
  const accepted = Promise.withResolvers<string>()
  const executable = process.env.REDCODE_VOICE_FIXTURE_EXECUTABLE
  const child = spawn(
    executable ?? "bun",
    executable ? [] : [fileURLToPath(new URL("../utils/voice-recorder-fixture.ts", import.meta.url))],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  let diagnostics = ""
  child.stderr.on("data", (data: Buffer) => {
    diagnostics += data.toString()
  })
  child.on("exit", (code) => {
    if (code) {
      url.reject(new Error(diagnostics))
      accepted.reject(new Error(diagnostics))
    }
  })
  void accepted.promise.catch(() => undefined)
  const lines = createInterface({ input: child.stdout })
  lines.on("line", (line) => {
    const value = JSON.parse(line) as { url?: string; accepted?: string }
    if (value.url) url.resolve(value.url)
    if (value.accepted) accepted.resolve(value.accepted)
  })
  child.on("error", (error) => {
    url.reject(error)
    accepted.reject(error)
  })
  try {
    await page.goto(await url.promise)
    await page.getByRole("button", { name: "Record", exact: true }).click()
    await expect(page.getByRole("status")).toHaveText(/Recording · [1-9]\d*s/)
    await page.getByRole("button", { name: "Stop and transcribe" }).click()
    const text = page.getByRole("textbox", { name: "Transcript" })
    await expect(text).toHaveValue("spoken from the CLI recorder")
    await text.fill("reviewed CLI instruction")
    await page.getByRole("button", { name: "Add to draft" }).click()
    expect(await accepted.promise).toBe("reviewed CLI instruction")
    await expect(page.getByRole("status")).toContainText("Transcript added")
    expect(errors).toEqual([])
  } finally {
    child.kill()
    lines.close()
  }
})
