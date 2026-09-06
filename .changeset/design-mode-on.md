---
"@reddb-io/redcode": minor
---

Design mode is on by default, and `design_export` is available to the design agent

The `REDCODE_EXPERIMENTAL_DESIGN_MODE` flag is gone: the `design` agent's tools — `design_preview`, `design_playbook`, `design_export`, `design_exit` — are always there, and the mode's system prompt is added whenever the design agent runs. The README gains a tutorial for the whole loop: starting, reviewing (annotations, images, live reload, layout issues, whiteboards, export, another device), finishing, the files it leaves, and the settings.
