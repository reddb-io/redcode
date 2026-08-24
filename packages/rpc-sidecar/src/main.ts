export const MaxHeaderBytes = 8 * 1024
export const MaxBodyBytes = 1024 * 1024

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

async function post(url: URL, body: Uint8Array) {
  const headers: Record<string, string> = {
    "content-type": dialect(body),
    accept: dialect(body),
  }
  const authorization = "REDCODE_AUTHORIZATION" in process.env ? process.env.REDCODE_AUTHORIZATION : undefined
  const password = "REDCODE_SERVER_PASSWORD" in process.env ? process.env.REDCODE_SERVER_PASSWORD : undefined
  if (authorization) headers.authorization = authorization
  if (!authorization && password) {
    const username =
      ("REDCODE_SERVER_USERNAME" in process.env ? process.env.REDCODE_SERVER_USERNAME : undefined) ?? "redcode"
    headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: new Uint8Array(body),
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
  let buffer = new Uint8Array()
  let length: number | undefined

  return {
    push(chunk: Uint8Array) {
      const bodies: Uint8Array[] = []
      buffer = join([buffer, chunk], buffer.byteLength + chunk.byteLength)
      while (true) {
        if (length === undefined) {
          const boundary = headerBoundary(buffer)
          if (boundary < 0) {
            if (buffer.byteLength > MaxHeaderBytes) throw new Error("RPC frame header exceeds 8 KiB")
            break
          }
          if (boundary > MaxHeaderBytes) throw new Error("RPC frame header exceeds 8 KiB")
          length = contentLength(new TextDecoder().decode(buffer.slice(0, boundary)))
          buffer = buffer.slice(boundary + 4)
        }
        if (buffer.byteLength < length) break
        bodies.push(buffer.slice(0, length))
        buffer = buffer.slice(length)
        length = undefined
      }
      return bodies
    },
    finish() {
      if (length !== undefined || buffer.byteLength > 0) throw new Error("Incomplete RPC frame")
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

function headerBoundary(buffer: Uint8Array) {
  for (let index = 0; index <= buffer.byteLength - 4; index++) {
    if (buffer[index] === 13 && buffer[index + 1] === 10 && buffer[index + 2] === 13 && buffer[index + 3] === 10)
      return index
  }
  return -1
}

function dialect(body: Uint8Array) {
  const first = new TextDecoder().decode(body).trimStart()[0]
  return first === "{" || first === "[" ? "application/json" : "application/toon"
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
  const frame = join([header, body], header.byteLength + body.byteLength)
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(frame, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
