import { expect, test } from "@playwright/test"
import { openDraft } from "../utils/workspace"

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["microphone"],
})

test("voice settings explicitly select a connection and microphone capture only edits the draft", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const prompts: string[] = []
  const { editor } = await openDraft(page, { name: "VoiceDraft", onPrompt: ({ sessionID }) => prompts.push(sessionID) })
  let voice: unknown
  await page.route(
    (url) => url.pathname === "/api/config",
    async (route) => {
      await route.fulfill({ json: voice ? [{ type: "document", info: { voice } }] : [] })
    },
  )
  const connections = [{ id: "cred_voice", label: "Voice key", integrationID: "openai" }]
  const added: unknown[] = []
  await page.route(
    (url) => url.pathname === "/api/voice/connections",
    async (route) => {
      if (route.request().method() === "POST") {
        added.push(route.request().postDataJSON())
        const entry = { id: "cred_new_voice", label: "My dictation", integrationID: "redcode-voice" }
        connections.push(entry)
        await route.fulfill({ json: { data: entry } })
        return
      }
      await route.fulfill({ json: { data: connections } })
    },
  )
  await page.route("**/api/experimental/config", async (route) => {
    voice = route.request().postDataJSON().voice
    await route.fulfill({ status: 204 })
  })
  let audio: Buffer | undefined
  const transcribing = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname === "/api/voice/transcribe",
    async (route) => {
      audio = Buffer.from(route.request().postDataJSON().audio, "base64")
      transcribing.resolve()
      await release.promise
      await route.fulfill({ json: { data: { text: "implemente a melhoria de voz" } } })
    },
  )
  await editor.fill("Pedido:")
  await page.getByRole("button", { name: "Voice settings", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "Voice settings", exact: true })
  await expect(settings.getByRole("button", { name: "Save voice settings" })).toBeDisabled()
  await settings.getByLabel("Saved API key connection").selectOption("cred_voice")
  await expect(settings.getByLabel("Endpoint URL (optional for built-in providers)")).toBeVisible()
  await expect(settings.getByLabel("Language code (empty for automatic detection)")).toBeVisible()
  await page.screenshot({ path: "../../tmp/voice-settings.png" })
  await settings.getByRole("button", { name: "Save voice settings" }).click()
  await expect(settings).toHaveCount(0)
  expect(voice).toEqual({
    provider: "openai",
    model: "gpt-4o-mini-transcribe",
    connection: { type: "credential", id: "cred_voice" },
  })
  await editor.click()
  await editor.press("End")
  await page.getByRole("button", { name: "Record voice", exact: true }).click()
  const stop = page.getByRole("button", { name: "Stop and transcribe", exact: true })
  await expect(stop).toBeVisible()
  await expect
    .poll(async () =>
      page
        .getByRole("status")
        .filter({ hasText: /0:0[1-9]/ })
        .count(),
    )
    .toBeGreaterThan(0)
  await page.screenshot({ path: "../../tmp/voice-recording-desktop.png" })
  await stop.click()
  await transcribing.promise
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
  expect(audio?.toString("ascii", 0, 4)).toBe("RIFF")
  expect(audio?.readUInt32LE(24)).toBe(16_000)
  expect(audio!.length).toBeGreaterThan(32_044)
  release.resolve()
  await expect(editor).toHaveText("Pedido: implemente a melhoria de voz ")
  expect(prompts).toEqual([])
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const screen = page.getByTestId("settings-screen")
  await screen.getByRole("tab", { name: "Server", exact: true }).click()
  await screen.getByRole("button", { name: "Voice settings", exact: true }).click()
  await expect(settings.getByLabel("Saved API key connection")).toHaveValue("cred_voice")
  await settings.getByLabel("Saved API key connection").selectOption("new")
  await settings.getByLabel("Connection name", { exact: true }).fill("My dictation")
  await settings.getByLabel("Voice API key", { exact: true }).fill("fixture-private-key")
  await expect(settings.getByLabel("Voice API key", { exact: true })).toHaveAttribute("type", "password")
  await settings.getByLabel("Language code (empty for automatic detection)").fill("pt")
  await settings.getByRole("button", { name: "Save voice settings" }).click()
  await expect(settings).toHaveCount(0)
  expect(added).toEqual([{ label: "My dictation", key: "fixture-private-key" }])
  expect(voice).toMatchObject({ connection: { type: "credential", id: "cred_new_voice" }, language: "pt" })
  await screen.getByRole("button", { name: "Voice settings", exact: true }).click()
  await expect(settings.getByLabel("Saved API key connection")).toHaveValue("cred_new_voice")
  await expect(settings.getByLabel("Language code (empty for automatic detection)")).toHaveValue("pt")
  expect(errors).toEqual([])
})
