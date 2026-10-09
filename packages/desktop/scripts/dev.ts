import { fileURLToPath } from "node:url"
import { prepareDevElectron } from "./dev-electron"

// Development connects to the Redcode background service through the `redcode` on PATH, or the executable named
// by REDCODE_BIN. REDCODE_DESKTOP_SERVER_URL skips the service and connects to that server directly.
async function main() {
  process.env.REDCODE_DESKTOP_CHANNEL ??= "dev"

  if (process.platform === "darwin") process.env.ELECTRON_EXEC_PATH = await prepareDevElectron()
  // Bun's implicit spawn environment omits values set during preparation.
  process.exitCode = await Bun.spawn(
    [
      "node",
      fileURLToPath(new URL("../bin/electron-vite.js", import.meta.resolve("electron-vite"))),
      "dev",
      ...process.argv.slice(2),
    ],
    { env: process.env, stdio: ["inherit", "inherit", "inherit"] },
  ).exited
}

await main()
