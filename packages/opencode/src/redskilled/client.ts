import { createHash, randomUUID } from "node:crypto"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { decode, encode, type JsonValue } from "@reddb-io/toon"

const socketName = "redskilled.sock"
const maxSocketPath = 108

export function socketPath() {
  const session = process.env.REDSKILLED_SESSION?.trim() || process.env.XDG_RUNTIME_DIR?.trim() || `uid:${uid()}`
  const hash = createHash("sha256").update(`redskilled:${session}`).digest("hex").slice(0, 20)
  const xdg = process.env.XDG_RUNTIME_DIR?.trim()
  const preferred = xdg ? path.join(xdg, "red-skills", hash) : undefined
  if (preferred && path.join(preferred, socketName).length < maxSocketPath) return path.join(preferred, socketName)
  const fallback = path.join(tmpdir(), `red-skills-${uid()}`, hash, socketName)
  if (fallback.length < maxSocketPath || process.platform === "win32") return fallback
  return path.join("/tmp", `red-skills-${uid()}`, hash, socketName)
}

export async function readPayload(project?: string, timeoutMs = 150, target = socketPath()) {
  const response = await request(
    {
      id: randomUUID(),
      op: "statusline-payload",
      ...(project ? { session_project: project } : {}),
    },
    timeoutMs,
    target,
  )
  if (!isRecord(response) || response.ok !== true || !("value" in response)) {
    throw new Error(
      isRecord(response) && typeof response.error === "string" ? response.error : "invalid redskilled response",
    )
  }
  return response.value
}

export async function readStatusline(project?: string, global = false, timeoutMs = 150, target = socketPath()) {
  const response = await request(
    {
      id: randomUUID(),
      op: "statusline-string",
      ...(project ? { session_project: project } : {}),
      render: {
        mode: global ? "global" : "local",
        project: global ? null : (project ?? null),
        max_workers: 4,
        max_projects: 4,
        max_width: 120,
        verbose: false,
      },
    },
    timeoutMs,
    target,
  )
  if (!isRecord(response) || response.ok !== true || !isRecord(response.value)) {
    throw new Error(
      isRecord(response) && typeof response.error === "string" ? response.error : "invalid redskilled response",
    )
  }
  if (
    typeof response.value.line !== "string" ||
    typeof response.value.degraded !== "boolean" ||
    typeof response.value.stale !== "boolean" ||
    typeof response.value.generated_at !== "string"
  )
    throw new Error("redskilled returned an invalid statusline render")
  return {
    line: response.value.line,
    degraded: response.value.degraded,
    stale: response.value.stale,
    generated_at: response.value.generated_at,
  }
}

async function request(message: Record<string, unknown>, timeoutMs: number, target: string) {
  const first = await send(message, "toon", timeoutMs, target)
  if (!isRecord(first) || first.ok !== false || typeof first.id !== "string" || first.id === message.id) return first
  return send(message, "json", timeoutMs, target)
}

async function send(message: Record<string, unknown>, dialect: "toon" | "json", timeoutMs: number, target: string) {
  return new Promise<unknown>((resolve, reject) => {
    const socket = createConnection(target)
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error("redskilled timed out"))
    }, timeoutMs)
    const finish = (callback: () => void) => {
      clearTimeout(timeout)
      callback()
      socket.end()
    }
    let buffer = ""
    socket.on("connect", () => {
      const body =
        dialect === "toon" ? encode(JSON.parse(JSON.stringify(message)) as JsonValue) : JSON.stringify(message)
      socket.write(dialect === "toon" ? `${body.trimEnd()}\n\n` : `${body}\n`)
    })
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const end = dialect === "toon" ? buffer.indexOf("\n\n") : buffer.indexOf("\n")
      if (end < 0) return
      finish(() => {
        try {
          resolve(decodeFrame(buffer.slice(0, dialect === "toon" ? end + 1 : end)))
        } catch (error) {
          reject(error)
        }
      })
    })
    socket.on("error", (error) => finish(() => reject(error)))
    socket.on("close", () => {
      clearTimeout(timeout)
      if (buffer === "") reject(new Error("redskilled closed without a response"))
    })
  })
}

function decodeFrame(frame: string) {
  if (frame.trimStart().startsWith("{")) return JSON.parse(frame) as unknown
  return decode(frame) as unknown
}

function uid() {
  return typeof process.getuid === "function" ? process.getuid() : "nouid"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
