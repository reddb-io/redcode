// WSL installs its own Linux binaries; Windows binaries cannot run inside a distro.

export function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function requireVersion(version: string) {
  if (version !== "local" && !/^[0-9][a-zA-Z0-9.+-]*$/.test(version)) throw new Error(version)

  return version
}

export function discoverScript() {
  return `cli=""
if [ -x "$HOME/.red/code/bin/redcode" ]; then cli="$HOME/.red/code/bin/redcode"; fi
if [ -n "$cli" ]; then printf '%s\\n' "$cli"; fi
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

/** Installs a matching Redcode release or an explicitly staged development binary. */
export function installScript(input: { version: string; binary?: string }) {
  const version = requireVersion(input.version)

  return `set -eu
umask 077
destination="$HOME/.red/code/bin"
mkdir -p "$destination"
stage=$(mktemp -d "$destination/.install-XXXXXX")
trap 'rm -rf "$stage"' EXIT
${
  input.binary
    ? `mkdir -p "$stage/package/bin"
binary=${input.binary}
cp "$binary" "$stage/package/bin/redcode"
cp "$(dirname "$binary")/redcode-rpc-sidecar" "$stage/package/bin/redcode-rpc-sidecar"
cp "$(dirname "$binary")/redcode-design" "$stage/package/bin/redcode-design"`
    : `arch=$(uname -m)
case "$arch" in x86_64|amd64) arch=x64-baseline ;; aarch64|arm64) arch=arm64 ;; *) printf 'Unsupported Redcode architecture: %s\\n' "$arch" >&2; exit 2 ;; esac
target="linux-$arch"
if [ -f /etc/alpine-release ] || (ldd --version 2>&1 | grep -qi musl); then target="$target-musl"; fi
for package in "redcode-$target" "redcode-design-$target"; do
  url="https://registry.npmjs.org/@reddb-io/$package/-/$package-${version}.tgz"
  curl -fsSL --connect-timeout 15 --max-time 180 "$url" -o "$stage/archive.tgz"
  tar -xzf "$stage/archive.tgz" -C "$stage"
done
test -f "$stage/package/bin/redcode-rpc-sidecar"
test -f "$stage/package/bin/redcode-design"`
}
chmod 755 "$stage/package/bin/"*
test "$("$stage/package/bin/redcode" --version | awk '{print $NF}' | sed 's/^v//')" = ${quote(version)}
mv "$stage/package/bin/"* "$destination/"
`
}
