# @reddb-io/redcode-design-app

## 0.1.2

### Patch Changes

- a4907f4: Design's review page no longer shows a blank white box while a revision loads. The preview area keeps the theme background and a skeleton of the target (slide strip and 16:9 canvas, phone frame, or page) with the current stage and its elapsed time — waiting for the build, preparing the design tools on first use, building, loading assets and fonts, starting the preview — and fades the frame in once its runtime is ready. Before the first revision it says the agent is preparing it and shows what the agent is doing; a failed build shows its summary with Retry. The presenter windows wait the same way. The first download of the design app shows its progress in the TUI, and a review link opened meanwhile shows a page that follows the download instead of a connection error.

## 0.1.1

### Patch Changes

- 00e4cda: Fix presentation windows ping-ponging between slides forever. Pressing back on the first slide could start the audience and presenter windows echoing each other's moves, flipping the URL between two slides without end, and a reopened window joined the loop. A window now follows its slide frame only for a move the reader made inside it, never for the frame's report of a command; it applies a move from another window only when that move is newer than the one on screen, and never passes on what it received; a new window takes the running show's slide. Previous on the first slide and next on the last do nothing anywhere. If moves still arrive faster than any person could make them, the window pauses sync and says "Sync paused — press a key to resume".

## 0.1.0

### Minor Changes

- f3fbe39: First release of the design app on its own: `redcode-design` binaries for every platform redcode ships, released as `design-vX.Y.Z` with the whiteboard bundle, a manifest carrying its protocol and SHA256SUMS. `redcode-design --version` and `--protocol` report what a redcode checks before running it, and the app serves the assets a pre-0.22 prototype import copies.
