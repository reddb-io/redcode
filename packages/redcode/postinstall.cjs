const fs = require("node:fs")
const path = require("node:path")
const childProcess = require("node:child_process")

// npm's default Windows shims keep node.exe alive as the native TUI's parent. Invoke
// the selected executable directly so restarting a Node service cannot kill that launcher.
function install(binary, command) {
  for (const directory of [path.resolve(__dirname, "../../.."), path.resolve(__dirname, "../../.bin")]) {
    const relative = path.relative(directory, binary)
    const variable = command === "redcode" ? "REDCODE_BIN_PATH" : "REDCODE_RPC_SIDECAR_PATH"
    const legacy = command === "redcode"
    const owner = `@reddb-io/redcode/bin/${command}`
    const files = {
      ".cmd": `@ECHO off\r\nREM ${owner}\r\nSETLOCAL\r\nIF DEFINED ${variable} (\r\n  "%${variable}%" %*\r\n)${legacy ? ' ELSE IF DEFINED OPENCODE_BIN_PATH (\r\n  "%OPENCODE_BIN_PATH%" %*\r\n)' : ""} ELSE (\r\n  "%~dp0${relative}" %*\r\n)\r\nEXIT /b %ERRORLEVEL%\r\n`,
      ".ps1": `# ${owner}\n$target = Join-Path $PSScriptRoot '${relative.replaceAll("'", "''")}'\nif ($env:${variable}) { $target = $env:${variable} }${legacy ? " elseif ($env:OPENCODE_BIN_PATH) { $target = $env:OPENCODE_BIN_PATH }" : ""}\n& $target @args\nexit $LASTEXITCODE\n`,
      "": `#!/bin/sh\n# ${owner}\nbasedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")\nif [ -n "$${variable}" ]; then\n  exec "$${variable}" "$@"\nfi\n${legacy ? 'if [ -n "$OPENCODE_BIN_PATH" ]; then\n  exec "$OPENCODE_BIN_PATH" "$@"\nfi\n' : ""}exec "$basedir/${relative.replaceAll("\\", "/").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`")}" "$@"\n`,
    }
    for (const [extension, content] of Object.entries(files)) {
      const file = path.join(directory, command + extension)
      if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) continue
      // Only replace shims npm created for this package, never another install on PATH.
      if (!fs.readFileSync(file, "utf8").replaceAll("\\", "/").includes(owner)) continue
      fs.writeFileSync(file, content)
    }
  }
}

module.exports = { install }

if (require.main === module && process.platform === "win32") {
  for (const command of ["redcode", "redcode-rpc-sidecar"]) {
    const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, "bin", command)], {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, REDCODE_INSTALL_WINDOWS_SHIMS: "1" },
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}
