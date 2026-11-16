/** Install a locally built Windows package and exercise its launcher and search API. */
import { mkdir, mkdtemp, copyFile, link } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServer } from "node:net"

if (process.platform !== "win32") throw new Error("This smoke currently verifies Windows process modules")
const input = process.argv[2]
const checkout = process.argv[3]
if (!input || !checkout) throw new Error("Usage: bun smoke-path-search-npm.ts <built-package> <checkout>")
const node = Bun.which("node")
const npm = Bun.which("npm.cmd")
if (!node || !npm) throw new Error("Node and npm are required")
const root = await mkdtemp(path.join(os.tmpdir(), "redcode-npm-search-"))
const source = path.join(root, "native")
const installation = path.join(root, "installation")
await mkdir(path.join(source, "bin"), { recursive: true })
await mkdir(installation)
for (const file of ["redcode.exe", "redcode_path_search.dll", "LICENSE.nucleo-matcher.txt", "THIRD_PARTY_NOTICES.txt"]) {
  const original = path.resolve(input, "bin", file)
  const target = path.join(source, "bin", file)
  try { await link(original, target) } catch { await copyFile(original, target) }
}
await Bun.write(path.join(source, "package.json"), JSON.stringify({ name: "@reddb-io/redcode-windows-x64", version: "0.0.0", os: ["win32"], cpu: ["x64"] }))
await Bun.write(path.join(installation, "package.json"), JSON.stringify({ name: "search-smoke", version: "1.0.0", private: true }))
const pack = Bun.spawn([npm, "pack", "--json", "--ignore-scripts"], { cwd: source, stdout: "pipe", stderr: "pipe" })
const [packed, packOutput, packError] = await Promise.all([pack.exited, new Response(pack.stdout).text(), new Response(pack.stderr).text()])
if (packed !== 0) throw new Error(`npm pack failed: ${packError}`)
const archive = path.join(source, (JSON.parse(packOutput) as Array<{ filename: string }>)[0]!.filename)
const install = Bun.spawn([npm, "install", archive, "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: installation, stdout: "pipe", stderr: "pipe" })
const [installed, installError] = await Promise.all([install.exited, new Response(install.stderr).text()])
if (installed !== 0) throw new Error(`npm install failed: ${installError}`)
const meta = path.join(installation, "node_modules", "@reddb-io", "redcode", "bin")
await mkdir(meta, { recursive: true })
await copyFile(path.resolve(import.meta.dir, "../bin/redcode"), path.join(meta, "redcode"))
const port = await new Promise<number>((resolve, reject) => {
  const server = createServer().listen(0, "127.0.0.1", () => {
    const address = server.address()
    if (!address || typeof address === "string") return reject(new Error("No local port"))
    server.close(() => resolve(address.port))
  })
  server.on("error", reject)
})
const password = "fs001-test-only"
const server = Bun.spawn([node, path.join(meta, "redcode"), "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: checkout,
  env: { ...process.env, REDCODE_TEST_HOME: path.join(root, "home"), OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_DISABLE_MODELS_FETCH: "1", REDCODE_BIN_PATH: undefined, OPENCODE_BIN_PATH: undefined,
    REDCODE_PATH_SEARCH_LIBRARY: undefined, REDCODE_PATH_SEARCH_MODE: undefined },
  stdout: "ignore", stderr: "ignore",
})
try {
  const url = new URL(`http://127.0.0.1:${port}/api/fs/find`)
  url.searchParams.set("query", "smoke-product-files")
  url.searchParams.set("type", "file")
  url.searchParams.set("location[directory]", path.resolve(checkout))
  let response: Response | undefined
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) throw new Error(`Launcher exited: ${server.exitCode}`)
    response = await fetch(url, { headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` }, signal: AbortSignal.timeout(2000) }).catch(() => undefined)
    if (response?.ok) break
    await Bun.sleep(300)
  }
  if (!response?.ok) throw new Error(`Search API unavailable: ${response?.status ?? "no response"}`)
  const result = await response.json() as { data: Array<{ path: string }> }
  if (!result.data.some((entry) => entry.path.endsWith("smoke-product-files.ts"))) throw new Error("Expected file missing")
  const script = `$child = Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${server.pid}' | Where-Object Name -eq 'redcode.exe' | Select-Object -First 1; if (!$child) { exit 2 }; $m = Get-Process -Id $child.ProcessId -Module | Where-Object ModuleName -eq 'redcode_path_search.dll'; if (!$m) { exit 3 }; $m.FileName`
  const inspection = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], { stdout: "pipe", stderr: "pipe" })
  if (inspection.exitCode !== 0) throw new Error(`Native module inspection failed: ${inspection.stderr.toString()}`)
  const modulePath = inspection.stdout.toString().trim()
  if (!modulePath.toLowerCase().includes("node_modules")) throw new Error(`Unexpected library location: ${modulePath}`)
  console.log(JSON.stringify({ passed: true, npmPackage: "@reddb-io/redcode-windows-x64", nativeModule: modulePath, resultCount: result.data.length, root }))
} finally {
  Bun.spawnSync(["taskkill", "/PID", String(server.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" })
  await server.exited
}
