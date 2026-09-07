# Terminal freeze investigation

## Confirmed findings (2026-09-07)

The reproduction exercises the real `Tui.run` lifecycle with the OpenTUI test renderer and a plugin host whose disposer stays pending. Before the change, `app.exit` destroyed the renderer but never completed the scoped run. Consequently the CLI did not reach its worker shutdown, even though that later step already has a five-second deadline.

TUI plugin cleanup now has a two-second deadline. The effect is explicitly interruptible inside the normally uninterruptible finalizer, and failure/timeout is logged. The renderer is destroyed before plugin cleanup on the normal exit path. The deadline permits the outer command to continue to worker shutdown and process exit. It does not cancel arbitrary work inside a third-party Promise, and it cannot interrupt a synchronous JavaScript/native event-loop stall.

The regression test failed before the change (`blocked` instead of `exited`) and passes after it. SIGHUP cleanup and session epilogue tests also pass with the package's 30-second test allowance. A five-second default test timeout was insufficient for the cold renderer fixture and is not evidence of a production freeze.

This proves an indefinite shutdown path, not the cause of the reported spontaneous freeze. At inspection there was no running redcode process to sample. The shell resolved `redcode` to a mise installation of version 0.20.0; this checkout's CLI manifest is 0.21.0. These are separate artifacts: editing this checkout does not update the installed executable. Recent local logs did not contain a captured freeze. The host had CPU contention but no current memory-pressure signal; neither observation establishes the incident's cause.

## Capture before terminating

From another terminal, identify the affected process without printing its command arguments:

```sh
ps -eo pid,ppid,tty,stat,pcpu,rss,etime,comm
bash script/diagnose-terminal.sh PID > /tmp/redcode-freeze.txt
```

Replace PID with the affected redcode process. The Linux collector is read-only, samples three times, and records the executable path, process groups, controlling terminal, terminal modes, CPU/memory pressure, process state and direct children. It excludes environment variables and command arguments, which can contain prompts or credentials.

Interpret the evidence before concluding:

- State `T` means the process is stopped; inspect job control and foreground process groups.
- State `D` indicates uninterruptible kernel waiting; inspect the wait channel and I/O pressure.
- Rising CPU time with an unresponsive UI suggests a hot loop/rendering backlog; it does not identify the responsible function.
- Growing RSS/swap and memory pressure suggest resource exhaustion; one sample cannot establish a leak.
- A pending plugin disposer reproduces the confirmed shutdown failure fixed here.

## Recover control

1. If output was paused by terminal flow control, Ctrl+Q resumes it. This only helps when flow control is enabled.
2. Try normal exit or Ctrl+C. If it fails, capture the state above from a second terminal.
3. Send `kill -TERM PID` to the identified redcode process. Do not kill every Bun/Node process on the host.
4. Once the affected shell returns, run `stty sane` and `reset` if echo, mouse tracking or the display is broken.
5. SIGKILL is a last resort for the identified process if graceful termination cannot run; it skips cleanup and may lose unpersisted work.

For subsequent reproduction, keep the invocation command, actual binary version, terminal emulator, active tool/model, time to failure and whether Ctrl+C, Ctrl+Q or SIGTERM responded. The unresolved part is distinguishing a UI/event-loop stall from blocked cleanup or terminal state.
