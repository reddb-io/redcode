/** Dependency-free ABI and shared-contract smoke for one packaged native library. */
import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { CString, dlopen, FFIType, ptr } from "bun:ffi"

const args = process.argv.slice(2)
const option = (key: string, fallback?: string) => {
  const index = args.indexOf(`--${key}`)
  const value = index < 0 ? fallback : args[index + 1]
  if (!value) throw new Error(`missing --${key}`)
  return path.resolve(value)
}

const filename = process.platform === "win32" ? "redcode_path_search.dll" : process.platform === "darwin" ? "libredcode_path_search.dylib" : "libredcode_path_search.so"
const libraryPath = option("lib", path.join(path.dirname(process.execPath), filename))
const fixturePath = option("fixture")
const outputPath = option("out")
const fixture = (await Bun.file(fixturePath).json()) as {
  files: string[]
  cases: Array<{
    id: string
    query: string
    type: "file" | "directory" | "mixed"
    limit: number
    exactCount?: number
    first?: string
    required?: string[]
  }>
}

const library = dlopen(libraryPath, {
  redcode_search_abi_version: { args: [], returns: FFIType.u32 },
  redcode_search_new_async: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
  redcode_search_ready: { args: [FFIType.ptr], returns: FFIType.i32 },
  redcode_search_find: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.u32, FFIType.u64],
    returns: FFIType.ptr,
  },
  redcode_search_drop: { args: [FFIType.ptr], returns: FFIType.void },
  redcode_search_free_string: { args: [FFIType.ptr], returns: FFIType.void },
})

let handle: ReturnType<typeof library.symbols.redcode_search_new_async> = null
try {
  const abiVersion = library.symbols.redcode_search_abi_version()
  if (abiVersion !== 1) throw new Error(`expected ABI 1, received ${abiVersion}`)
  const started = performance.now()
  const files = Buffer.from(JSON.stringify(fixture.files))
  handle = library.symbols.redcode_search_new_async(ptr(files), files.length)
  if (!handle) throw new Error("async constructor returned null")
  while (true) {
    const state = library.symbols.redcode_search_ready(handle)
    if (state === 1) break
    if (state < 0) throw new Error("async constructor failed")
    if (performance.now() - started > 30_000) throw new Error("async constructor timed out")
    await Bun.sleep(5)
  }
  const readyMs = performance.now() - started
  const validated: Array<{ id: string; count: number }> = []
  for (const test of fixture.cases) {
    const query = Buffer.from(test.query + "\0")
    const result = library.symbols.redcode_search_find(
      handle,
      ptr(query),
      query.length - 1,
      test.type === "file" ? 1 : test.type === "directory" ? 2 : 0,
      test.limit,
    )
    if (!result) throw new Error(`${test.id}: search returned null`)
    let entries: Array<{ path: string; type: "file" | "directory" }>
    try {
      entries = JSON.parse(new CString(result).toString())
    } finally {
      library.symbols.redcode_search_free_string(result)
    }
    if (entries.length > test.limit) throw new Error(`${test.id}: exceeded limit`)
    if (test.exactCount !== undefined && entries.length !== test.exactCount)
      throw new Error(`${test.id}: expected ${test.exactCount} results, received ${entries.length}`)
    if (test.first !== undefined && entries[0]?.path !== test.first)
      throw new Error(`${test.id}: expected first ${test.first}, received ${entries[0]?.path}`)
    for (const required of test.required ?? [])
      if (!entries.some((entry) => entry.path === required)) throw new Error(`${test.id}: missing ${required}`)
    if (new Set(entries.map((entry) => entry.path)).size !== entries.length)
      throw new Error(`${test.id}: duplicate path`)
    if (test.type !== "mixed" && entries.some((entry) => entry.type !== test.type))
      throw new Error(`${test.id}: wrong result type`)
    validated.push({ id: test.id, count: entries.length })
  }
  const libraryBytes = await Bun.file(libraryPath).bytes()
  const report = {
    formatVersion: 1,
    abiVersion,
    platform: process.platform,
    arch: process.arch,
    bun: Bun.version,
    library: {
      filename: path.basename(libraryPath),
      bytes: libraryBytes.length,
      sha256: createHash("sha256").update(libraryBytes).digest("hex"),
    },
    asyncReadyMs: readyMs,
    contract: { fixture: path.basename(fixturePath), cases: validated.length, validated },
    passed: true,
  }
  await mkdir(path.dirname(outputPath), { recursive: true })
  await Bun.write(outputPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (handle) library.symbols.redcode_search_drop(handle)
  library.close()
}
