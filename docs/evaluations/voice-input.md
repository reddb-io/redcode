# Voice input: T3 Code, OpenCode and dit

Source review on 2026-10-27. These are snapshots of public code, not claims about unreleased or private builds.
The attached Theo transcript mentions a speech-to-text button, but does not identify its implementation.

| Project                                                                                         | Inspected revision | What the source implements                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [T3 Code](https://github.com/pingdotgg/t3code/tree/e9236274a3a6e0c731a7df4092db1e686f039068)    | `e9236274`         | Shared recording/draft controller and mobile voice UI; native local iOS transcription. Desktop/web accommodate externally injected dictation.        |
| [OpenCode](https://github.com/anomalyco/opencode/tree/d78b817631258f47926d594593a369ee03a61871) | `d78b8176`         | Desktop/web voice calls using WebRTC, live input/output captions, microphone levels, muting and delegation to coding sessions.                       |
| [dit](https://github.com/reddb-io/dit/tree/7988f735459889873605d4b68107837f2bfe8501)            | `7988f735`         | Global toggle/hold dictation, native CPAL capture, ElevenLabs streaming and optional local Whisper, file transcription and focus-dependent delivery. |

## What T3 gets right

The [shared controller](https://github.com/pingdotgg/t3code/blob/e9236274a3a6e0c731a7df4092db1e686f039068/packages/client-runtime/src/voice-input/controller.ts)
treats voice as a complete interaction: idle, preparing, recording, transcribing and recoverable errors.
It caps recording at five minutes, blocks prompt submission while voice work is pending, and binds
the recording to a draft owner, text, selection and revision. A late result cannot silently overwrite
a different draft. It releases microphone ownership before transcribing, serializes native work,
and handles cooperative cancellation without letting late preparation start another capture.

The [iOS transcriber](https://github.com/pingdotgg/t3code/blob/e9236274a3a6e0c731a7df4092db1e686f039068/apps/mobile/src/native/voiceTranscription.ios.ts)
prepares a supported locale and uses Apple's on-device transcription on supported iOS 26 devices.
That implementation cannot be copied into Electron or the terminal: its recorder and native backend
are mobile APIs. The inspected Desktop/web code contains no equivalent microphone dictation flow.
Its editor does, however, restore selection immediately before fast dictation paste and repair modifier
state left behind by external dictation tools. The video alone does not prove a native T3 Desktop recorder.

Redcode adopts the lifecycle, cancellation, five-minute cap, microphone release, submission blocking,
draft ownership and recovery principles. Its browser capture can run inside Electron or in a local
CLI companion, while transcription uses the provider explicitly configured on the coding server.

## OpenCode solves a broader problem

The [transport](https://github.com/anomalyco/opencode/blob/d78b817631258f47926d594593a369ee03a61871/packages/app/src/voice/transport.ts)
negotiates a WebRTC session and data channel, acquires audio with echo cancellation, noise suppression
and automatic gain control, and samples actual audio levels with Web Audio. Its cleanup stops local
tracks, detaches playback, closes the peer and audio context, and bounds graceful shutdown.

The [call controller](https://github.com/anomalyco/opencode/blob/d78b817631258f47926d594593a369ee03a61871/packages/app/src/voice/call.ts)
also handles spoken responses, live captions and tool delegation to coding sessions. That is a useful
future voice-conversation mode, with different latency, cost, interruption and authorization behavior
from dictation into an editable draft. It should be a separate product control.

The inspected [server source selection](https://github.com/anomalyco/opencode/blob/d78b817631258f47926d594593a369ee03a61871/packages/core/src/voice.ts)
can choose environment connections and fall back to hosted voice. Redcode deliberately does not adopt
that selection policy. Its existing AI transcription adapters also have environment fallback in their
default auth chains, so dictation supplies an explicit auth definition, including no auth for a keyless
local endpoint. A transcription connection does not change the chosen Claude/Codex coding harness.

## What dit contributes, and where the integration is missing

[CPAL capture](https://github.com/reddb-io/dit/blob/7988f735459889873605d4b68107837f2bfe8501/src/audio.rs)
already provides a cross-platform native foundation. It ranks usable input devices, converts capture
to mono, retries device failures and bounds the realtime frame queue to avoid unbounded latency.
The transcription layer supports ElevenLabs partial/final events and offline Whisper; file transcription
decodes multiple audio formats. These capabilities should be reused if Redcode adds native CLI capture.

The inspected live path is coupled to an injector and a global hotkey/tray lifecycle. Focus-dependent
keyboard/clipboard delivery is a poor integration boundary for an agent composer: focus can change,
partial text is difficult to replace, and simulated input is harder to acknowledge. Redcode's existing
Unix structured sink is a receiving contract; the inspected dit revision does not contain its sender.
Windows has no corresponding named-pipe sink yet. Documentation previously described that sender as
implemented; the product guide now distinguishes the available sink from that outstanding adapter.

The new Redcode path neither launches nor reconfigures dit and does not claim to replace its global F9.
It avoids native recording binaries in this first CLI implementation by opening a local browser recorder.
The browser companion is an explicit limitation, not native terminal capture.

## Next improvements worth measuring

1. **Streaming dictation:** stable committed segments plus replaceable partial text, using the same draft
   ownership and cancellation rules. Measure stop-to-editable-text latency for Portuguese and mixed code
   vocabulary before choosing batch, streaming or a hybrid. Current Redcode dictation is batch.
2. **Native CLI recording through dit:** a headless, versioned control/event protocol for capture,
   levels, partial/final transcripts, stop and cancel, without tray, clipboard or synthetic keystrokes.
   Keep keys in the user's selected Redcode connection and make native microphone ownership explicit.
3. **Device selection and diagnostics:** client-local microphone preference, real no-signal feedback,
   hot-unplug handling and Bluetooth profile checks. Do not save a local device ID as a remote server setting.
4. **Coding vocabulary:** explicitly configured project terms, filenames and identifiers as provider hints.
   Evaluate recognition of paths, punctuation, accents and Portuguese/English switching with consented fixtures.
5. **Continuous voice conversation:** borrow OpenCode's call lifecycle, captions, mute and delegation
   concepts as a separate mode. Keep spoken commentary distinct from instructions admitted to agent execution.

Capture and permission behavior follows the browser's [getUserMedia contract](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
the final [MediaRecorder stop/data lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/stop),
and Electron's [media permission handlers](https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler).
Implementation validation uses synthetic microphone input and local fixture providers; real-device audio
quality, cloud latency and provider billing have not been measured in this change.
