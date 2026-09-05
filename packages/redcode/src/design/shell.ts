/**
 * The page the person actually opens.
 *
 * The shell is ours: it is not model output, it holds the token, and it is the only document that
 * talks to the server. The prototype lives inside its iframe at an opaque origin and can reach the
 * shell only by `postMessage`. Everything the prototype says is treated as a proposal that a person
 * reviews and sends — never as a command.
 *
 * Written as a string rather than a built asset so it ships with the binary and cannot drift from
 * the route that serves it.
 */

export interface ShellInput {
  readonly id: string
  readonly name: string
  readonly token: string
  readonly revision: number
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function shellCSP() {
  // Ours, so it is strict: no inline script beyond the one we ship (hashed at serve time would be
  // stricter still, but the shell is served from this origin and never contains model output).
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "connect-src 'self'",
    "frame-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ")
}

export function shellHTML(input: ShellInput) {
  const config = JSON.stringify({ id: input.id, token: input.token, revision: input.revision })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escape(input.name)} · redcode design</title>
<style>
  :root { color-scheme: light dark; --edge: color-mix(in oklab, currentColor 14%, transparent); }
  * { box-sizing: border-box }
  body { margin: 0; height: 100vh; display: grid; grid-template-rows: auto 1fr;
         font: 13px/1.5 ui-sans-serif, system-ui, sans-serif }
  header { display: flex; gap: .75rem; align-items: center; padding: .5rem .75rem;
           border-bottom: 1px solid var(--edge) }
  header strong { font-weight: 600 }
  header span { opacity: .6 }
  main { display: grid; grid-template-columns: 1fr min(360px, 34vw); min-height: 0 }
  iframe { border: 0; width: 100%; height: 100%; background: #fff }
  aside { display: grid; grid-template-rows: 1fr auto; border-left: 1px solid var(--edge); min-height: 0 }
  ol { margin: 0; padding: .5rem .75rem; overflow: auto; list-style-position: inside }
  li { padding: .35rem 0; border-bottom: 1px solid var(--edge) }
  li code { opacity: .7 }
  form { display: grid; gap: .5rem; padding: .75rem; border-top: 1px solid var(--edge) }
  textarea { font: inherit; min-height: 4.5rem; resize: vertical; padding: .5rem;
             border: 1px solid var(--edge); border-radius: .375rem; background: transparent; color: inherit }
  button { font: inherit; padding: .4rem .75rem; border-radius: .375rem; border: 1px solid var(--edge);
           background: transparent; color: inherit; cursor: pointer }
  button[disabled] { opacity: .5; cursor: default }
  p.empty { margin: .75rem; opacity: .6 }
</style>
</head>
<body>
<header>
  <strong>${escape(input.name)}</strong>
  <span id="status">click an element in the prototype to annotate it</span>
</header>
<main>
  <!-- The sandbox list below deliberately withholds same-origin access: the document inside is
       model-written and must stay at an opaque origin, unable to read this page's token. The
       serving route repeats the restriction in a header, so it holds even when this page is
       bypassed and the prototype URL is opened directly. -->
  <iframe id="frame" sandbox="allow-scripts allow-forms allow-modals allow-popups"></iframe>
  <aside>
    <ol id="queue"></ol>
    <p class="empty" id="empty">Nothing queued yet.</p>
    <form id="composer">
      <textarea id="text" placeholder="Say what should change…"></textarea>
      <button id="send" type="submit">Send to agent</button>
    </form>
  </aside>
</main>
<script>
(() => {
  const config = ${config}
  const frame = document.getElementById("frame")
  const queue = document.getElementById("queue")
  const empty = document.getElementById("empty")
  const status = document.getElementById("status")
  const text = document.getElementById("text")
  const send = document.getElementById("send")
  const base = location.pathname.replace(/\\/$/, "")
  let pending = []
  let revision = config.revision

  frame.src = base + "/files/index.html"

  const draw = () => {
    queue.replaceChildren(...pending.map((item) => {
      const li = document.createElement("li")
      if (item.label) {
        const code = document.createElement("code")
        code.textContent = item.label + " "
        li.append(code)
      }
      li.append(document.createTextNode(item.text))
      return li
    }))
    empty.hidden = pending.length > 0
    send.disabled = pending.length === 0 && text.value.trim() === ""
  }

  // Only what the prototype is allowed to say. Anything else is ignored rather than interpreted:
  // the frame is the least trusted thing here, and this list is the whole of its vocabulary.
  const ALLOWED = new Set(["ready", "annotate"])

  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return
    const data = event.data
    if (!data || typeof data !== "object") return
    if (data.source !== "redcode-design" || data.v !== 1) return
    if (!ALLOWED.has(data.type)) return
    if (data.type === "ready") { status.textContent = "click an element in the prototype to annotate it"; return }
    const payload = data.payload || {}
    if (typeof payload.text !== "string" || !payload.text.trim()) return
    pending = pending.concat([{
      selector: String(payload.selector || "").slice(0, 512),
      label: String(payload.label || "").slice(0, 200),
      text: payload.text.slice(0, 4000),
      selection: String(payload.selection || "").slice(0, 2000),
    }]).slice(0, 50)
    draw()
    status.textContent = pending.length + " queued · press Send when you are done"
  })

  const submit = async (event) => {
    event.preventDefault()
    const typed = text.value.trim()
    const items = typed ? pending.concat([{ text: typed }]) : pending
    if (items.length === 0) return
    send.disabled = true
    status.textContent = "sending…"
    try {
      const response = await fetch(base + "/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", "x-redcode-design-token": config.token },
        body: JSON.stringify({
          items,
          viewport: { width: innerWidth, height: innerHeight },
        }),
      })
      if (!response.ok) throw new Error("HTTP " + response.status)
      pending = []
      text.value = ""
      draw()
      status.textContent = "sent · the agent has it"
    } catch (error) {
      status.textContent = "could not send (" + error.message + ") · your notes are still here"
      send.disabled = false
    }
  }

  document.getElementById("composer").addEventListener("submit", submit)
  text.addEventListener("input", draw)

  // The prototype changes when the agent rewrites it. Polling a number is enough and costs nothing;
  // the session event stream is a firehose and would be the wrong thing to point a tab at.
  setInterval(async () => {
    try {
      const response = await fetch(base + "/revision", { headers: { "x-redcode-design-token": config.token } })
      if (!response.ok) return
      const next = (await response.json()).revision
      if (typeof next !== "number" || next === revision) return
      revision = next
      const keep = text.value
      frame.src = base + "/files/index.html?rev=" + next
      text.value = keep
      status.textContent = "the agent revised this · reloaded"
    } catch {}
  }, 2000)

  draw()
})()
</script>
</body>
</html>`
}

export * as DesignShell from "./shell"
