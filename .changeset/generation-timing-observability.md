---
"@reddb-io/redcode": minor
---

Restore Redcode observability on the V2 engine. The TUI Context sidebar and the app's context tooltip show the latest step's latency and output speed. Latency runs from the request to the first text, reasoning or tool input; speed counts tokens between the first output and the end of the response, so tool runs never count, and when the provider reports reasoning that did not stream, only the visible output is rated. Nothing is shown when there are too few tokens or too short a window to mean anything. Assistant messages gain `time.first`.

The running prompt footer says what the assistant is doing (waiting for the model, thinking, responding, running a tool) and which step a long run is on, says plainly when nothing has arrived for 90 seconds, and shows the latest stall or loop guard warning of the run.

A failed provider request names its provider, model and request URL, with credentials, query string and fragment removed, in the TUI, in `redcode run` and in the log. An unexpected server error answers with a 500 whose body carries the cause's first line, an `err_xxxxxxxx` reference logged next to the full cause, and the log file to read.

Add a global `--verbose` flag (also `REDCODE_VERBOSE=1`) that traces the boot phases to stderr until the TUI takes the terminal, writes the trace to the log, and logs activity at debug level. `redcode debug startup` prints the same phases, and `redcode debug memory` reports this process's heap and resident memory, the background service's resident memory, the database size and session counts.
