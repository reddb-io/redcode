# @reddb-io/redcode-app

## 1.18.20

### Patch Changes

- f94e2cb: Close turns left open by a process that died, and stop calling them a queue

  `time.completed` on an assistant message is written by the process running the turn. Killed mid-turn — an OOM, a machine going to sleep — nobody writes it, and the message stays open for the rest of the session's life. The TUI reads an open assistant message as a turn in progress and stamps QUEUED on everything typed after it, across restarts, with nothing running: a session that survived one crash looks jammed forever. A fresh run now closes anything left behind by a run that is gone, records it, and the QUEUED badge requires the session to actually be busy.

- Updated dependencies [68c96b4]
- Updated dependencies [7246ae1]
  - @reddb-io/redcode-core@1.19.0
  - @reddb-io/redcode-schema@1.20.0
  - @reddb-io/redcode-session-ui@1.18.20

## 1.18.19

### Patch Changes

- 872f6da: Re-arm the timeline offset watch however the mutation batch is ordered

  A batch that carries both the removal and the re-insertion of the scroll element can present them in either order, and the reconnect was decided record by record: with the addition first, it was judged before the removal had been seen, so the element returned to the page with nothing watching its offset. The batch is now judged as a whole.

- Updated dependencies [78d1b03]
- Updated dependencies [82bb18a]
- Updated dependencies [8c43207]
- Updated dependencies [603d8c7]
- Updated dependencies [86b2250]
  - @reddb-io/redcode-core@1.18.19
  - @reddb-io/redcode-schema@1.19.0
  - @reddb-io/redcode-session-ui@1.18.19
