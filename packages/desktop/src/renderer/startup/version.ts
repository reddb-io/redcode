import redcode from "../../../../redcode/package.json"

export function desktopVersion() {
  return import.meta.env.OPENCODE_VERSION ?? redcode.version
}
