export const MaxHeaderBytes = 8 * 1024
export const MaxBodyBytes = 1024 * 1024
const InitialBufferBytes = MaxHeaderBytes
const ShrinkAfterFrames = 32

export async function main() {
  process.on("SIGINT", () => process.exit(130))
  process.on("SIGTERM", () => process.exit(143))

  const url = rpcUrl(process.env.REDCODE_RPC_URL)
  const parser = frameParser()
  for await (const chunk of process.stdin) {
    const bodies = parser.push(chunk)
    for (const body of bodies) {
      const response = await post(url, body)
      if (response.byteLength > 0) await write(response)
    }
  }
  parser.finish()
}

export function rpcUrl(input: string | undefined) {
  if (!input) throw new Error("REDCODE_RPC_URL is required")
  const authority = /^https?:\/\/([^/?#]*)/i.exec(input)?.[1]
  if (authority?.includes("@")) throw new Error("REDCODE_RPC_URL must not contain credentials")
  if (input.includes("#")) throw new Error("REDCODE_RPC_URL must point exactly to /rpc")
  const url = new URL(input)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("REDCODE_RPC_URL must use HTTP or HTTPS")
  if (url.pathname !== "/rpc" || url.search) throw new Error("REDCODE_RPC_URL must point exactly to /rpc")
  return url
}

async function post(url: URL, body: Uint8Array<ArrayBuffer>) {
  const contentType = dialect(body)
  const headers: Record<string, string> = {
    "content-type": contentType,
    accept: contentType,
  }
  const authorization = "REDCODE_AUTHORIZATION" in process.env ? process.env.REDCODE_AUTHORIZATION : undefined
  const password = process.env.REDCODE_SERVER_PASSWORD || process.env.OPENCODE_SERVER_PASSWORD || process.env.OPENCODE_PASSWORD
  if (authorization) headers.authorization = authorization
  if (!authorization && password) {
    const username =
      process.env.REDCODE_SERVER_USERNAME || process.env.OPENCODE_SERVER_USERNAME || "opencode"
    headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    redirect: "manual",
  })
  if (response.status >= 300 && response.status < 400)
    throw new Error(`RPC endpoint attempted redirect (${response.status})`)
  if (!response.ok) throw new Error(`RPC endpoint returned HTTP ${response.status}`)

  const headerLength = response.headers.get("content-length")
  const length = headerLength === null ? NaN : parseInt(headerLength, 10)
  if (Number.isFinite(length) && length > MaxBodyBytes) throw new Error("RPC response exceeds 1 MiB")
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > MaxBodyBytes) {
      await reader.cancel()
      throw new Error("RPC response exceeds 1 MiB")
    }
    chunks.push(chunk.value)
  }
  return join(chunks, size)
}

function frameParser() {
  let buffer = new Uint8Array(InitialBufferBytes)
  let start = 0
  let end = 0
  let length: number | undefined
  let smallFrames = 0

  const reserve = (additional: number) => {
    const unread = end - start
    if (start > 0 && unread + additional <= buffer.byteLength) {
      for (let index = 0; index < unread; index++) buffer[index] = buffer[start + index]
      start = 0
      end = unread
    }
    const needed = unread + additional
    if (needed <= buffer.byteLength) return
    let capacity = buffer.byteLength
    while (capacity < needed) capacity *= 2
    const next = new Uint8Array(capacity)
    next.set(buffer.subarray(start, end))
    buffer = next
    start = 0
    end = unread
  }

  return {
    push(chunk: Uint8Array) {
      const bodies: Uint8Array<ArrayBuffer>[] = []
      reserve(chunk.byteLength)
      buffer.set(chunk, end)
      end += chunk.byteLength
      while (true) {
        if (length === undefined) {
          const boundary = headerBoundary(buffer, start, end)
          if (boundary < 0) {
            if (end - start > MaxHeaderBytes) throw new Error("RPC frame header exceeds 8 KiB")
            break
          }
          if (boundary - start > MaxHeaderBytes) throw new Error("RPC frame header exceeds 8 KiB")
          length = contentLength(new TextDecoder().decode(buffer.subarray(start, boundary)))
          start = boundary + 4
        }
        if (end - start < length) break
        bodies.push(buffer.slice(start, start + length))
        smallFrames = length <= InitialBufferBytes / 2 ? smallFrames + 1 : 0
        start += length
        length = undefined
        if (start !== end) continue
        start = 0
        end = 0
        if (smallFrames >= ShrinkAfterFrames && buffer.byteLength > InitialBufferBytes) {
          buffer = new Uint8Array(InitialBufferBytes)
          smallFrames = 0
        }
        break
      }
      if (start > 0) reserve(0)
      return bodies
    },
    finish() {
      if (length !== undefined || end > start) throw new Error("Incomplete RPC frame")
    },
  }
}

function contentLength(header: string) {
  const values = header
    .split("\r\n")
    .map((line) => line.match(/^content-length\s*:\s*(\d+)\s*$/i)?.[1])
    .flatMap((value) => (value === undefined ? [] : [value]))
  if (values.length !== 1) throw new Error("RPC frame requires one Content-Length header")
  const length = parseInt(values[0], 10)
  if (!Number.isSafeInteger(length) || length < 0) throw new Error("Invalid RPC frame Content-Length")
  if (length > MaxBodyBytes) throw new Error("RPC frame body exceeds 1 MiB")
  return length
}

function headerBoundary(buffer: Uint8Array, start: number, end: number) {
  for (let index = start; index <= end - 4; index++) {
    if (buffer[index] === 13 && buffer[index + 1] === 10 && buffer[index + 2] === 13 && buffer[index + 3] === 10)
      return index
  }
  return -1
}

function dialect(body: Uint8Array) {
  for (const byte of body) {
    if (byte === 9 || byte === 10 || byte === 13 || byte === 32) continue
    return byte === 123 || byte === 91 ? "application/json" : "application/toon"
  }
  return "application/toon"
}

function join(chunks: Uint8Array[], size: number) {
  const output = new Uint8Array(size)
  let offset = 0
  chunks.forEach((chunk) => {
    output.set(chunk, offset)
    offset += chunk.byteLength
  })
  return output
}

function write(body: Uint8Array) {
  const header = new TextEncoder().encode(`Content-Length: ${body.byteLength}\r\n\r\n`)
  return new Promise<void>((resolve, reject) => {
    let pending = 2
    let settled = false
    const done = (error?: Error | null) => {
      if (settled) return
      if (error) {
        settled = true
        reject(error)
        return
      }
      pending -= 1
      if (pending > 0) return
      settled = true
      resolve()
    }
    process.stdout.write(header, done)
    process.stdout.write(body, done)
  })
}
