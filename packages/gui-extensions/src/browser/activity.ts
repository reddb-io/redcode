/** Keeps an embedded Chromium view throttled unless an operation actively needs it. */
export function createBrowserActivity(setThrottled: (throttled: boolean) => void) {
  let leases = 0
  let disposed = false

  setThrottled(true)

  const acquire = () => {
    if (disposed) return () => undefined
    leases++
    if (leases === 1) setThrottled(false)
    let released = false

    return () => {
      if (released || disposed) return
      released = true
      leases--
      if (leases === 0) setThrottled(true)
    }
  }

  return {
    acquire,
    active: () => leases,
    async during<T>(operation: () => Promise<T>) {
      const release = acquire()
      try {
        return await operation()
      } finally {
        release()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      leases = 0
      setThrottled(true)
    },
  }
}
