---
"@reddb-io/redcode": patch
---

Capture the approval screenshot of real-sized Design prototypes. The capture cloned every element of the document, hidden screens and variants included, with every computed style, and gave up after 8 seconds, so a prototype with a few thousand elements always ended with "Preview screenshot unavailable". It now skips what is not rendered and writes only the styles that differ from the browser defaults, which produces the same image several times faster, and waits up to 20 seconds.

A variant root without a box of its own (`display: contents`, a shell of fixed-position children) is recognised as the variant on screen, and a prototype that defines `module` or `exports` globals no longer keeps the capture runtime from loading. When a capture still fails, the notice states the reason.
