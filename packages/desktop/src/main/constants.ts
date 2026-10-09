import { app } from "electron"

export type Channel = "dev" | "beta" | "prod"

const raw = import.meta.env.REDCODE_DESKTOP_CHANNEL
export const CHANNEL: Channel = raw === "beta" || raw === "prod" ? raw : "dev"

export const APP_NAMES: Record<Channel, string> = {
  dev: "Redcode Dev",
  beta: "Redcode Beta",
  prod: "Redcode",
}

export const APP_IDS: Record<Channel, string> = {
  dev: "io.reddb.redcode.dev",
  beta: "io.reddb.redcode.beta",
  prod: "io.reddb.redcode",
}

export const DEEP_LINK_SCHEME = "redcode"

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
