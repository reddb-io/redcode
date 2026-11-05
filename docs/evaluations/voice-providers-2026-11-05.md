# Voice providers and dictation

Assessment on 5 November 2026: [Dit `7988f735`](https://github.com/reddb-io/dit/tree/7988f735459889873605d4b68107837f2bfe8501), [T3 Code `337c5858`](https://github.com/pingdotgg/t3code/tree/337c5858c33bc7f8f6dfd391a2c279fa0f7e4d17), and the OpenCode `dev` voice service. Code inspection is not an actual microphone or paid-provider test.

Redcode already configures OpenAI, ElevenLabs, Deepgram and an OpenAI-compatible transcription endpoint under Voice settings. A key is explicitly selected or saved for the server. Desktop and the TUI browser recorder use the same capture and server transcription: local audio is converted to 16 kHz mono WAV, submitted after stopping, and inserted into the original draft only if it has not changed. Failed transcription can be retried without recording again. This is batch dictation, not live streaming. ElevenLabs defaults to `scribe_v2`; its request now explicitly disables sound-event annotations intended for captions.

Dit uses CPAL native capture and an ElevenLabs WebSocket streaming engine. It emits committed segments while receiving partials, flushes the tail on stop, uses bounded audio buffering and recovers uncommitted text. It also has an optional local engine. The different runtime and desktop-wide text injection are not drop-in replacements for the session-owned Redcode composer.

At the inspected T3 Code revision, its [voice input documentation](https://github.com/pingdotgg/t3code/blob/337c5858c33bc7f8f6dfd391a2c279fa0f7e4d17/docs/internals/voice-input.md) describes a shared draft-bound controller and local transcription on supported iOS devices. It requires cancelled work to settle before releasing its resources. The repository also has mobile native bindings; this inspection does not establish that the desktop experience in the referenced video is implemented in this public revision.

OpenCode V2 also has a separate experimental realtime conversation architecture and provider transports. A realtime voice call and dictation are different experiences. Neither an existing Codex nor Claude coding login is assumed to grant transcription access; OpenAI transcription currently uses a separately configured API key, and Claude has no Redcode transcription adapter.

## Next streaming slice

For ElevenLabs realtime, keep API keys server-side and use the [single-use token flow](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming) or a server-mediated transport. Preserve ownership of a draft across session switches, show partial text separately from committed text, flush and deduplicate the final segment, bound queued audio and recover an unsent tail on disconnect. Support cancellation, concurrent sessions, reconnects, server changes and TUI/browser capture without automatically submitting a prompt. Make realtime an explicit mode with a batch fallback, and test the exact credential, endpoint and privacy behavior before claiming it works with a real provider. Do not transplant Dit's operating-system text injection into the session composer.
# Scribe em tempo real

O modo opcional de streaming da ElevenLabs abre uma conexão WebSocket diretamente do navegador (incluindo a janela do gravador do TUI) para o endpoint configurado. O servidor fornece apenas um token temporário de uso único; a chave salva não é entregue ao navegador. O áudio é enviado durante a gravação e o texto parcial aparece sem alterar o rascunho. Ao encerrar, os trechos confirmados são inseridos somente se a sessão e o rascunho ainda forem os mesmos.

O gravador mantém o áudio completo durante a captura. Se a conexão cair ou a confirmação final falhar, tenta a transcrição em lote pelo servidor, o que pode gerar uma segunda cobrança. Se essa tentativa também falhar, o texto recuperado pode ser copiado e o áudio pode ser reenviado enquanto o gravador permanecer aberto. A recuperação é em memória e não sobrevive ao reinício do aplicativo. O modo padrão continua sendo lote.

