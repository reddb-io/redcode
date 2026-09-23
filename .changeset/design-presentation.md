---
"@reddb-io/redcode": minor
---

Presentation designs are real decks: every `<section class="slide">` becomes a 1920×1080 slide, scaled to fit the review with a thumbnail strip, a slide counter and keyboard navigation (arrows, Space, Page Up/Down, Home, End), and review notes stay anchored to their slide. A Present button opens the deck in a full-screen window and a presenter view with the current and next slide, the speaker notes from `<aside class="notes">` and a timer, kept on the same slide over a BroadcastChannel. `design_export` gains a `pdf` format that prints one 1920×1080 page per slide without notes, the audit checks every slide for overflowing content and text under 24px, and the slides playbook is rewritten for the new runtime.
