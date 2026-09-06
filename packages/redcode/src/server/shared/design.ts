import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { Cause, Effect, Exit, FileSystem, Scope, Stream } from "effect"
import * as Sse from "effect/unstable/encoding/Sse"
import { HttpIncomingMessage, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { pathToFileURL } from "node:url"
import { DesignAttachments } from "@/design/attachments"
import { DesignExport } from "@/design/export"
import { DesignHost } from "@/design/host"
import { DesignRegistry } from "@/design/registry"
import { DesignFeedback } from "@/design/feedback"
import { DesignLayoutWarnings } from "@/design/layout-warnings"
import { DesignVendor } from "@/design/vendor"
import { DesignRoutePath } from "@/design/route-path"
import { DesignSDK } from "@/design/sdk"
import { DesignServe } from "@/design/serve"
import { DesignShell } from "@/design/shell"
import { DesignWhiteboard } from "@/design/whiteboard"
import { SessionPrompt } from "@/session/prompt"

/**
 * The review surface: a shell we wrote, and bytes we did not.
 *
 * Two documents with different privileges. The shell is first-party, holds the token and is the
 * only thing that reaches the API. The prototype is model-written, served at an opaque origin with
 * no network, and can only propose. Keeping that split legible is the whole job of this file.
 */

const notFound = () => HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
const gone = (by: string) => HttpServerResponse.jsonUnsafe({ error: "Review ended", by }, { status: 409 })

/**
 * A mutating request must come from our own page. The token proves a page was opened for this
 * prototype; the Origin proves the request was made by that page and not by another site the
 * person happens to have open. Header-less callers (curl, tests) are allowed: a browser always sends
 * an Origin on a cross-site POST, so an absent one cannot be a browser attack.
 */
function sameOrigin(request: HttpServerRequest.HttpServerRequest, url: URL) {
  const origin = request.headers["origin"]
  if (!origin) return true
  // A Host header is what a real server sees; the request's own URL is what the tests have.
  const host = request.headers["x-forwarded-host"] ?? request.headers["host"] ?? url.host
  if (!host) return false
  const scheme = request.headers["x-forwarded-proto"] === "https" ? "https" : "http"
  return origin === `${scheme}://${host}`
}

const heartbeat = () => ({ _tag: "Event" as const, event: "heartbeat", id: undefined, data: "{}" })

/** A small JSON body, or nothing: the caller decides what nothing means. */
const MAX_JSON_BYTES = 256 * 1024
const readJSON = (request: HttpServerRequest.HttpServerRequest, max = MAX_JSON_BYTES) =>
  request.text.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, FileSystem.Size(max)),
    Effect.map((raw) => {
      if (raw.length > max) return undefined
      try {
        const parsed = JSON.parse(raw) as unknown
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
      } catch {
        return undefined
      }
    }),
    Effect.orElseSucceed(() => undefined),
  )
const tooLarge = () => HttpServerResponse.jsonUnsafe({ error: "Payload Too Large" }, { status: 413 })

/** Four images at the feedback limit, the words, and JSON's overhead. */
const MAX_FEEDBACK_BYTES = DesignFeedback.LIMITS.images * DesignFeedback.LIMITS.image + 512 * 1024
const forbidden = () => HttpServerResponse.jsonUnsafe({ error: "Forbidden" }, { status: 403 })

/** Where the prototype's own assets live, absolute, for the policy that lets them load. */
function assetPrefix(request: HttpServerRequest.HttpServerRequest, id: string) {
  const host = request.headers["host"] ?? "127.0.0.1"
  const scheme = request.headers["x-forwarded-proto"] === "https" ? "https" : "http"
  return `${scheme}://${host}/design/${id}/files/`
}

/** Where the design assets we ship live, for the same policy. */
function vendorPrefix(request: HttpServerRequest.HttpServerRequest) {
  const host = request.headers["host"] ?? "127.0.0.1"
  const scheme = request.headers["x-forwarded-proto"] === "https" ? "https" : "http"
  return `${scheme}://${host}/design/vendor/`
}

/** One line a person can act on, naming the cap that was hit. Nothing was delivered. */
function describeRejection(rejected: readonly DesignAttachments.Rejection[], caps: DesignAttachments.Config) {
  const reasons = new Set(rejected.map((r) => r.reason))
  const parts: string[] = []
  const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`
  if (reasons.has("prompt-bytes-exceeded")) parts.push(`images exceed the ${mb(caps.maxPromptBytes)} per-note limit`)
  if (reasons.has("too-many")) parts.push(`more than ${caps.maxPerPrompt} images on one note`)
  if (reasons.has("too-many-in-request")) parts.push("too many images queued at once")
  if (reasons.has("malformed")) parts.push("an image attachment was malformed")
  if (reasons.has("not-found")) parts.push("an image is no longer available")
  return `Not sent — ${parts.length ? parts.join("; ") : "some attachments could not be delivered"}. Remove or fix the image, then send again.`
}

export function serveDesignEffect(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost")
    const target = DesignRoutePath.parse(url.pathname)
    if (!target) return notFound()

    // The whiteboard bundle, fetched from an opaque origin: the frame runs sandboxed, and a font
    // fetched from an opaque origin is CORS-gated, so this public content answers every origin.
    if (target.kind === "whiteboard-asset") {
      const registry = yield* DesignRegistry.Service
      const bundle = yield* registry.whiteboard()
      if (!bundle.dir) return HttpServerResponse.jsonUnsafe({ error: "whiteboard bundle not available" }, { status: 404 })
      const file = yield* Effect.promise(() => DesignWhiteboard.resolveAsset(bundle.dir!, target.path))
      if (!file) return notFound()
      const stat = yield* Effect.promise(() => Bun.file(file).stat()).pipe(Effect.orElseSucceed(() => undefined))
      if (!stat) return notFound()
      // Revalidated on every use: the URL is unversioned, and a stale bundle after an upgrade is
      // worse than a cheap loopback round trip.
      const etag = `"${DesignWhiteboard.VERSION}-${stat.size}-${Math.floor(stat.mtimeMs)}"`
      const headers = {
        "access-control-allow-origin": "*",
        "cache-control": "no-cache",
        etag,
        "x-content-type-options": "nosniff",
      }
      if (request.headers["if-none-match"] === etag) return HttpServerResponse.empty({ status: 304, headers })
      const bytes = yield* Effect.promise(() => Bun.file(file).arrayBuffer())
      return HttpServerResponse.uint8Array(new Uint8Array(bytes), {
        headers: { ...headers, "content-type": DesignWhiteboard.assetMime(file)! },
      })
    }

    // Not a prototype's: the assets every prototype may use. Public, immutable per release.
    if (target.kind === "vendor") {
      const asset = DesignVendor.FILES[target.name]
      if (!asset) return notFound()
      return HttpServerResponse.text(asset.body, {
        headers: {
          "content-type": asset.mime,
          "cache-control": "public, max-age=86400",
          "x-content-type-options": "nosniff",
          "cross-origin-resource-policy": "same-origin",
        },
      })
    }

    const registry = yield* DesignRegistry.Service
    // Only under a name that is this machine: a page elsewhere that resolves its own name here
    // must not be able to drive the surface from a browser (DNS rebinding).
    const settings = yield* registry.settings()
    const { Server } = yield* Effect.promise(() => import("../server"))
    const bound = Server.url?.hostname ? [Server.url.hostname] : []
    if (!DesignHost.allowed(request.headers["host"], [...bound, ...settings.hosts])) return forbidden()

    const prototype = yield* registry.get(target.id)
    if (!prototype) return notFound()

    // Everything but the shell needs the token. The shell does not, because opening it is how a
    // person gets the token in the first place — and it discloses nothing on its own. The event
    // stream takes it as a query parameter, because EventSource cannot send a header.
    const presented = request.headers["x-redcode-design-token"] ?? url.searchParams.get("token") ?? undefined
    const authorised = presented === prototype.token

    if (target.kind === "shell") {
      const caps = yield* registry.attachments()
      const network = DesignHost.networkURL(Server.url)
      const whiteboard = yield* registry.whiteboard()
      return HttpServerResponse.text(
        DesignShell.shellHTML({
          id: prototype.id,
          name: prototype.name,
          token: prototype.token,
          revision: prototype.revision,
          root: prototype.root,
          attachments: {
            maxCount: caps.maxPerPrompt,
            maxBytes: caps.maxBytes,
            accepted: DesignAttachments.ACCEPTED_MIME,
          },
          // One tab can turn the curtain off for itself; the config turns it off for everyone.
          gate: settings.gate && url.searchParams.get("gate") !== "0",
          gateTimeoutMs: settings.gateTimeoutMs,
          ...(network ? { networkUrl: `${network}/design/${prototype.id}` } : {}),
          whiteboard: whiteboard.status === "ready",
          ...(prototype.ended ? { ended: prototype.ended.by } : {}),
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

    if (target.kind === "events") {
      if (!authorised) return forbidden()
      yield* registry.touch(prototype.id)
      const live = yield* registry.subscribe(prototype.id)
      // What a shell needs first: the conversation so far and where the review stands. Then
      // whatever happens, with a heartbeat so a proxy does not close a quiet stream.
      const first: DesignRegistry.LiveEvent[] = [
        { type: "chat-sync", chat: prototype.chat },
        { type: "layout-warnings", warnings: DesignLayoutWarnings.serializeAll(prototype.warnings) },
        ...(prototype.ended ? [{ type: "ended" as const, by: prototype.ended.by }] : []),
      ]
      const ticks = Stream.tick("15 seconds").pipe(
        Stream.drop(1),
        Stream.map(() => heartbeat()),
      )
      const body = Stream.fromIterable(first).pipe(
        Stream.concat(live),
        Stream.map(
          (event): Sse.Event => ({ _tag: "Event", event: event.type, id: undefined, data: JSON.stringify(event) }),
        ),
        Stream.merge(ticks, { haltStrategy: "left" }),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
      )
      return HttpServerResponse.stream(body, {
        contentType: "text/event-stream",
        headers: {
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
          "x-content-type-options": "nosniff",
        },
      })
    }

    if (target.kind === "end") {
      if (!authorised) return forbidden()
      if (request.method !== "POST") return notFound()
      if (!sameOrigin(request, url)) return forbidden()
      const ended = yield* registry.end(prototype.id, "user")
      return HttpServerResponse.jsonUnsafe({ ended: ended?.ended?.by ?? "user" })
    }

    // --- whiteboards ---------------------------------------------------------------------------
    // The frame page carries a token minted for this prototype; the shell accepts a frame only
    // after the server confirms the token and the frame proves descent from the prototype frame.
    if (target.kind === "whiteboard-frame") {
      if (request.method !== "GET") return notFound()
      const bundle = yield* registry.whiteboard()
      if (!bundle.dir) {
        const copy =
          bundle.status === "fetching"
            ? "The whiteboard bundle is being fetched. Reload the review in a moment."
            : "The whiteboard bundle is not available on this machine. Diagrams stay as they are."
        return HttpServerResponse.text(`<!doctype html><meta charset="utf-8"><p style="font:14px system-ui;padding:1rem">${copy}</p>`, {
          status: 503,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        })
      }
      return HttpServerResponse.text(DesignWhiteboard.frameHTML(DesignWhiteboard.mintChannel(bundle.secret, prototype.id)), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": DesignWhiteboard.frameCSP(`${vendorPrefix(request)}whiteboard/`),
          "referrer-policy": "no-referrer",
          "cache-control": "no-store",
        },
      })
    }

    if (target.kind === "mermaid-sources") {
      if (!authorised) return forbidden()
      if (request.method !== "GET") return notFound()
      const entry = DesignServe.resolve(prototype.root, "/index.html")
      const html = entry ? yield* Effect.promise(() => Bun.file(entry).text()).pipe(Effect.orElseSucceed(() => "")) : ""
      const sources = DesignWhiteboard.extractSources(html).map((item) => ({
        ...item,
        hash: DesignWhiteboard.sourceHash(item.source),
      }))
      return HttpServerResponse.jsonUnsafe({ sources })
    }

    if (target.kind === "whiteboard-channel") {
      if (!authorised) return forbidden()
      if (request.method !== "POST") return notFound()
      if (!sameOrigin(request, url)) return forbidden()
      const body = yield* readJSON(request)
      if (body === undefined) return tooLarge()
      const bundle = yield* registry.whiteboard()
      if (!DesignWhiteboard.verifyChannel(body.token, bundle.secret, prototype.id)) {
        return HttpServerResponse.jsonUnsafe({ error: "invalid whiteboard channel" }, { status: 403 })
      }
      return HttpServerResponse.jsonUnsafe({ status: "authenticated" })
    }

    if (target.kind === "whiteboard") {
      if (!authorised) return forbidden()
      if (request.method === "GET") {
        const saved = yield* Effect.promise(() => DesignWhiteboard.load(prototype.root, target.index))
        return HttpServerResponse.jsonUnsafe({ whiteboard: saved })
      }
      if (request.method !== "PUT") return notFound()
      if (!sameOrigin(request, url)) return forbidden()
      if (prototype.ended) return gone(prototype.ended.by)
      const body = yield* readJSON(request, DesignWhiteboard.MAX_BODY_BYTES)
      if (body === undefined) return tooLarge()
      yield* Effect.promise(() =>
        DesignWhiteboard.save(prototype.root, target.index, {
          sourceHash: body.source_hash ?? body.sourceHash,
          textMetricsVersion: body.text_metrics_version ?? body.textMetricsVersion,
          scene: body.scene ?? null,
          baseline: body.baseline ?? null,
        }),
      )
      return HttpServerResponse.jsonUnsafe({ status: "saved" })
    }

    if (target.kind === "whiteboard-files") {
      if (!authorised) return forbidden()
      if (request.method !== "POST") return notFound()
      if (!sameOrigin(request, url)) return forbidden()
      if (prototype.ended) return gone(prototype.ended.by)
      const body = yield* readJSON(request, DesignWhiteboard.MAX_BODY_BYTES)
      if (body === undefined) return tooLarge()
      const written = yield* Effect.promise(() =>
        DesignWhiteboard.writeFeedbackFiles(prototype.root, target.index, {
          scene: body.scene ?? null,
          pngDataUrl: body.pngDataUrl ?? body.png_data_url,
        }),
      )
      return HttpServerResponse.jsonUnsafe({ scene_path: written.scenePath, preview_path: written.previewPath })
    }

    // One file, with everything local inside it. Downloaded in the ordinary case; if a browser
    // renders it instead, the prototype's own policy keeps it at an opaque origin.
    if (target.kind === "export") {
      if (!authorised) return forbidden()
      if (request.method !== "GET") return notFound()
      const entry = DesignServe.resolve(prototype.root, "/index.html")
      if (!entry) return notFound()
      const fs = yield* FSUtil.Service
      if (!(yield* fs.existsSafe(entry))) return notFound()
      const html = yield* Effect.promise(() => Bun.file(entry).text())
      const caps = yield* registry.exportCaps()
      const built = yield* Effect.promise(() => DesignExport.build(prototype.root, html, caps))
      return HttpServerResponse.text(built.html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": DesignServe.prototypeCSP({
            assets: assetPrefix(request, prototype.id),
            vendor: vendorPrefix(request),
          }),
          "content-disposition": DesignExport.contentDisposition(prototype.name),
          "x-redcode-export-warning-count": String(built.unresolved.length),
          "x-redcode-export-notice-count": String(built.notices.length),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      })
    }

    if (target.kind === "load") {
      if (!authorised) return forbidden()
      if (request.method !== "POST") return notFound()
      if (!sameOrigin(request, url)) return forbidden()
      const body = yield* readJSON(request)
      if (body === undefined) return tooLarge()
      const begun = yield* registry.beginLoad(prototype.id, {
        client: String(body.client || ""),
        sequence: Number(body.sequence) || 0,
      })
      if (!begun) return notFound()
      return HttpServerResponse.jsonUnsafe({
        status: begun.stale ?? "begun",
        revision: begun.revision,
        artifact_load_token: begun.token,
      })
    }

    // The passive inbox. Nothing here starts a turn: a pass is folded into the warnings, the
    // page is told what changed, and the person decides what, if anything, to ask for.
    if (target.kind === "diagnostics") {
      if (!authorised) return forbidden()
      if (request.method !== "POST") return notFound()
      if (!sameOrigin(request, url)) return forbidden()
      const body = yield* readJSON(request)
      if (body === undefined) return tooLarge()
      const result = yield* registry.diagnostics(prototype.id, body)
      if (!result) return notFound()
      return HttpServerResponse.jsonUnsafe({
        status: result.stale ? "stale" : "recorded",
        active_count: result.warnings.filter((warning) => warning.active).length,
        warnings: result.warnings,
      })
    }

    if (target.kind === "warnings") {
      if (!authorised) return forbidden()
      if (target.action === undefined) {
        if (request.method !== "GET") return notFound()
        return HttpServerResponse.jsonUnsafe({
          warnings: DesignLayoutWarnings.serializeAll(prototype.warnings),
          revision: prototype.revision,
        })
      }
      if (request.method !== "POST") return notFound()
      if (!sameOrigin(request, url)) return forbidden()
      if (prototype.ended) return gone(prototype.ended.by)
      const body = yield* readJSON(request)
      if (body === undefined) return tooLarge()
      if (target.action === "queue") {
        // Prepared, not committed: the note joins the page's queue like any other, and the
        // warnings become repair requests only when that note is delivered.
        const ids = Array.isArray(body.ids) ? body.ids : []
        const revision = typeof body.revision === "number" ? body.revision : undefined
        const result = yield* registry.prepareWarnings(prototype.id, ids, revision)
        if (!result) return notFound()
        if (result.conflict) {
          return HttpServerResponse.jsonUnsafe(
            { error: "conflict", status: "conflict", revision: result.revision },
            { status: 409 },
          )
        }
        return HttpServerResponse.jsonUnsafe({
          status: result.queued.length ? "prepared" : "unchanged",
          queued_count: result.queued.length,
          prompt: result.prompt,
          warnings: result.warnings,
        })
      }
      const result = yield* registry.dismissWarning(prototype.id, body.id)
      if (!result) return notFound()
      return HttpServerResponse.jsonUnsafe({ status: result.changed ? "dismissed" : "unchanged", warnings: result.warnings })
    }

    // The narrow fatal path: the document itself, or a local asset it declares, cannot be served.
    // There is no review to triage from, so this one does reach the agent.
    if (target.kind === "failures") {
      if (!authorised) return forbidden()
      if (request.method !== "POST") return notFound()
      if (!sameOrigin(request, url)) return forbidden()
      if (prototype.ended) return gone(prototype.ended.by)
      const body = yield* readJSON(request)
      if (body === undefined) return tooLarge()
      const result = yield* registry.failures(prototype.id, body)
      if (!result) return notFound()
      if (result.stale) return HttpServerResponse.jsonUnsafe({ status: "stale" }, { status: 409 })
      if (result.fresh.length === 0) return HttpServerResponse.jsonUnsafe({ status: "unchanged" })
      const text = DesignFeedback.renderFailures(result.fresh, {
        prototype: prototype.name,
        revision: prototype.revision,
      })
      yield* registry.say(prototype.id, {
        role: "user",
        text: `(the prototype could not be shown: ${result.fresh.map((f) => f.detail).join("; ")})`,
      })
      const prompt = yield* SessionPrompt.Service
      const scope = yield* Scope.Scope
      yield* prompt
        .prompt({ sessionID: prototype.sessionID, parts: [{ type: "text", text }] })
        .pipe(
          Effect.catchCause((cause) => Effect.logError("design failure could not be delivered", { cause })),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      return HttpServerResponse.jsonUnsafe({ status: "recorded", failures: result.fresh })
    }

    if (target.kind === "attachment") {
      if (!authorised) return forbidden()
      const caps = yield* registry.attachments()
      if (target.aid === undefined) {
        // Upload: raw bytes, bounded before they are read; the type is decided by the bytes.
        if (request.method !== "POST") return notFound()
        if (!sameOrigin(request, url)) return forbidden()
        if (prototype.ended) return gone(prototype.ended.by)
        const body = yield* request.arrayBuffer.pipe(
          Effect.provideService(HttpIncomingMessage.MaxBodySize, FileSystem.Size(caps.maxBytes + 1)),
          Effect.map((buffer) => Buffer.from(buffer)),
          Effect.orElseSucceed(() => undefined),
        )
        if (body === undefined || body.length > caps.maxBytes) {
          return HttpServerResponse.jsonUnsafe(
            { error: `attachment exceeds the ${caps.maxBytes} byte limit` },
            { status: 413 },
          )
        }
        const keep = yield* registry.referenced()
        const stored = yield* registry
          .exclusive(
            Effect.tryPromise({
              try: () =>
                DesignAttachments.write(DesignAttachments.ROOT, prototype.id, body, {
                  ...caps,
                  referenced: keep,
                }),
              catch: (error) => error,
            }),
          )
          .pipe(Effect.exit)
        if (Exit.isFailure(stored)) {
          const error = Cause.squash(stored.cause)
          const status = error instanceof DesignAttachments.StoreError ? error.status : 500
          return HttpServerResponse.jsonUnsafe(
            { error: error instanceof Error ? error.message : String(error) },
            { status },
          )
        }
        return HttpServerResponse.jsonUnsafe({ status: "stored", attachment: stored.value })
      }
      if (request.method === "DELETE") {
        if (!sameOrigin(request, url)) return forbidden()
        const aid = target.aid
        const status = yield* registry.exclusive(
          Effect.gen(function* () {
            const keep = yield* registry.referenced()
            if (keep.has(`${prototype.id}/${aid}`)) return "referenced"
            const removed = yield* Effect.promise(() =>
              DesignAttachments.remove(DesignAttachments.ROOT, prototype.id, aid),
            )
            return removed ? "removed" : "absent"
          }),
        )
        return HttpServerResponse.jsonUnsafe({ status })
      }
      if (request.method !== "GET" && request.method !== "HEAD") return notFound()
      const found = yield* Effect.promise(() =>
        DesignAttachments.statForServe(DesignAttachments.ROOT, prototype.id, target.aid!),
      )
      if (!found) return notFound()
      const bytes = yield* Effect.promise(() => Bun.file(found.file).arrayBuffer()).pipe(
        Effect.orElseSucceed(() => undefined),
      )
      if (!bytes) return notFound()
      return HttpServerResponse.uint8Array(new Uint8Array(bytes), {
        headers: {
          "content-type": found.mime,
          "cache-control": "private, max-age=300",
          "x-content-type-options": "nosniff",
          "cross-origin-resource-policy": "same-origin",
        },
      })
    }

    if (target.kind === "feedback") {
      if (!authorised) return forbidden()
      if (request.method !== "POST") return notFound()
      if (!sameOrigin(request, url)) return forbidden()
      // Nothing arrives after the end: no turn will read it, and the person was told so.
      if (prototype.ended) return gone(prototype.ended.by)
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
      const parsed = (payload ?? {}) as {
        items?: unknown
        viewport?: { width?: unknown; height?: unknown }
        snapshot?: unknown
        end?: unknown
      }
      const rawItems = Array.isArray(parsed.items) ? parsed.items : []
      const items = DesignFeedback.normalize(rawItems)
      if (items.length === 0) return HttpServerResponse.jsonUnsafe({ error: "Nothing to say" }, { status: 400 })

      // Every image reference becomes what is on disk, or the whole send is refused: the browser
      // keeps its queue and is told which cap was hit.
      const caps = yield* registry.attachments()
      const kept = rawItems.filter(
        (item) => item && typeof item === "object" && DesignFeedback.normalize([item]).length === 1,
      )
      const images = yield* Effect.promise(() =>
        DesignAttachments.resolveAll(
          DesignAttachments.ROOT,
          prototype.id,
          kept.slice(0, DesignFeedback.LIMITS.items) as { attachments?: unknown }[],
          caps,
        ),
      )
      if (images.rejected.length) {
        return HttpServerResponse.jsonUnsafe(
          {
            error: describeRejection(images.rejected, caps),
            rejected: images.rejected.slice(0, 4),
            caps: { maxPerPrompt: caps.maxPerPrompt, maxPromptBytes: caps.maxPromptBytes, maxBytes: caps.maxBytes },
          },
          { status: 400 },
        )
      }
      const files = images.resolved.flatMap((own, index) =>
        own.map((image, n) => ({
          type: "file" as const,
          mime: image.mime,
          filename: image.name ?? `design-note-${index + 1}-${n + 1}.${image.id.slice(-4).replace(".", "")}`,
          url: pathToFileURL(image.path).href,
        })),
      )

      const viewport =
        typeof parsed.viewport?.width === "number" && typeof parsed.viewport?.height === "number"
          ? { width: Math.round(parsed.viewport.width), height: Math.round(parsed.viewport.height) }
          : undefined

      const text = DesignFeedback.render(items, {
        prototype: prototype.name,
        revision: prototype.revision,
        ...(viewport ? { viewport } : {}),
        ...(typeof parsed.snapshot === "string" && parsed.snapshot.trim() ? { snapshot: parsed.snapshot } : {}),
        ...(parsed.end === true ? { ended: "user" as const } : {}),
      })

      // Forked, and into the server's scope rather than the request's: a turn can run for minutes
      // and the browser only needs to know the words were accepted. An idle session starts a turn;
      // a busy one picks this up at its next step, because `ensureRunning` joins the run already in
      // flight rather than starting a second one.
      // The panel keeps what was said: the composer's words, or a count of the notes.
      const said = items.filter((item) => item.tag === "message").map((item) => item.text)
      const notes = items.length - said.length
      yield* registry.say(prototype.id, {
        role: "user",
        text: [...said, ...(notes > 0 ? [`(${notes} annotation${notes === 1 ? "" : "s"} sent)`] : [])].join("\n"),
      })
      if (parsed.end === true) yield* registry.end(prototype.id, "user")
      // A batch of layout fixes was delivered: those warnings are now repair requests, and the
      // inbox stops offering them until a newer revision says whether the fix took.
      yield* registry.commitWarnings(prototype.id, DesignFeedback.queuedWarningIDs(items))
      yield* registry.deliver(
        prototype.id,
        images.resolved.flat().map((image) => image.id),
      )

      const prompt = yield* SessionPrompt.Service
      const scope = yield* Scope.Scope
      yield* prompt
        .prompt({
          sessionID: prototype.sessionID,
          // The words first, then the references they mention, as data: URLs — nothing is
          // written to the worktree on a browser's say-so.
          parts: [{ type: "text", text }, ...DesignFeedback.attachments(items), ...files],
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

    // A shell names the load it is making. A load that has since been replaced gets a refusal
    // rather than bytes, so a frame that lost a race cannot report on a page nobody is seeing;
    // and a probe asks only whether the document can be served, which is now answered.
    const loadToken = url.searchParams.get("load")
    if (loadToken !== null) {
      const current = yield* registry.verifyLoad(prototype.id, loadToken)
      if (!current) return HttpServerResponse.jsonUnsafe({ status: "stale" }, { status: 409 })
      if (url.searchParams.get("probe") === "1") return HttpServerResponse.empty({ status: 200 })
    }

    const mime = DesignServe.mimeFor(file)!
    const whiteboard = yield* registry.whiteboard()
    const framePath = `/design/${prototype.id}/whiteboard`
    const headers: Record<string, string> = {
      "content-type": mime,
      "content-security-policy": DesignServe.prototypeCSP({
        assets: assetPrefix(request, prototype.id),
        vendor: vendorPrefix(request),
        ...(whiteboard.status === "ready" ? { frame: `${assetPrefix(request, prototype.id).replace(/\/files\/$/, "")}/whiteboard` } : {}),
      }),
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
      "cache-control": "no-store",
    }

    if (mime.startsWith("text/html")) {
      const html = yield* Effect.promise(() => Bun.file(file).text())
      const caps = yield* registry.attachments()
      return HttpServerResponse.text(
        DesignSDK.injectSDK(html, {
          load: prototype.revision,
          attachments: {
            maxCount: caps.maxPerPrompt,
            maxBytes: caps.maxBytes,
            accepted: DesignAttachments.ACCEPTED_MIME,
          },
          ...(whiteboard.status === "ready" ? { whiteboard: { frame: framePath } } : {}),
        }),
        { headers },
      )
    }

    const bytes = yield* Effect.promise(() => Bun.file(file).arrayBuffer())
    if (bytes.byteLength > DesignServe.MAX_FILE_BYTES) return notFound()
    return HttpServerResponse.uint8Array(new Uint8Array(bytes), { headers })
  })
}

export * as DesignRoute from "./design"
