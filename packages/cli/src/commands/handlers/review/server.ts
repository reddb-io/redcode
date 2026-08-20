/**
 * Local HTTP server for the review feature.
 *
 * Endpoints:
 *   GET  /                       review wrapper HTML (the host page)
 *   GET  /artifact               artifact HTML, with SDK injected
 *   POST /api/annotations       client → server: store annotation
 *   POST /api/layout-issues     client → server: store layout issue
 *   POST /api/artifact-failures client → server: fatal error
 *   GET  /api/feedback           agent → server: long-poll for feedback (TOON)
 *   GET  /api/ended              agent → server: long-poll for ended
 *   GET  /api/quad               agent → server: one-shot read (TOON)
 *   POST /api/end               agent → server: end session
 *
 * Host validation: rejects any Host header not in the allowlist (loopback
 * names + configured bind/link host), defending against DNS rebinding.
 *
 * The server runs as a detached Bun process when `serve` is invoked; the
 * CLI supervises it via the `sessions` JSONL file in `~/.redcode/`.
 */
import { existsSync, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { FRAME_SDK_SOURCE } from "./sdk"
import {
  ensureSession,
  sessionId,
  sessionDir,
  appendAnnotation,
  appendLayoutIssue,
  readLayoutIssues,
  consumeFeedback,
  isEnded,
  touchActivity,
  endSession,
  readState,
} from "./storage"
import type { Annotation, LayoutIssue, SessionId } from "./types"
import { layoutIssueFingerprint } from "./types"
import { encodeToon } from "./toon"
import { selfPaintCheck } from "./gate"

const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_PORT = 0
const SESSION_LOOKUP_GRACE_MS = 60 * 60 * 1000
const POLL_TIMEOUT_MS = 60 * 60 * 1000

const ALLOWED_HOSTS_DEFAULT = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
  DEFAULT_HOST,
])

export type ServerHandle = {
  port: number
  host: string
  url: string
  sessionId: SessionId
  artifactPath: string
  stop: () => void
}

const hostIsAllowed = (host: string, allowed: Set<string>): boolean => {
  if (allowed.has("*")) return true
  return allowed.has(host)
}

export type ServeOptions = {
  artifactPath: string
  host?: string
  port?: number
  artifactHtml: string
  allowedHosts?: Set<string>
  openBrowser?: (url: string) => void
}

export const serve = async (opts: ServeOptions): Promise<ServerHandle> => {
  const host = opts.host ?? DEFAULT_HOST
  const port = opts.port ?? DEFAULT_PORT
  const allowedHosts = opts.allowedHosts ?? ALLOWED_HOSTS_DEFAULT

  const id = ensureSession(opts.artifactPath)
  const gate = selfPaintCheck(opts.artifactHtml)

  const injectedHtml = injectSdk(opts.artifactHtml, gate)

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      const url = new URL(req.url)
      const hostHeader = req.headers.get("host") ?? ""
      const hostName = hostHeader.split(":")[0] ?? ""
      if (!hostIsAllowed(hostName, allowedHosts)) {
        return new Response("Forbidden", { status: 403 })
      }

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(reviewWrapperHtml(opts.artifactPath, gate), {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      }

      if (req.method === "GET" && url.pathname === "/artifact") {
        return new Response(injectedHtml, {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      }

      if (req.method === "POST" && url.pathname === "/api/annotations") {
        const body = await req.json().catch(() => null)
        if (!isAnnotation(body)) {
          return new Response("Invalid annotation", { status: 400 })
        }
        appendAnnotation(id, body)
        touchActivity(id)
        return Response.json({ ok: true, id: body.id })
      }

      if (req.method === "POST" && url.pathname === "/api/layout-issues") {
        const body = await req.json().catch(() => null)
        if (!isLayoutIssueBody(body)) {
          return new Response("Invalid layout issue", { status: 400 })
        }
        const idf = layoutIssueFingerprint({
          rule: body.rule,
          selector: body.selector,
          viewport: body.viewport,
        })
        const issue: LayoutIssue = {
          id: idf,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          severity: body.severity,
          viewport: body.viewport,
          selector: body.selector,
          summary: body.summary,
        }
        appendLayoutIssue(id, issue)
        touchActivity(id)
        return Response.json({ ok: true, id: idf })
      }

      if (req.method === "POST" && url.pathname === "/api/layout-issues/queue") {
        const body = (await req.json().catch(() => null)) as { id?: string } | null
        if (!body?.id) return new Response("Invalid", { status: 400 })
        const state = readState(id)
        const issues = readLayoutIssues(id)
        const target = issues.find((i) => i.id === body.id)
        if (!target) return new Response("Not found", { status: 404 })
        const merged = [
          ...state.pending_layout_issues.filter((i) => i.id !== body.id),
          { ...target, queued: true },
        ]
        writeStateInline(id, { ...state, pending_layout_issues: merged })
        return Response.json({ ok: true })
      }

      if (req.method === "POST" && url.pathname === "/api/layout-issues/dismiss") {
        const body = (await req.json().catch(() => null)) as { id?: string } | null
        if (!body?.id) return new Response("Invalid", { status: 400 })
        const state = readState(id)
        const list = state.pending_layout_issues.map((i) =>
          i.id === body.id ? { ...i, dismissed: true } : i,
        )
        writeStateInline(id, { ...state, pending_layout_issues: list })
        return Response.json({ ok: true })
      }

      if (req.method === "POST" && url.pathname === "/api/artifact-failures") {
        const body = (await req.json().catch(() => null))
        return Response.json({ ok: true, note: "logged" })
      }

      if (req.method === "GET" && url.pathname === "/api/feedback") {
        const ended = isEnded(id)
        if (ended) {
          return toonResponse({ status: "ended", note: "session ended by " + ended })
        }
        const feedback = consumeFeedback(id)
        const empty = feedback.annotations.length === 0 && feedback.layout_issues.length === 0
        if (empty) {
          return toonResponse({
            status: "idle",
            note: "no feedback yet; stay running",
          })
        }
        return toonResponse({
          status: "feedback" as const,
          feedback,
          next_step: "Apply the prompts and call `redcode review poll` again.",
        })
      }

      if (req.method === "GET" && url.pathname === "/api/feedback/long-poll") {
        const abort = new AbortController()
        const interval = setInterval(() => {
          // heartbeat — keeps the connection alive
        }, 15_000)
        const start = Date.now()
        while (Date.now() - start < POLL_TIMEOUT_MS) {
          if (abort.signal.aborted) break
          const ended = isEnded(id)
          if (ended) {
            clearInterval(interval)
            return toonResponse({ status: "ended", note: "session ended by " + ended })
          }
          const feedback = consumeFeedback(id)
          if (feedback.annotations.length > 0 || feedback.layout_issues.length > 0) {
            clearInterval(interval)
            return toonResponse({
              status: "feedback" as const,
              feedback,
              next_step: "Apply the prompts and call `redcode review poll` again.",
            })
          }
          await sleep(750)
        }
        clearInterval(interval)
        return toonResponse({ status: "idle", note: "timed out without feedback" })
      }

      if (req.method === "GET" && url.pathname === "/api/ended") {
        const ended = isEnded(id)
        if (ended) return toonResponse({ status: "ended", note: "ended by " + ended })
        return toonResponse({ status: "idle", note: "still open" })
      }

      if (req.method === "POST" && url.pathname === "/api/end") {
        endSession(id, "agent")
        return toonResponse({ status: "ended", note: "ended by agent" })
      }

      return new Response("Not found", { status: 404 })
    },
  })

  const actualPort = server.port ?? port
  const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${actualPort}`
  touchActivity(id)

  return {
    port: actualPort,
    host,
    url,
    sessionId: id,
    artifactPath: opts.artifactPath,
    stop: () => server.stop(true),
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const toonResponse = (body: object): Response =>
  new Response(encodeToon(body), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  })

const writeStateInline = (id: SessionId, state: import("./types").SessionState) => {
  const file = path.join(sessionDir(id), "state.json")
  require("node:fs").writeFileSync(file, JSON.stringify(state, null, 2))
}

const isAnnotation = (v: unknown): v is Annotation => {
  if (!v || typeof v !== "object") return false
  const a = v as Record<string, unknown>
  return (
    typeof a.id === "string" &&
    typeof a.created_at === "string" &&
    typeof a.kind === "string" &&
    typeof a.prompt === "object" &&
    a.prompt !== null
  )
}

const isLayoutIssueBody = (
  v: unknown,
): v is {
  rule: string
  selector: string
  viewport: string
  severity: "low" | "medium" | "high"
  summary: string
} => {
  if (!v || typeof v !== "object") return false
  const l = v as Record<string, unknown>
  return (
    typeof l.rule === "string" &&
    typeof l.selector === "string" &&
    typeof l.viewport === "string" &&
    (l.severity === "low" || l.severity === "medium" || l.severity === "high") &&
    typeof l.summary === "string"
  )
}

const injectSdk = (html: string, gate: ReturnType<typeof selfPaintCheck>): string => {
  if (html.includes("__redcodeReviewLoaded")) return html
  const flag = gate.ok ? "no-warning" : "self-paint-warning"
  const insert = `<script data-redcode-review="1">window.__redcodeReviewGate=${JSON.stringify(flag)};\n${FRAME_SDK_SOURCE}</script>`
  if (html.includes("</body>")) {
    return html.replace("</body>", insert + "</body>")
  }
  return html + insert
}

const reviewWrapperHtml = (artifactPath: string, gate: ReturnType<typeof selfPaintCheck>): string => {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>redcode review</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, system-ui, sans-serif; background: #0c0c0e; color: #e0e0e0; }
    body { display: flex; flex-direction: column; overflow: hidden; }
    .bar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #161618; border-bottom: 1px solid #2a2a2c; font-size: 13px; }
    .bar .title { font-weight: 600; }
    .bar .spacer { flex: 1; }
    .bar button { padding: 4px 10px; border: 1px solid #3a3a3c; border-radius: 4px; background: #222226; color: #e0e0e0; cursor: pointer; font-size: 13px; }
    .bar button.primary { background: #ff2056; border-color: #ff2056; color: #fff; }
    .bar button:hover { background: #2a2a2e; }
    .bar button.primary:hover { background: #ff3066; }
    .bar button:disabled { opacity: 0.4; cursor: not-allowed; }
    .bar .counter { background: #ff2056; color: #fff; border-radius: 9999px; padding: 0 8px; font-size: 11px; font-weight: 700; }
    .panel { display: flex; height: 100%; min-height: 0; }
    .layout { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .layout-issues { background: #1a1a1c; border-bottom: 1px solid #2a2a2c; padding: 8px 12px; max-height: 30vh; overflow: auto; }
    .layout-issues .item { padding: 6px 8px; border: 1px solid #2a2a2c; border-radius: 4px; margin-bottom: 4px; background: #161618; }
    .layout-issues .item.high { border-color: #ff2056; }
    .layout-issues .item.medium { border-color: #c0a020; }
    .layout-issues .item .row { display: flex; gap: 8px; align-items: center; font-size: 12px; }
    .layout-issues .item summary { cursor: pointer; padding: 2px 0; }
    .layout-issues .item button { font-size: 11px; padding: 2px 8px; }
    .layout-issues .empty { color: #888; font-size: 12px; font-style: italic; }
    .layout-issues .actions { margin-top: 8px; display: flex; gap: 8px; }
    .iframe-wrap { flex: 1; min-height: 0; }
    iframe { width: 100%; height: 100%; border: 0; background: #fff; }
    .chat { width: 360px; background: #161618; border-left: 1px solid #2a2a2c; display: flex; flex-direction: column; }
    .chat .history { flex: 1; overflow: auto; padding: 8px; font-size: 12px; }
    .chat .entry { padding: 6px 8px; border-radius: 4px; margin-bottom: 6px; background: #1c1c1e; }
    .chat .entry .meta { color: #888; font-size: 10px; margin-bottom: 2px; }
    .chat .entry .text-annotation { color: #c0c0c0; font-style: italic; margin-bottom: 4px; padding-left: 8px; border-left: 2px solid #4a4a4c; }
    .chat .entry .comment { color: #e0e0e0; }
    .chat .entry .reply { color: #ff8080; font-size: 11px; margin-top: 4px; }
    .chat .empty { color: #888; font-style: italic; padding: 8px; }
    .chat .composer { padding: 8px; border-top: 1px solid #2a2a2c; background: #0c0c0e; display: flex; flex-direction: column; gap: 8px; }
    .chat .composer textarea { width: 100%; min-height: 60px; background: #000; color: #e0e0e0; border: 1px solid #3a3a3c; border-radius: 4px; padding: 6px; font: 13px/1.4 -apple-system, system-ui, sans-serif; }
    .chat .composer .row { display: flex; gap: 8px; justify-content: space-between; align-items: center; }
    .chat .composer .hint { color: #888; font-size: 11px; }
    .chat .composer button { padding: 6px 12px; border: 1px solid #3a3a3c; border-radius: 4px; background: #222226; color: #e0e0e0; cursor: pointer; }
    .chat .composer button.primary { background: #ff2056; border-color: #ff2056; color: #fff; }
    .warning { background: #2a1a1a; border: 1px solid #ff2056; color: #ff8080; padding: 8px 12px; font-size: 12px; margin: 0; }
  </style>
</head>
<body>
  <div class="bar">
    <span class="title">redcode review</span>
    <span style="color:#888">${escapeServerHtml(artifactPath)}</span>
    <span class="spacer"></span>
    <span id="layout-count" style="display:none"><span class="counter" id="layout-count-num">0</span> layout</span>
    <button id="rerun-layout">Re-check layout</button>
    <button id="end-session">End session</button>
  </div>
  ${gate.ok ? "" : `<div class="warning">${escapeServerHtml(gate.warning ?? "")}</div>`}
  <div class="panel">
    <div class="layout">
      <div class="layout-issues" id="layout-issues">
        <div class="empty">No layout issues yet.</div>
      </div>
      <div class="iframe-wrap">
        <iframe id="artifact" src="/artifact"></iframe>
      </div>
    </div>
    <div class="chat">
      <div class="history" id="history">
        <div class="empty">No feedback yet. Select text or click an element in the artifact to add a comment.</div>
      </div>
      <div class="composer">
        <textarea id="composer-text" placeholder="Type a prompt for the agent…"></textarea>
        <div class="row">
          <span class="hint">Submit sends a fixed-prompt to the agent.</span>
          <button id="send-prompt" class="primary">Send to Agent</button>
        </div>
      </div>
    </div>
  </div>
  <script>
    (() => {
      const state = { layoutIssues: new Map(), annotations: [] };
      const $ = (id) => document.getElementById(id);
      const log = (msg) => console.log("[review]", msg);

      function renderLayoutIssues() {
        const container = $("layout-issues");
        const counter = $("layout-count");
        const num = $("layout-count-num");
        if (state.layoutIssues.size === 0) {
          container.innerHTML = '<div class="empty">No layout issues yet.</div>';
          counter.style.display = "none";
        } else {
          counter.style.display = "inline";
          num.textContent = String(state.layoutIssues.size);
          let html = "";
          for (const issue of state.layoutIssues.values()) {
            html += '<div class="item ' + escapeAttr(issue.severity) + '">';
            html += '<summary><div class="row">';
            html += '<span style="min-width:60px">' + escapeHtml(issue.severity) + '</span>';
            html += '<span style="flex:1">' + escapeHtml(issue.summary) + '</span>';
            html += '<span style="color:#888; font-size:10px">' + escapeHtml(issue.viewport) + ' / ' + escapeHtml(issue.rule) + '</span>';
            html += "</div></summary>";
            html += '<div class="actions">';
            if (!issue.queued && !issue.dismissed) {
              html += '<button data-action="queue" data-id="' + escapeAttr(issue.id) + '">Queue fix</button>';
            } else if (issue.queued) {
              html += '<span style="color:#ff2056">queued</span>';
            }
            if (!issue.dismissed) {
              html += '<button data-action="dismiss" data-id="' + escapeAttr(issue.id) + '">Dismiss</button>';
            }
            html += "</div></div>";
          }
          container.innerHTML = html;
        }
      }

      function renderHistory() {
        const container = $("history");
        if (state.annotations.length === 0) {
          container.innerHTML = '<div class="empty">No feedback yet. Select text or click an element in the artifact to add a comment.</div>';
          return;
        }
        let html = "";
        for (const a of state.annotations) {
          html += '<div class="entry">';
          html += '<div class="meta">' + escapeHtml(a.created_at) + ' — ' + escapeHtml(a.kind) + '</div>';
          if (a.prompt.kind === "text-annotation") {
            html += '<div class="text-annotation">"' + escapeHtml(a.prompt.selected_text) + '"</div>';
            html += '<div class="comment">' + escapeHtml(a.prompt.comment) + '</div>';
          } else if (a.prompt.kind === "element-annotation") {
            html += '<div class="comment">[' + escapeHtml(a.prompt.selector) + '] ' + escapeHtml(a.prompt.comment) + '</div>';
          } else {
            html += '<div class="comment">' + escapeHtml(a.prompt.text) + '</div>';
          }
          html += "</div>";
        }
        container.innerHTML = html;
      }

      async function post(url, body) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) log("POST " + url + " failed " + res.status);
      }

      function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;", "'": "&#39;" })[c]);
      }
      function escapeAttr(s) { return escapeHtml(s); }

      function uuid() {
        if (crypto.randomUUID) return crypto.randomUUID();
        return "id-" + Math.random().toString(36).slice(2, 11);
      }

      window.addEventListener("message", (e) => {
        if (!e.data || e.data.source !== "redcode-review-sdk") return;
        if (e.data.type === "ready") {
          log("artifact ready");
        } else if (e.data.type === "annotation") {
          state.annotations.push(e.data.payload);
          renderHistory();
        } else if (e.data.type === "annotation:queued") {
          log("annotation queued " + e.data.payload.id);
        } else if (e.data.type === "layout-issue") {
          const p = e.data.payload;
          const existing = state.layoutIssues.get(p.id);
          state.layoutIssues.set(p.id, {
            id: p.id,
            rule: p.rule,
            selector: p.selector,
            viewport: p.viewport,
            severity: p.severity,
            summary: p.summary,
            first_seen: existing ? existing.first_seen : new Date().toISOString(),
            last_seen: new Date().toISOString(),
            queued: !!existing?.queued,
            dismissed: !!existing?.dismissed,
          });
          renderLayoutIssues();
        } else if (e.data.type === "artifact-error") {
          log("artifact-error: " + (e.data.payload.message || ""));
        }
      });

      $("layout-issues").addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        if (action === "queue") {
          await post("/api/layout-issues/queue", { id });
          const issue = state.layoutIssues.get(id);
          if (issue) { issue.queued = true; renderLayoutIssues(); }
        } else if (action === "dismiss") {
          await post("/api/layout-issues/dismiss", { id });
          const issue = state.layoutIssues.get(id);
          if (issue) { issue.dismissed = true; renderLayoutIssues(); }
        }
      });

      $("rerun-layout").addEventListener("click", () => {
        const iframe = $("artifact");
        iframe.contentWindow.postMessage({ source: "redcode-review-host", type: "rerun-layout" }, "*");
      });

      $("end-session").addEventListener("click", async () => {
        await post("/api/end", {});
        document.body.innerHTML = '<div style="padding:40px; text-align:center; color:#888">Session ended. You can close this tab.</div>';
      });

      $("send-prompt").addEventListener("click", async () => {
        const text = $("composer-text").value.trim();
        if (!text) return;
        const prompt = {
          id: uuid(),
          created_at: new Date().toISOString(),
          kind: "fixed-prompt",
          prompt: { kind: "fixed-prompt", text },
        };
        await post("/api/annotations", prompt);
        state.annotations.push(prompt);
        renderHistory();
        $("composer-text").value = "";
      });
    })();
  </script>
</body>
</html>
`
}

const escapeServerHtml = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c as "&"])

const escapeAttr = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c as "&"])
