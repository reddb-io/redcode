import { app } from "electron"
import redcode from "../../../redcode/package.json"

type Channel = "dev" | "beta" | "prod"

const raw = import.meta.env.REDCODE_DESKTOP_CHANNEL

export const CHANNEL: Channel = raw === "beta" || raw === "prod" ? raw : "dev"

// Packaged builds carry the Redcode version (electron-builder extraMetadata); development runs read it from source.
export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? redcode.version)

const appNames: Record<Channel, string> = {
  dev: "Redcode Dev",
  beta: "Redcode Beta",
  prod: "Redcode",
}

const appIDs: Record<Channel, string> = {
  dev: "io.reddb.redcode.dev",
  beta: "io.reddb.redcode.beta",
  prod: "io.reddb.redcode",
}

// Unpackaged runs keep the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : appNames.dev

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : appIDs.dev

export const DEEP_LINK_SCHEME = "redcode"
