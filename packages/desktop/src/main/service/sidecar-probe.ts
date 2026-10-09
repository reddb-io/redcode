import type { Endpoint } from "@opencode/client/service"
import { serviceRegistrationFile } from "./registration"

// The main thread idles between showing the first window and evaluating the main bundle, waiting
// for the renderer's asset requests. That slot is long enough to find out whether a background
// service is already running, so the renderer's first data request is not the first moment anyone
// asks. The probe only looks; a service that has to be started waits for the layers, which set the
// environment the CLI expects. Like the terminal client, the desktop joins whichever Redcode version
// serves the registration instead of replacing it with its own.
let probe: Promise<Endpoint | undefined> | undefined

export function startSidecarProbe() {
  if (process.env.REDCODE_DESKTOP_SERVER_URL) return
  probe = import("@opencode/client/service")
    .then(({ Service }) => Service.discover({ file: serviceRegistrationFile() }))
    .catch(() => undefined)
}

export function sidecarProbe() {
  return probe ?? Promise.resolve(undefined)
}
