# Voice input

## Desktop and web

Open **Settings → Server → Voice settings** for the selected server.
Choose OpenAI, ElevenLabs, Deepgram, or an OpenAI-compatible endpoint, then explicitly select a saved API-key connection and transcription
model. A local compatible endpoint can be used without a key. The endpoint field is a base URL,
such as `http://127.0.0.1:8080/v1`; Redcode appends the protocol's transcription path.

Choose **Add a voice API key…** to save a new named key without leaving the app. Keys are masked
while entering them, and a dedicated voice connection does not change the selected coding account.

Click the microphone, speak, then **Stop and transcribe**. `Ctrl+Shift+M` (`Cmd+Shift+M` on macOS)
also starts or stops recording. The small level meter reflects the microphone's actual signal.
Recording stops at five minutes. Cancel discards the current capture; a failed transcription can
be retried without recording again. A changed draft keeps its existing text and offers the recovered
transcript for copying. Navigation closes the recording. Text is inserted at the captured caret and
stays editable: dictation never sends a prompt or starts agent execution.

Capture uses the client machine's microphone even when the coding server is remote. The server
receives a 16 kHz mono PCM WAV and transcribes with the configured provider. Raw audio stays in
memory for the recording or retry and is released on success, cancellation, or composer disposal.
Redcode does not write a recording archive. Provider-side retention follows that provider's policy.
Browser microphone permission requires a secure context: HTTPS or loopback HTTP. Electron permits
audio capture only in its top-level app renderer; camera and embedded-content capture remain denied.

Voice configuration belongs to the selected server and is shared by its clients. Audio-device
permission belongs to the local client. A coding-model subscription or Claude/Codex sign-in is not
automatically a transcription API connection. Saved credentials and their active account selection
are preserved. Ambient environment keys are never used without an authored connection reference.

## CLI and TUI

```sh
redcode voice --setup    # select provider, saved connection, model, endpoint and language
redcode voice            # record locally, review, then print the accepted transcript to stdout
redcode voice --no-open  # print the recorder URL to stderr for manual opening
```

In the interactive TUI, use `/voice` or the default `<leader>v` binding (`Ctrl+X`, then `V`).
Use `/voice-settings` to configure the provider, saved or new API key, model, endpoint and language
inside the TUI. An unconfigured `/voice` opens that menu automatically. New keys use masked input.
Review the browser transcript and choose **Add to draft**. The result goes directly to the original
composer. A changed draft, session, directory or input mode rejects delivery and leaves the text in
the recorder for copying. There is no simulated typing, clipboard replacement or automatic submit.

This first CLI recorder uses a browser companion rather than native terminal microphone capture.
The loopback bridge is single-use, expires after ten minutes, and requires both a random capability
and its own browser origin. The browser receives no coding-server credentials. Cancellation aborts
in-flight transcription and closes the bridge. Running the CLI itself over SSH requires forwarding
its printed loopback port; running a local CLI against `--server` records on the local machine.

For an explicitly authored configuration, the equivalent settings are:

```jsonc
{
  "voice": {
    "provider": "openai-compatible",
    "model": "whisper-1",
    "baseURL": "http://127.0.0.1:8080/v1",
    "language": "pt",
  },
}
```

Cloud providers require `connection: { "type": "credential", "id": "<saved credential id>" }`.
An explicitly declared environment binding, such as
`connection: { "type": "env", "name": "MY_TRANSCRIPTION_KEY" }`, is also supported. Redcode never
chooses that binding merely because an environment variable exists.

## External dictation clients

The TUI exposes a local, process-scoped sink for structured dictation. A compatible client can send `start`, `partial`, `commit`, `finish` and `cancel` events to the active composer. `partial` text is replaceable, committed segments accumulate, and `finish` leaves the result as an editable draft. Voice input never calls `Session.prompt` or submits the composer.

On Unix, each TUI registers a Unix socket under `$XDG_RUNTIME_DIR/redcode-<uid>/voice-input/`, falling back to `/tmp` when no runtime directory is available. The containing directory is mode `0700`; the registry and socket are mode `0600`. The registry carries a random capability required on every event, the TUI PID, terminal path and optional zellij session and pane identifiers. The registry and socket are removed when the TUI exits. Stale registrations are ignored by clients when their process no longer exists.

Compatible clients should select a sink only when they can associate exactly one TUI with the focused terminal process tree or focused zellij session. After a sink accepts `start`, delivery must remain pinned to it for the recording; a later failure must not inject the remaining text into another focused application. The inspected [dit](https://github.com/reddb-io/dit/tree/7988f735459889873605d4b68107837f2bfe8501) revision still uses its keyboard, clipboard and zellij routes; a structured-sink adapter is separate work.

Windows currently keeps dit's existing input injection behavior. A named-pipe transport can implement the same event contract later.

See [the source comparison and follow-up opportunities](evaluations/voice-input.md) for the T3 Code,
OpenCode and dit study behind this implementation.
