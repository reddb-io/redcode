import type { DesktopAPI } from "../preload/types"

// The app declares its own optional `window.api` shape, so the full bridge type is read through a cast here.
export const api = (window as unknown as { api: DesktopAPI }).api
