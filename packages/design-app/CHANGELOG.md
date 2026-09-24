# @reddb-io/redcode-design-app

## 0.1.1

### Patch Changes

- 00e4cda: Fix presentation windows ping-ponging between slides forever. Pressing back on the first slide could start the audience and presenter windows echoing each other's moves, flipping the URL between two slides without end, and a reopened window joined the loop. A window now follows its slide frame only for a move the reader made inside it, never for the frame's report of a command; it applies a move from another window only when that move is newer than the one on screen, and never passes on what it received; a new window takes the running show's slide. Previous on the first slide and next on the last do nothing anywhere. If moves still arrive faster than any person could make them, the window pauses sync and says "Sync paused — press a key to resume".

## 0.1.0

### Minor Changes

- f3fbe39: First release of the design app on its own: `redcode-design` binaries for every platform redcode ships, released as `design-vX.Y.Z` with the whiteboard bundle, a manifest carrying its protocol and SHA256SUMS. `redcode-design --version` and `--protocol` report what a redcode checks before running it, and the app serves the assets a pre-0.22 prototype import copies.
