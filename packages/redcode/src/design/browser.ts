import { Effect } from "effect"
import { DesignBrowserLauncher } from "@reddb-io/redcode-core/design/browser-launcher"

export type Options = Partial<DesignBrowserLauncher.Options>

const load = async () => {
  const { default: open, apps } = await import("open")
  return { open, apps }
}

/**
 * Opens a Design review URL in Chrome or Chromium when available, else the system browser. Never fails;
 * succeeds with whether a browser opened. Failed launches are logged at warn level with every browser tried.
 */
export const open = (url: string, options: Options = {}) =>
  DesignBrowserLauncher.open(url, { load, ...options }).pipe(
    Effect.tap((result) => {
      const failed = result.tried.filter((item) => item.error !== undefined)
      if (!result.opened) return Effect.logWarning("design review browser did not open", { url, tried: result.tried })
      if (failed.length === 0) return Effect.void
      return Effect.logWarning("design review opened after browser launch failures", { url, tried: result.tried })
    }),
    Effect.map((result) => result.opened),
  )

export * as DesignBrowser from "./browser"
