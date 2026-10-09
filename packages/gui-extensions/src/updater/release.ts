import { Option, Schema } from "effect"

/** The Redcode GitHub releases: What's New reads their highlights and the update check their newest version. */
export const RELEASES_URL = "https://api.github.com/repos/reddb-io/redcode/releases"

const decodeReleases = Schema.decodeUnknownOption(
  Schema.Array(Schema.Struct({ tag_name: Schema.String, prerelease: Schema.optional(Schema.Boolean) })),
)

/**
 * Whether the releases hold a stable Redcode version newer than `current`. Only `vX.Y.Z` tags count: the release list
 * also carries the retired `desktop-v*` and `design-v*` tags. A prerelease of a version is older than the version.
 * "unknown" when the list does not read, holds no stable version, or there is no current version.
 */
export function newerRelease(
  json: unknown,
  current: string | undefined,
):
  | { readonly status: "current" }
  | { readonly status: "newer"; readonly version: string }
  | { readonly status: "unknown" } {
  const installed = current === undefined ? undefined : parse(current.replace(/^v/i, ""))
  const latest = Option.getOrElse(decodeReleases(json), () => [])
    .flatMap((release) => {
      const version =
        release.tag_name.startsWith("v") && !release.prerelease ? parse(release.tag_name.slice(1)) : undefined

      return version && !version.prerelease ? [version] : []
    })
    .reduce<Version | undefined>(
      (newest, version) => (newest && compare(newest, version) >= 0 ? newest : version),
      undefined,
    )

  if (!installed || !latest) return { status: "unknown" }

  if (compare(latest, installed) <= 0) return { status: "current" }

  return { status: "newer", version: latest.parts.join(".") }
}

type Version = { readonly parts: readonly [number, number, number]; readonly prerelease: boolean }

function parse(text: string): Version | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(text)

  if (!match) return

  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] !== undefined }
}

/** Orders by major, minor and patch; a prerelease comes before the release of the same version. */
function compare(a: Version, b: Version) {
  const index = a.parts.findIndex((part, i) => part !== b.parts[i])

  if (index !== -1) return a.parts[index] - b.parts[index]

  return Number(b.prerelease) - Number(a.prerelease)
}
