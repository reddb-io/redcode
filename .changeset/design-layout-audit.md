---
"@reddb-io/redcode": minor
"@reddb-io/redcode-core": minor
---

Design mode: a passive layout audit with an inbox the person triages

The prototype now audits its own layout after fonts, geometry and finite animations settle: text clipped by its container, controls cut off or outside the viewport, text off-screen, a page that scrolls sideways, text covered by an opaque sibling. Findings survive only if two samples agree, and every pass reports its own completeness. They land in a "Layout issues" inbox on the review page — badge, drawer, select, queue, dismiss, reveal — and nothing in it reaches the agent until the person queues it, when it becomes one ordinary note. A warning is cleared only by a complete pass on a newer revision that no longer finds it; a failed pass, a different viewport or a reload in flight never clears anything, and a dismissal lasts one revision. Every frame load is named by a token so a pass from a replaced frame is discarded. The page holds the prototype behind a short curtain until its first pass (`experimental.design.gate`, `gate_timeout`, or `?gate=0` for one tab), asks the server whether the document can be served when the frame stays silent, and the one report that does wake the agent unasked is a prototype that cannot be shown at all (`<artifact-failures>`). Viewport classes can be narrowed with `experimental.design.viewports`; a class left out has its warnings marked obsolete rather than resolved.
