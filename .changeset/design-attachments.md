---
"@reddb-io/redcode": minor
"@reddb-io/redcode-core": minor
---

Design mode: real image attachments, a self-paint check, and Tailwind, DaisyUI and Mermaid shipped for prototypes

Images attached to a note — from the composer or from the card on an element — are uploaded to a content-addressed store under the data directory (owner-only files, magic bytes decide the type, PNG/JPEG/WebP only), and reach the agent as files on disk. Limits are configurable under `experimental.design.attachments`: 10 MiB per image, 4 per note, 25 MiB per note, a 7-day TTL and a 512 MiB quota swept hourly without ever touching an image a turn may still be reading. A send whose images cannot be honoured is refused whole, and the page says which cap was hit. `design_preview` adds a note when a page never paints its own surface, since text styled for an assumed dark or light host can be invisible. Prototypes have no network, so redcode now serves Tailwind's browser runtime, DaisyUI (with its themes) and Mermaid at `/design/vendor/`, and the prompt states the design-direction rule: what the user asked for, then the project's own design system, then these.
