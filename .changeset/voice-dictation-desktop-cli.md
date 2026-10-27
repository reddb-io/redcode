---
"@reddb-io/redcode": patch
---

Add microphone dictation to the Desktop composer and a local browser recorder for the CLI/TUI. Configure the transcription provider, model, language, endpoint and saved or new API key in Desktop server settings, beside the microphone, through `/voice-settings` in the TUI, or with `redcode voice --setup`. Support OpenAI-compatible local endpoints. Recording shows microphone levels, supports cancellation and transcription retry, and inserts editable text without submitting a prompt. Keep late transcripts recoverable when a draft changes, restrict desktop media permission to audio in the app renderer, and preserve explicit credential selection without environment fallback or coding-account changes.
