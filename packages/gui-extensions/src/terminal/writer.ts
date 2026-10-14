// Count UTF-16 code units, including the write xterm is still parsing: at most 8 MiB of text.
const MAX_BUFFERED_CHARS = 4 * 1024 * 1024
const MAX_CHUNKS = 1024

export function terminalWriter(
  write: (data: string, done?: VoidFunction) => void,
  schedule: (flush: VoidFunction) => void = queueMicrotask,
) {
  let chunks: string[] | undefined
  let waits: VoidFunction[] | undefined
  let scheduled = false
  let writing = false
  let buffered = 0

  const settle = () => {
    if (scheduled || writing || chunks?.length) return
    const list = waits

    if (!list?.length) return
    waits = undefined

    for (const fn of list) {
      fn()
    }
  }

  const run = () => {
    if (writing) return
    scheduled = false
    const items = chunks

    if (!items?.length) {
      settle()

      return
    }

    chunks = undefined
    writing = true
    const length = items.reduce((total, item) => total + item.length, 0)
    write(items.join(""), () => {
      buffered -= length
      writing = false

      if (chunks?.length) {
        if (scheduled) return
        scheduled = true
        schedule(run)

        return
      }

      settle()
    })
  }

  const push = (data: string) => {
    if (!data) return true
    if (buffered + data.length > MAX_BUFFERED_CHARS || (chunks?.length ?? 0) >= MAX_CHUNKS) return false
    buffered += data.length

    if (chunks) chunks.push(data)
    else chunks = [data]

    if (scheduled || writing) return true
    scheduled = true
    schedule(run)
    return true
  }

  const flush = (done?: VoidFunction) => {
    if (!scheduled && !writing && !chunks?.length) {
      done?.()

      return
    }

    if (done) {
      if (waits) waits.push(done)
      else waits = [done]
    }

    run()
  }

  return { push, flush }
}
