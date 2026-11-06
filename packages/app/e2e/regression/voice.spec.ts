import { expect, test } from "@playwright/test"
import { openDraft, openSettings } from "../utils/workspace"
import { observeMicrophone } from "../utils/microphone"
import { NO_PROVIDER, REMOTE_SERVER, SERVER, project, seed, session, sessionHref } from "../utils/app"
import { mockServers } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["microphone"],
})

test("configured voice provider appears in provider settings with a link to manage it", async ({ page }) => {
  const { settings } = await openSettings(page, { name: "VoiceProviderDiscovery" })
  await page.route((url) => url.pathname === "/api/config", (route) => route.fulfill({ json: [{ type: "document", info: { voice: {
    provider: "elevenlabs", model: "scribe_v2", connection: { type: "credential", id: "cred_scribe" },
  } } }] }))
  await page.route((url) => url.pathname === "/api/voice/connections", (route) => route.fulfill({ json: { data: [
    { id: "cred_scribe", label: "ElevenLabs", integrationID: "redcode-voice" },
  ] } }))
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  const section = settings.getByRole("region", { name: "Voice transcription" })
  await expect(section).toContainText("ElevenLabs")
  await section.getByRole("button", { name: "Manage voice settings" }).click()
  await expect(settings.getByLabel("Transcription provider")).toHaveValue("elevenlabs")
})

test("voice keys can be rotated and deleted without exposing shared provider keys", async ({ page }) => {
  const { settings } = await openSettings(page, { name: "VoiceKeyManagement" })
  let voice: Record<string, unknown> = { provider: "elevenlabs", model: "scribe_v2", connection: { type: "credential", id: "cred_scribe" } }
  const updates: unknown[] = []
  const deletions: string[] = []
  await page.route((url) => url.pathname === "/api/config", (route) => route.fulfill({ json: [{ type: "document", info: { voice } }] }))
  await page.route((url) => url.pathname === "/api/voice/connections", (route) => route.fulfill({ json: { data: [
    { id: "cred_scribe", label: "ElevenLabs", integrationID: "redcode-voice" },
    { id: "cred_shared", label: "Shared model key", integrationID: "openai" },
  ] } }))
  await page.route("**/api/experimental/config", (route) => { voice = route.request().postDataJSON().voice; return route.fulfill({ status: 204 }) })
  await page.route((url) => url.pathname === "/api/credential/cred_scribe", (route) => {
    if (route.request().method() === "PATCH") updates.push(route.request().postDataJSON())
    if (route.request().method() === "DELETE") deletions.push("cred_scribe")
    return route.fulfill({ status: 204 })
  })
  await settings.getByRole("tab", { name: "Voice", exact: true }).click()
  await settings.getByText("Manage saved voice keys", { exact: true }).click()
  const manager = settings.locator("details").filter({ hasText: "Manage saved voice keys" })
  await expect(manager).not.toContainText("Shared model key")
  await manager.getByRole("button", { name: "Replace key", exact: true }).click()
  await manager.getByLabel("New API key", { exact: true }).fill("replacement-secret")
  await manager.getByRole("button", { name: "Save replacement key" }).click()
  await expect.poll(() => updates).toEqual([{ value: { type: "key", key: "replacement-secret" } }])
  await expect(manager.getByLabel("New API key", { exact: true })).toHaveCount(0)
  await manager.getByRole("button", { name: "Delete key", exact: true }).click()
  await expect(manager).toContainText("other projects")
  await manager.getByRole("button", { name: "Confirm delete key" }).click()
  await expect.poll(() => deletions).toEqual(["cred_scribe"])
  expect(voice.connection).toBeUndefined()
  await expect(manager).toHaveCount(0)
})

test("changes to an existing voice configuration are saved automatically", async ({ page }) => {
  const { settings } = await openSettings(page, { name: "VoiceAutoSave" })
  let voice: Record<string, unknown> = { provider: "elevenlabs", model: "scribe_v2", connection: { type: "credential", id: "cred_scribe" } }
  await page.route((url) => url.pathname === "/api/config", (route) => route.fulfill({ json: [{ type: "document", info: { voice } }] }))
  await page.route((url) => url.pathname === "/api/voice/connections", (route) => route.fulfill({ json: { data: [
    { id: "cred_scribe", label: "ElevenLabs", integrationID: "redcode-voice" },
  ] } }))
  await page.route("**/api/experimental/config", (route) => { voice = route.request().postDataJSON().voice; return route.fulfill({ status: 204 }) })
  await settings.getByRole("tab", { name: "Voice", exact: true }).click()
  await settings.getByRole("combobox", { name: /^Transcription mode/ }).selectOption("realtime")
  await expect.poll(() => voice.mode).toBe("realtime")
  await expect(settings.getByText("Voice settings saved automatically.")).toBeVisible()
})

test("OpenRouter voice models can be loaded, searched, selected and entered manually", async ({ page }) => {
  const { settings } = await openSettings(page, { name: "VoiceModels" })
  let voice: Record<string, unknown> = { provider: "openrouter", model: "elevenlabs/scribe-v2", connection: { type: "credential", id: "cred_router" } }
  let request: unknown
  await page.route((url) => url.pathname === "/api/config", (route) => route.fulfill({ json: [{ type: "document", info: { voice } }] }))
  await page.route((url) => url.pathname === "/api/voice/connections", (route) => route.fulfill({ json: { data: [
    { id: "cred_router", label: "Router", integrationID: "openrouter" },
  ] } }))
  await page.route((url) => url.pathname === "/api/voice/models", (route) => {
    request = route.request().postDataJSON()
    return route.fulfill({ json: { data: [{ id: "speech/one", name: "First speech" }, { id: "speech/two", name: "Second speech" }] } })
  })
  await page.route("**/api/experimental/config", (route) => { voice = route.request().postDataJSON().voice; return route.fulfill({ status: 204 }) })
  await settings.getByRole("tab", { name: "Voice", exact: true }).click()
  await settings.getByRole("button", { name: "Load provider models" }).click()
  expect(request).toMatchObject({ provider: "openrouter", connection: { type: "credential", id: "cred_router" } })
  await expect(settings.getByRole("list", { name: "Available voice models" }).getByRole("listitem")).toHaveCount(2)
  await settings.getByLabel("Search available models").fill("second")
  await expect(settings.getByRole("list", { name: "Available voice models" }).getByRole("listitem")).toHaveCount(1)
  await settings.getByRole("button", { name: /Second speech/ }).click()
  await expect(settings.getByLabel("Transcription model", { exact: true })).toHaveValue("speech/two")
  await expect.poll(() => voice.model).toBe("speech/two")
  await settings.getByLabel("Transcription model", { exact: true }).fill("new/manual-model")
  await expect.poll(() => voice.model).toBe("new/manual-model")
})

test("voice settings add ElevenLabs and test the selected microphone and transcription", async ({ page }) => {
  const { settings } = await openSettings(page, { name: "VoiceSettingsTest", seed: { theme: { id: "oc-2", scheme: "dark" } } })
  let voice: unknown
  let uploaded = Buffer.alloc(0)
  let fail = false
  await page.route((url) => url.pathname === "/api/config", (route) => route.fulfill({ json: voice ? [{ type: "document", info: { voice } }] : [] }))
  await page.route((url) => url.pathname === "/api/voice/connections", (route) => route.request().method() === "POST"
    ? route.fulfill({ json: { data: { id: "cred_eleven", label: "ElevenLabs", integrationID: "redcode-voice" } } })
    : route.fulfill({ json: { data: [] } }))
  await page.route("**/api/experimental/config", (route) => { voice = route.request().postDataJSON().voice; return route.fulfill({ status: 204 }) })
  await page.route((url) => url.pathname === "/api/voice/transcribe", (route) => {
    uploaded = Buffer.from(route.request().postDataJSON().audio, "base64")
    if (fail) return route.fulfill({ status: 503, json: { _tag: "ServiceUnavailableError", message: "Dictation: POST https://api.elevenlabs.io/v1/speech-to-text — HTTP 403. Access denied; check key permissions and network policy." } })
    return route.fulfill({ json: { data: { text: "teste da ElevenLabs" } } })
  })
  await settings.getByRole("tab", { name: "Voice", exact: true }).click()
  const mic = settings.getByRole("combobox", { name: "Microphone", exact: true })
  const device = await mic.getByRole("option", { name: "Fake Audio Input 1" }).getAttribute("value")
  expect(device).toBeTruthy()
  await mic.selectOption(device!)
  await settings.getByLabel("Transcription provider").selectOption("elevenlabs")
  await settings.getByRole("button", { name: "Add ElevenLabs API key" }).click()
  await expect(settings.getByLabel("Connection name", { exact: true })).toHaveValue("ElevenLabs")
  await settings.getByLabel("Voice API key", { exact: true }).fill("test-key")
  const testPanel = settings.getByRole("region", { name: "Test microphone and transcription" })
  await expect(testPanel.getByRole("button", { name: "Record test" })).toBeDisabled()
  await settings.getByRole("button", { name: "Save voice settings" }).click()
  await expect(testPanel.getByRole("button", { name: "Record test" })).toBeEnabled()
  expect(voice).toMatchObject({ provider: "elevenlabs", connection: { type: "credential", id: "cred_eleven" } })
  const captured = await observeMicrophone(page)
  await testPanel.getByRole("button", { name: "Check microphone level" }).click()
  expect(await captured.device).toBe(device)
  await expect(testPanel.getByRole("button", { name: "Stop microphone check" })).toBeVisible()
  await expect(testPanel.getByRole("meter", { name: "Microphone level" }).locator("[data-audio-segment].bg-feedback-success-foreground").first()).toBeVisible()
  await testPanel.getByRole("button", { name: "Record test" }).click()
  await expect(testPanel.getByRole("button", { name: "Stop and transcribe test" })).toBeVisible()
  await page.waitForTimeout(1000)
  await testPanel.getByRole("button", { name: "Stop and transcribe test" }).click()
  await expect(testPanel.getByText("teste da ElevenLabs")).toBeVisible()
  expect(uploaded.toString("ascii", 0, 4)).toBe("RIFF")
  fail = true
  await testPanel.getByRole("button", { name: "Record test" }).click()
  await expect(testPanel.getByRole("button", { name: "Stop and transcribe test" })).toBeVisible()
  await page.waitForTimeout(500)
  await testPanel.getByRole("button", { name: "Stop and transcribe test" }).click()
  await expect(testPanel.getByRole("alert")).toBeVisible()
  await expect(testPanel).toContainText("HTTP 403")
  await expect(testPanel).toContainText("api.elevenlabs.io/v1/speech-to-text")
  await expect(testPanel.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0)
  await expect(testPanel.getByRole("button", { name: "Stop and transcribe test" })).toHaveCount(0)
  fail = false
  await testPanel.getByRole("button", { name: "Retry" }).click()
  await expect(testPanel.getByText("teste da ElevenLabs")).toBeVisible()
})

test("voice settings test uses the saved realtime mode", async ({ page }) => {
  const frames: { commit?: boolean }[] = []
  await page.routeWebSocket("ws://127.0.0.1:65534/**", (socket) => {
    socket.send(JSON.stringify({ message_type: "session_started" }))
    socket.onMessage((value) => {
      const frame = JSON.parse(String(value))
      frames.push(frame)
      socket.send(JSON.stringify(frame.commit
        ? { message_type: "committed_transcript", text: "transcrição em tempo real" }
        : { message_type: "partial_transcript", text: "transcrição parcial" }))
    })
  })
  const { settings } = await openSettings(page, { name: "VoiceSettingsRealtime" })
  await page.route((url) => url.pathname === "/api/config", (route) => route.fulfill({ json: [{ type: "document", info: { voice: {
    provider: "elevenlabs", model: "scribe_v2", mode: "realtime", connection: { type: "credential", id: "cred_eleven" },
  } } }] }))
  await page.route((url) => url.pathname === "/api/voice/connections", (route) => route.fulfill({ json: { data: [
    { id: "cred_eleven", label: "ElevenLabs", integrationID: "redcode-voice" },
  ] } }))
  await page.route((url) => url.pathname === "/api/voice/realtime", (route) => route.fulfill({ json: {
    data: { token: "temporary-test-token", url: "ws://127.0.0.1:65534/voice" },
  } }))
  await settings.getByRole("tab", { name: "Voice", exact: true }).click()
  const panel = settings.getByRole("region", { name: "Test microphone and transcription" })
  await panel.getByRole("button", { name: "Record test" }).click()
  await expect(panel.getByText("transcrição parcial")).toBeVisible()
  await panel.getByRole("button", { name: "Stop and transcribe test" }).click()
  await expect(panel.getByText("transcrição em tempo real")).toBeVisible()
  expect(frames.some((frame) => frame.commit)).toBe(true)
})

test("realtime dictation shows partial speech and inserts only the final transcript", async ({ page }) => {
  const frames: { audio_base_64: string; sample_rate: number; commit?: boolean }[] = []
  await page.routeWebSocket("ws://127.0.0.1:65534/**", (socket) => {
    socket.send(JSON.stringify({ message_type: "session_started" }))
    socket.onMessage((value) => {
      const frame = JSON.parse(String(value))
      frames.push(frame)
      socket.send(JSON.stringify(frame.commit
        ? { message_type: "committed_transcript", text: "teste por voz" }
        : { message_type: "partial_transcript", text: "teste parcial" }))
    })
  })
  const prompts: string[] = []
  const { editor } = await openDraft(page, { name: "VoiceRealtime", onPrompt: ({ sessionID }) => prompts.push(sessionID) })
  await page.route((url) => url.pathname === "/api/config", (route) => route.fulfill({ json: [
    { type: "document", info: { voice: { provider: "elevenlabs", model: "scribe_v2", mode: "realtime" } } },
  ] }))
  await page.route((url) => url.pathname === "/api/voice/realtime", (route) => route.fulfill({ json: {
    data: { token: "temporary-test-token", url: "ws://127.0.0.1:65534/voice" },
  } }))
  await editor.fill("Pedido:")
  await page.getByRole("button", { name: "Record voice", exact: true }).click()
  await expect(page.getByText("teste parcial", { exact: true })).toBeVisible()
  await expect(editor).toHaveText("Pedido:")
  await page.getByRole("button", { name: "Stop and transcribe", exact: true }).click()
  await expect(editor).toHaveText("Pedido: teste por voz ")
  expect(frames.some((frame) => !frame.commit && frame.sample_rate === 16000 && frame.audio_base_64.length > 0)).toBe(true)
  expect(prompts).toEqual([])
})

test("composer voice input cancels a recording without transcribing or changing the draft", async ({ page }) => {
  const { editor } = await openDraft(page, { name: "VoiceCancel" })
  let transcriptions = 0
  await page.route((url) => url.pathname === "/api/config", (route) => route.fulfill({ json: [{ type: "document", info: { voice: {
    provider: "openai", model: "gpt-4o-mini-transcribe", connection: { type: "credential", id: "cred_voice" },
  } } }] }))
  await page.route((url) => url.pathname === "/api/voice/transcribe", (route) => { transcriptions++; return route.fulfill({ json: { data: { text: "unexpected" } } }) })
  await editor.fill("Pedido original")
  await page.getByRole("button", { name: "Record voice", exact: true }).click()
  await expect(page.getByRole("button", { name: "Stop and transcribe", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Cancel recording", exact: true }).click()
  await expect(page.getByRole("button", { name: "Record voice", exact: true })).toHaveAttribute("aria-pressed", "false")
  await expect(editor).toHaveText("Pedido original")
  expect(transcriptions).toBe(0)
})

test("voice settings explicitly select a connection and microphone capture only edits the draft", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const prompts: string[] = []
  const { editor } = await openDraft(page, { name: "VoiceDraft", seed: { theme: { id: "oc-2", scheme: "dark" } }, onPrompt: ({ sessionID }) => prompts.push(sessionID) })
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
  await expect(page.getByRole("button", { name: "Voice settings", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Record voice", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Microphone or voice settings unavailable." })).toBeVisible()
  await expect(page.getByRole("dialog", { name: "Voice settings", exact: true })).toHaveCount(0)
  await expect(editor).toHaveText("Pedido:")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const screen = page.getByTestId("settings-screen")
  await screen.getByRole("tab", { name: "Voice", exact: true }).click()
  const settings = screen
  const microphone = settings.getByRole("combobox", { name: "Microphone", exact: true })
  const input = microphone.getByRole("option", { name: "Fake Audio Input 1" })
  await expect(input).toBeAttached()
  const device = await input.getAttribute("value")
  expect(device).toBeTruthy()
  await microphone.selectOption(device!)
  await expect(settings.getByRole("button", { name: "Save voice settings" })).toBeDisabled()
  await settings.getByLabel("Saved API key connection").selectOption("cred_voice")
  await settings.getByText("Advanced settings", { exact: true }).click()
  await expect(settings.getByLabel("Endpoint URL (optional for built-in providers)")).toBeVisible()
  await expect(settings.getByLabel("Language code (empty for automatic detection)")).toBeVisible()
  await page.screenshot({ path: "../../tmp/voice-settings.png" })
  await settings.getByRole("button", { name: "Save voice settings" }).click()
  await expect(page.getByText("Voice settings saved", { exact: true })).toBeVisible()
  expect(voice).toEqual({
    provider: "openai",
    model: "gpt-4o-mini-transcribe",
    connection: { type: "credential", id: "cred_voice" },
  })
  await screen.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(editor).toBeEditable()
  await expect(editor).toHaveText("Pedido:")
  await editor.click()
  await editor.press("End")
  const captured = await observeMicrophone(page)
  await page.getByRole("button", { name: "Record voice", exact: true }).click()
  const stop = page.getByRole("button", { name: "Stop and transcribe", exact: true })
  await expect(stop).toBeVisible()
  expect(await captured.device).toBe(device)
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
  await screen.getByRole("tab", { name: "Voice", exact: true }).click()
  await expect(settings.getByRole("combobox", { name: "Microphone", exact: true })).toHaveValue(device!)
  await expect(settings.getByLabel("Saved API key connection")).toHaveValue("cred_voice")
  await settings.getByLabel("Saved API key connection").selectOption("new")
  await settings.getByLabel("Connection name", { exact: true }).fill("My dictation")
  await settings.getByLabel("Voice API key", { exact: true }).fill("fixture-private-key")
  await expect(settings.getByLabel("Voice API key", { exact: true })).toHaveAttribute("type", "password")
  await settings.getByText("Advanced settings", { exact: true }).click()
  await settings.getByLabel("Language code (empty for automatic detection)").fill("pt")
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/experimental/config")
  await settings.getByRole("button", { name: "Save voice settings" }).click()
  expect((await saved).status()).toBe(204)
  await expect(settings.getByLabel("Saved API key connection")).toHaveValue("cred_new_voice")
  expect(added).toEqual([{ label: "My dictation", key: "fixture-private-key" }])
  expect(voice).toMatchObject({ connection: { type: "credential", id: "cred_new_voice" }, language: "pt" })
  await expect(settings.getByLabel("Saved API key connection")).toHaveValue("cred_new_voice")
  await expect(settings.getByLabel("Language code (empty for automatic detection)")).toHaveValue("pt")
  await settings.getByLabel("Transcription provider").selectOption("elevenlabs")
  await expect(settings.getByLabel("Transcription model")).toHaveValue("scribe_v2")
  await settings.getByLabel("Saved API key connection").selectOption("cred_new_voice")
  const scribeSaved = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/experimental/config",
  )
  await settings.getByRole("button", { name: "Save voice settings" }).click()
  expect((await scribeSaved).status()).toBe(204)
  expect(voice).toMatchObject({
    provider: "elevenlabs",
    model: "scribe_v2",
    connection: { type: "credential", id: "cred_new_voice" },
    language: "pt",
  })
  expect(errors).toEqual([])
})

for (const failure of ["unsupported", "content-type", "configuration"] as const) {
  test(`voice settings contain ${failure} failures and can retry without leaving Settings`, async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    const { settings: screen } = await openSettings(page, { name: "VoiceFailure" })
    const broken = { value: true }
    await page.route(
      (url) => url.pathname === "/api/voice/connections",
      (route) =>
        broken.value && failure !== "configuration"
          ? route.fulfill({
              status: failure === "unsupported" ? 404 : 200,
              contentType: "text/plain",
              body: "Voice unavailable",
            })
          : route.fulfill({ json: { data: [] } }),
    )
    if (failure === "configuration") {
      await page.route(
        (url) => url.pathname === "/api/config",
        (route) =>
          broken.value
            ? route.fulfill({
                status: 500,
                json: { _tag: "UnknownError", message: "Invalid configuration at /example/config.jsonc" },
              })
            : route.fulfill({ json: [] }),
      )
    }
    await screen.getByRole("tab", { name: "Voice", exact: true }).click()
    await expect(screen.getByRole("alert")).toContainText(
      failure === "unsupported"
        ? "This server does not support voice settings. Update the server to use dictation."
        : "Could not load voice settings.",
    )
    if (failure === "configuration")
      await expect(screen.getByRole("alert")).toContainText("Invalid configuration at /example/config.jsonc")
    await expect(screen.getByRole("combobox", { name: "Microphone", exact: true })).toBeEnabled()
    await expect(screen.getByRole("button", { name: "Save voice settings", exact: true })).toBeDisabled()
    broken.value = false
    await screen.getByRole("button", { name: "Try again", exact: true }).click()
    await expect(screen.getByLabel("Saved API key connection")).toBeEnabled()
    await expect(screen.getByRole("alert")).toHaveCount(0)
    await screen.getByRole("button", { name: "Back to app", exact: true }).click()
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeEnabled()
    expect(errors).toEqual([])
  })
}

test("voice settings follow the current server and let the user choose another", async ({ page }) => {
  const remote = session({ id: "ses_voice_remote", title: "Remote voice session", directory: "/remote/project" })
  await mockServers(page, {
    [SERVER]: {
      directory: "/local/project",
      project: project({ id: "proj_voice_local", directory: "/local/project" }),
      provider: NO_PROVIDER,
      sessions: [],
      pageMessages: () => ({ items: [] }),
    },
    [REMOTE_SERVER]: {
      directory: "/remote/project",
      project: project({ id: "proj_voice_remote", directory: "/remote/project" }),
      provider: NO_PROVIDER,
      sessions: [remote],
      pageMessages: () => ({ items: [] }),
    },
  })
  await seed(page, { servers: [REMOTE_SERVER], tabs: [{ session: remote.id, server: REMOTE_SERVER }] })
  const writes: string[] = []
  await page.route(
    (url) => url.pathname === "/api/config",
    (route) => {
      const origin = new URL(route.request().url()).origin
      return route.fulfill({
        json: [
          {
            type: "document",
            info: {
              voice: {
                provider: "openai-compatible",
                model: origin === REMOTE_SERVER ? "remote-model" : "local-model",
                baseURL: "https://voice.example/v1",
              },
            },
          },
        ],
      })
    },
  )
  await page.route(
    (url) => url.pathname === "/api/voice/connections",
    (route) => route.fulfill({ json: { data: [] } }),
  )
  await page.route(
    (url) => url.pathname === "/api/experimental/config",
    (route) => {
      writes.push(new URL(route.request().url()).origin)
      return route.fulfill({ status: 204 })
    },
  )
  await page.goto(sessionHref(remote.id, REMOTE_SERVER))
  await expectSessionTitle(page, remote.title)
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Voice", exact: true }).click()
  const server = settings.getByRole("combobox", { name: "Server", exact: true })
  const model = settings.getByRole("textbox", { name: "Transcription model", exact: true })
  await expect(server).toHaveValue(REMOTE_SERVER)
  await expect(model).toHaveValue("remote-model")
  await server.selectOption(SERVER)
  await expect(model).toHaveValue("local-model")
  await settings.getByRole("button", { name: "Save voice settings", exact: true }).click()
  await expect.poll(() => writes).toEqual([SERVER])
})
