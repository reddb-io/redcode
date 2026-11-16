/** Native filename search is unavailable outside Bun; callers select the explicit legacy rollback. */
export const available = false

export function tryNucleoAsyncLayer(_filepath: string) {
  const error = new Error("Native filename search requires the Bun runtime") as Error & { code: string }
  error.code = "ERR_REDCODE_SEARCH_RUNTIME"
  return { ok: false as const, error }
}

export const tryNucleoAsyncRuntime = tryNucleoAsyncLayer
