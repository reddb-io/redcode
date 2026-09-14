import { DesignBrowserLauncher } from "@reddb-io/redcode-core/design/browser-launcher"

export type Options = Partial<DesignBrowserLauncher.Options>

const load = async () => {
  const { default: open, apps } = await import("open")
  return { open, apps }
}

/** Opens a Design review URL in Chrome or Chromium when available, else the system browser. Never fails. */
export const open = (url: string, options: Options = {}) => DesignBrowserLauncher.open(url, { load, ...options })

export * as DesignBrowser from "./browser"
