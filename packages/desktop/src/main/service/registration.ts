import { homedir } from "node:os"
import path from "node:path"

/**
 * The registration file the Redcode background service writes. Redcode keeps its state under ~/.red/code
 * (not XDG), and release channels share `service.json` (see the CLI's ServiceConfig.filename).
 */
export function serviceRegistrationFile() {
  return path.join(process.env.REDCODE_TEST_HOME ?? homedir(), ".red", "code", "state", "service.json")
}

/** The pointer `redcode desktop` writes to tell the app which installation it belongs to: `{ version, cli, app }`. */
export function desktopInstallFile() {
  return path.join(process.env.REDCODE_TEST_HOME ?? homedir(), ".red", "code", "state", "desktop.json")
}
