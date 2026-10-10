export * as RemoteCli from "./remote-cli"

import { Effect, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

export class Failure extends Schema.TaggedError<Failure>()("RemoteCliFailure", {
  code: Schema.Literals(["platform", "version", "install"]),
  detail: Schema.String,
}) {
  override get message() {
    return this.detail
  }
}

export function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function requireVersion(version: string) {
  if (version !== "local" && !/^[0-9][a-zA-Z0-9.+-]*$/.test(version))
    throw new Failure({ code: "version", detail: version })

  return version
}

export function discoverScript(options: { fromPath?: boolean; cache?: { directory: string; prefix: string } } = {}) {
  return `cli=${options.fromPath ? "$(command -v redcode || true)" : '""'}
if [ -z "$cli" ] && [ -x "$HOME/.red/code/bin/redcode" ]; then cli="$HOME/.red/code/bin/redcode"; fi
${
  options.cache
    ? `if [ -z "$cli" ]; then
  for binary in "$HOME"/${quote(options.cache.directory)}/${quote(options.cache.prefix)}*/redcode; do
    if [ -x "$binary" ]; then cli="$binary"; fi
  done
fi
`
    : ""
}if [ -n "$cli" ]; then printf '%s\\n' "$cli"; fi
`
}

// Adapters supply a quoted shell expression, including remote HOME or wslpath expansion.
export function versionScript(command: string) {
  return `if [ -x ${command} ]; then ${command} --version 2>/dev/null || true; fi\n`
}

export function parseVersion(output: string) {
  const line = output
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()

  if (!line) return null
  const marker = line.lastIndexOf(" v")
  const version = marker === -1 ? line : line.slice(marker + 2)

  if (!version) throw new Error("V2 CLI did not provide a version")

  return version
}

export const probeScript = `set -eu
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$os" in linux|darwin) ;; *) exit 2 ;; esac
case "$arch" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) exit 2 ;; esac
target="$os-$arch"
if [ "$arch" = x64 ]; then target="$target-baseline"; fi
if [ "$os" = linux ]; then
  if [ -f /etc/alpine-release ] || (ldd --version 2>&1 | grep -qi musl); then target="$target-musl"; fi
fi
printf 'OPENCODE_REMOTE_TARGET=%s\\n' "$target"
`

export function archiveUrl(target: string, version: string, companion = false) {
  if (!/^(linux|darwin)-(x64-baseline|arm64)(-musl)?$/.test(target))
    throw new Failure({ code: "platform", detail: target })

  const name = `redcode-${companion ? "design-" : ""}${target}`
  return `https://registry.npmjs.org/@reddb-io/${name}/-/${name}-${requireVersion(version)}.tgz`
}

type Source = { type: "download"; url: string; designURL: string } | { type: "archive"; companion?: boolean }

export function installScript(input: { version: string; directory?: string; source: Source }) {
  const version = requireVersion(input.version)

  return `set -eu
umask 077
destination="$HOME"/${quote(input.directory ?? ".red/code/bin")}
mkdir -p "$destination"
stage=$(mktemp -d "$destination/.install-XXXXXX")
trap 'rm -rf "$stage"' EXIT
${stageBinary(input.source)}
chmod 755 "$stage/package/bin/"*
${input.source.type === "archive" && input.source.companion ? 'test -f "$stage/package/bin/redcode-design"' : `test -f "$stage/package/bin/redcode-rpc-sidecar"\n${verifyScript('"$stage/package/bin/redcode"', version)}`}
${input.source.type === "download" ? 'test -f "$stage/package/bin/redcode-design"' : ""}
mv "$stage/package/bin/"* "$destination/"
`
}

function stageBinary(source: Source) {
  if (source.type === "archive") return 'cat > "$stage/archive.tgz"\ntar -xzf "$stage/archive.tgz" -C "$stage"'

  return [source.url, source.designURL]
    .map(
      (url) => `url=${quote(url)}
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --connect-timeout 15 --max-time 180 "$url" -o "$stage/archive.tgz"
else
  wget -T 180 -O "$stage/archive.tgz" "$url"
fi
tar -xzf "$stage/archive.tgz" -C "$stage"`,
    )
    .join("\n")
}

function verifyScript(command: string, version: string) {
  return `test "$(${command} --version | awk '{print $NF}' | sed 's/^v//')" = ${quote(version)}`
}

const Release = Schema.Struct({ version: Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)) })

export const latestRelease = Effect.fn("RemoteCli.latestRelease")(function* () {
  const http = yield* HttpClient.HttpClient

  const metadata = yield* http.get("https://registry.npmjs.org/@reddb-io%2fredcode/latest").pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Release)),
    Effect.timeout("30 seconds"),
    Effect.mapError(
      () => new Failure({ code: "install", detail: "https://registry.npmjs.org/@reddb-io%2fredcode/latest" }),
    ),
  )

  return metadata.version
})
