---
"@reddb-io/redcode": minor
---

Design mode reviews like lavish: annotate or explore, text ranges, table cells, Mermaid nodes

The review client is now the lavish-axi loop, natively. Annotate mode is on by default (Cmd/Ctrl+I toggles explore; alt-click still annotates there); native controls keep working. A note can anchor to a text selection (with range anchors), a table cell (named by its visible row and column when that is provable), or a Mermaid node (by the diagram's own ids), and the agent reads each as such. Artifacts get `window.redcodeDesign` (`window.lavish` as an alias) with `queuePrompt`, `sendQueuedPrompts`, `endSession`, `setStatus`, `snapshot`, and `data-redcode-action` / `data-redcode-question` (lavish's names accepted too); an unsent answer for the same control replaces the earlier one. A send carries a bounded DOM snapshot after the notes, and can end the review. The shell replays scroll position and an unsent card draft after the prototype reloads, and adopts the prototype's title and icon.
