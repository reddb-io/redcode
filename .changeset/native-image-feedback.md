---
"@reddb-io/redcode": patch
---

Fix image import and resizing in compiled binaries by matching the embedded Photon WASM loader contract. Report decoder failures clearly, and let whiteboard feedback retry a failed image upload without losing the annotation or leaving the queue button disabled.
