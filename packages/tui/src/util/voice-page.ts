import { VoiceRecorder, voiceAudioBase64 } from "@opencode/util/voice-recorder"
import { createVoiceInput } from "@opencode/util/voice-input"

/** Self-contained so compiled CLI builds need neither a web bundle nor network-hosted assets. */
export function voicePage() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Redcode · Voice input</title><style>
:root{color-scheme:dark;font:13px/20px system-ui;background:#111215;color:#eee}body{max-width:560px;margin:8vh auto;padding:24px}h1{font-size:20px;font-weight:550}p{color:#aaa}button,textarea,select{font:inherit;color:inherit;background:#202228;border:1px solid #45464e;border-radius:8px;padding:8px 12px}button{cursor:pointer}button:disabled{opacity:.4;cursor:default}textarea{box-sizing:border-box;width:100%;height:180px;margin:20px 0;resize:vertical}nav{display:flex;gap:8px;flex-wrap:wrap}meter{width:100%;height:4px;margin:12px 0}#status{min-height:24px}select{max-width:100%;margin-bottom:16px}.primary{background:#d71d4b;border-color:#d71d4b}small{color:#aaa}</style>
<h1>Voice input</h1><p>Record on this device. Your Redcode server transcribes with your selected provider. Review the text before adding it to your draft.</p>
<label>Microphone <select id="device"><option value="">System default</option></select></label>
<div id="status" role="status">Ready · up to five minutes</div><meter id="level" min="0" max="1" value="0" aria-label="Microphone level"></meter>
<nav><button id="record" class="primary">Record</button><button id="stop" disabled>Stop and transcribe</button><button id="retry" hidden>Retry transcription</button><button id="cancel">Cancel</button></nav>
<label>Transcript<textarea id="text" placeholder="Your transcript will appear here"></textarea></label>
<nav><button id="accept" disabled>Add to draft</button><button id="copy">Copy text</button></nav><p><small>Nothing is submitted to the coding agent. Keep this page open until the transcript is accepted.</small></p>
<script>(${voicePageClient.toString()})(${VoiceRecorder.toString()},${createVoiceInput.toString()},${voiceAudioBase64.toString()});</script></html>`
}

function voicePageClient(
  Recorder: typeof VoiceRecorder,
  createInput: typeof createVoiceInput,
  encodeAudio: typeof voiceAudioBase64,
) {
  const token = location.hash.slice(1)
  history.replaceState(null, "", location.pathname)
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const text = element<HTMLTextAreaElement>("text")
  const record = element<HTMLButtonElement>("record")
  const stop = element<HTMLButtonElement>("stop")
  const retry = element<HTMLButtonElement>("retry")
  const accept = element<HTMLButtonElement>("accept")
  const device = element<HTMLSelectElement>("device")
  const status = element("status")
  const request = async (route: string, body?: string, signal?: AbortSignal) => {
    const response = await fetch(route, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
      signal,
    })
    if (!response.ok) throw new Error(String(response.status))
    return response.json() as Promise<{ text?: string }>
  }
  const voice = createInput({
    recorder: () => new Recorder(),
    read: () => ({ owner: "cli", revision: text.value }),
    prepare: async () => undefined,
    transcribe: async (audio, signal) =>
      (await request("/transcribe", JSON.stringify({ audio: await encodeAudio(audio) }), signal)).text ?? "",
    insert: (value) => {
      text.value = value
      accept.disabled = false
    },
    change: (state) => {
      record.disabled = ["preparing", "recording", "transcribing"].includes(state.phase)
      stop.disabled = state.phase !== "recording"
      device.disabled = record.disabled
      retry.hidden = !state.retry
      accept.disabled = record.disabled || !text.value.trim()
      element<HTMLMeterElement>("level").value = state.level
      const errors = {
        permission: "Microphone access denied. Allow it in browser and system settings.",
        unavailable: "Microphone unavailable. Use a browser with microphone support.",
        capture: "Could not record audio. Check the microphone.",
        transcription: "Transcription failed. Check your Redcode voice settings, then retry.",
        changed: "The draft changed. Copy the recovered transcript below.",
        empty: "No speech detected. Record again.",
      }
      status.textContent = state.error
        ? errors[state.error]
        : state.phase === "recording"
          ? `Recording · ${state.seconds}s`
          : state.phase === "transcribing"
            ? "Transcribing…"
            : state.phase === "preparing"
              ? "Preparing microphone…"
              : "Ready · up to five minutes"
      if (state.transcript) {
        text.value = state.transcript
        accept.disabled = false
      }
      if (state.phase === "recording") void devices()
    },
  })
  let listed = false
  const devices = async () => {
    if (listed) return
    listed = true
    const entries = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    entries
      .filter((entry) => entry.kind === "audioinput" && entry.deviceId !== "default" && !!entry.label)
      .forEach((entry) => device.add(new Option(entry.label, entry.deviceId)))
  }
  record.onclick = () => {
    void voice.start(device.value || undefined)
  }
  stop.onclick = () => {
    void voice.finish()
  }
  retry.onclick = () => {
    void voice.retry()
  }
  element("cancel").onclick = () => {
    voice.cancel()
    void request("/cancel")
      .then(() => {
        status.textContent = "Cancelled. You can close this page."
        record.disabled = true
        stop.disabled = true
        accept.disabled = true
      })
      .catch(() => undefined)
  }
  text.oninput = () => {
    accept.disabled = voice.busy || !text.value.trim()
  }
  accept.onclick = () => {
    accept.disabled = true
    void request("/accept", JSON.stringify({ text: text.value }))
      .then(() => {
        status.textContent = "Transcript added. Return to Redcode; you can close this page."
        record.disabled = true
      })
      .catch(() => {
        status.textContent = "The Redcode draft changed or closed. Copy your text to keep it."
        accept.disabled = false
      })
  }
  element("copy").onclick = () => {
    void navigator.clipboard.writeText(text.value).catch(() => {
      status.textContent = "Select and copy the transcript manually."
    })
  }
  window.addEventListener("pagehide", () => voice.cancel())
}
