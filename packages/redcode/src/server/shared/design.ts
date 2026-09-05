import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { Effect, FileSystem, Scope } from "effect"
import { HttpIncomingMessage, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { DesignRegistry } from "@/design/registry"
import { DesignFeedback } from "@/design/feedback"
import { DesignRoutePath } from "@/design/route-path"
import { DesignSDK } from "@/design/sdk"
import { DesignServe } from "@/design/serve"
import { DesignShell } from "@/design/shell"
import { SessionPrompt } from "@/session/prompt"

/**
 * The review surface: a shell we wrote, and bytes we did not.
 *
 * Two documents with different privileges. The shell is first-party, holds the token and is the
 * only thing that reaches the API. The prototype is model-written, served at an opaque origin with
 * no network, and can only propose. Keeping that split legible is the whole job of this file.
 */

const notFound = () => HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })

/** Four images at the feedback limit, the words, and JSON's overhead. */
const MAX_FEEDBACK_BYTES = DesignFeedback.LIMITS.images * DesignFeedback.LIMITS.image + 512 * 1024
const forbidden = () => HttpServerResponse.jsonUnsafe({ error: "Forbidden" }, { status: 403 })

/** Where the prototype's own assets live, absolute, for the policy that lets them load. */
function assetPrefix(request: HttpServerRequest.HttpServerRequest, id: string) {
  const host = request.headers["host"] ?? "127.0.0.1"
  const scheme = request.headers["x-forwarded-proto"] === "https" ? "https" : "http"
  return `${scheme}://${host}/design/${id}/files/`
}

export function serveDesignEffect(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost")
    const target = DesignRoutePath.parse(url.pathname)
    if (!target) return notFound()

    const registry = yield* DesignRegistry.Service
    const prototype = yield* registry.get(target.id)
    if (!prototype) return notFound()

    // Everything but the shell needs the token. The shell does not, because opening it is how a
    // person gets the token in the first place — and it discloses nothing on its own.
    const presented = request.headers["x-redcode-design-token"]
    const authorised = presented === prototype.token

    if (target.kind === "shell") {
      return HttpServerResponse.text(
        DesignShell.shellHTML({
          id: prototype.id,
          name: prototype.name,
          token: prototype.token,
          revision: prototype.revision,
          embed: url.searchParams.get("embed") === "1",
        }),
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": DesignShell.shellCSP(),
            // The URL carries the token; it must not travel to anything the page links to.
            "referrer-policy": "no-referrer",
            "cache-control": "no-store",
          },
        },
      )
    }

    if (target.kind === "revision") {
      if (!authorised) return forbidden()
      // The poll is the heartbeat: a mounted surface asks every two seconds.
      yield* registry.touch(prototype.id)
      return HttpServerResponse.jsonUnsafe({ revision: prototype.revision })
    }

    if (target.kind === "feedback") {
      if (!authorised) return forbidden()
      if (request.method !== "POST") return notFound()
      // The body is bounded here because nothing below bounds it: the server is Node's http and
      // Effect's default is unlimited. The stream cap stops a flood early; the length check is
      // the one that holds on every transport, including the in-memory one the tests use.
      const raw = yield* request.text.pipe(
        Effect.provideService(HttpIncomingMessage.MaxBodySize, FileSystem.Size(MAX_FEEDBACK_BYTES)),
        Effect.orElseSucceed(() => undefined),
      )
      if (raw === undefined || raw.length > MAX_FEEDBACK_BYTES) {
        return HttpServerResponse.jsonUnsafe({ error: "Payload Too Large" }, { status: 413 })
      }
      const payload = yield* Effect.try({ try: () => JSON.parse(raw) as unknown, catch: () => undefined }).pipe(
        Effect.orElseSucceed(() => undefined),
      )
      const parsed = (payload ?? {}) as { items?: unknown; viewport?: { width?: unknown; height?: unknown } }
      const items = Array.isArray(parsed.items) ? DesignFeedback.normalize(parsed.items) : []
      if (items.length === 0) return HttpServerResponse.jsonUnsafe({ error: "Nothing to say" }, { status: 400 })

      const viewport =
        typeof parsed.viewport?.width === "number" && typeof parsed.viewport?.height === "number"
          ? { width: Math.round(parsed.viewport.width), height: Math.round(parsed.viewport.height) }
          : undefined

      const text = DesignFeedback.render(items, {
        prototype: prototype.name,
        revision: prototype.revision,
        ...(viewport ? { viewport } : {}),
      })

      // Forked, and into the server's scope rather than the request's: a turn can run for minutes
      // and the browser only needs to know the words were accepted. An idle session starts a turn;
      // a busy one picks this up at its next step, because `ensureRunning` joins the run already in
      // flight rather than starting a second one.
      const prompt = yield* SessionPrompt.Service
      const scope = yield* Scope.Scope
      yield* prompt
        .prompt({
          sessionID: prototype.sessionID,
          // The words first, then the references they mention, as data: URLs — nothing is
          // written to the worktree on a browser's say-so.
          parts: [{ type: "text", text }, ...DesignFeedback.attachments(items)],
        })
        .pipe(
          Effect.catchCause((cause) => Effect.logError("design feedback could not be delivered", { cause })),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      return HttpServerResponse.jsonUnsafe({ accepted: items.length }, { status: 202 })
    }

    const file = DesignServe.resolve(prototype.root, target.path)
    if (!file) return notFound()
    const fs = yield* FSUtil.Service
    const exists = yield* fs.existsSafe(file)
    if (!exists) return notFound()

    const mime = DesignServe.mimeFor(file)!
    const headers: Record<string, string> = {
      "content-type": mime,
      "content-security-policy": DesignServe.prototypeCSP({ assets: assetPrefix(request, prototype.id) }),
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
      "cache-control": "no-store",
    }

    if (mime.startsWith("text/html")) {
      const html = yield* Effect.promise(() => Bun.file(file).text())
      return HttpServerResponse.text(DesignSDK.injectSDK(html), { headers })
    }

    const bytes = yield* Effect.promise(() => Bun.file(file).arrayBuffer())
    if (bytes.byteLength > DesignServe.MAX_FILE_BYTES) return notFound()
    return HttpServerResponse.uint8Array(new Uint8Array(bytes), { headers })
  })
}

export * as DesignRoute from "./design"
