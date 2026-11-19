---
"@reddb-io/redcode": patch
---

Let a Design deck or prototype run live JavaScript: once the user approves, its own code can use the microphone and connect to the https and wss services it names, in the review and while presenting. The design's frame stays sandboxed: the trusted page captures the microphone and hands the frame its audio, so getUserMedia, MediaRecorder and Web Audio work unchanged. Permission prompts now show what an open request or a live grant reaches.
