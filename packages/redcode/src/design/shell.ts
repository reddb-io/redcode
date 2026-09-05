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
  /** Inside the app's own panel the header is the tab; only the frame and the composer remain. */
  readonly embed?: boolean
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
  li img { display: block; max-width: 100%; max-height: 120px; margin-top: .35rem; border-radius: .25rem; border: 1px solid var(--edge) }
  .actions { display: flex; gap: .5rem; align-items: center }
  .actions button[type="button"] { opacity: .8 }
  .draft { display: none; align-items: center; gap: .5rem; font-size: 12px; opacity: .8 }
  .draft img { max-height: 40px; border-radius: .25rem; border: 1px solid var(--edge) }
  .draft[data-on] { display: flex }
  body[data-embed] { grid-template-rows: 1fr }
  body[data-embed] header { display: none }
  body[data-embed] main { grid-template-columns: 1fr min(300px, 40vw) }
</style>
</head>
<body${input.embed ? " data-embed" : ""}>
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
      <textarea id="text" placeholder="Say what should change… paste or drop an image to show it"></textarea>
      <div class="draft" id="draft"><img id="draftImg" alt=""><span>image attached</span><button type="button" id="dropImg">remove</button></div>
      <div class="actions">
        <button id="send" type="submit">Send to agent</button>
        <button id="hold" type="button" title="Keep this note here and carry on; nothing is sent until you press Send">Hold</button>
      </div>
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
  const hold = document.getElementById("hold")
  const draft = document.getElementById("draft")
  const draftImg = document.getElementById("draftImg")
  const base = location.pathname.replace(/\\/$/, "")
  let pending = []
  let revision = config.revision
  // The image beside whatever is being typed. Ours to capture: the prototype never sees it and
  // cannot supply one, because the frame's whole vocabulary is "ready" and "annotate".
  let image = null

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
      if (item.image) {
        const img = document.createElement("img")
        img.src = "data:" + item.image.mime + ";base64," + item.image.data
        img.alt = "attached image"
        li.append(img)
      }
      return li
    }))
    empty.hidden = pending.length > 0
    const typed = text.value.trim() !== "" || image !== null
    send.disabled = pending.length === 0 && !typed
    hold.disabled = !typed
    const count = pending.length + (typed ? 1 : 0)
    send.textContent = count > 1 ? "Send " + count + " notes" : "Send to agent"
    draft.toggleAttribute("data-on", image !== null)
    if (image) draftImg.src = "data:" + image.mime + ";base64," + image.data
  }

  // Downscaled here so a screenshot is a reference, not a payload: ≤1280px on the long edge,
  // and re-encoded as JPEG when PNG would be heavier. The server checks the bytes again.
  const MAX_EDGE = 1280
  const MAX_B64 = 800000
  const attach = (file) => {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height)
      let mime = "image/png"
      let data = canvas.toDataURL(mime)
      if (data.length > MAX_B64) { mime = "image/jpeg"; data = canvas.toDataURL(mime, 0.85) }
      if (data.length > MAX_B64) { data = canvas.toDataURL(mime, 0.6) }
      if (data.length > MAX_B64) { status.textContent = "that image is too large even downscaled"; return }
      image = { mime, data: data.slice(data.indexOf(",") + 1) }
      draw()
      status.textContent = "image attached · it goes with what you type"
    }
    img.onerror = () => { URL.revokeObjectURL(url); status.textContent = "could not read that image" }
    img.src = url
  }
  text.addEventListener("paste", (event) => {
    const item = [...(event.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"))
    if (!item) return
    event.preventDefault()
    attach(item.getAsFile())
  })
  text.addEventListener("dragover", (event) => event.preventDefault())
  text.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0]
    if (!file || !file.type.startsWith("image/")) return
    event.preventDefault()
    attach(file)
  })
  document.getElementById("dropImg").addEventListener("click", () => { image = null; draw() })

  // What was typed, as one more note. With only an image, the words say so.
  const typedNote = () => {
    const typed = text.value.trim()
    if (!typed && !image) return null
    return { text: typed || "See the attached image.", ...(image ? { image } : {}) }
  }

  // Hold: the note joins the queue and nothing leaves this page. The agent is woken by Send, and
  // by nothing else — a person decides when a batch is a batch.
  hold.addEventListener("click", () => {
    const note = typedNote()
    if (!note) return
    pending = pending.concat([note]).slice(0, 50)
    text.value = ""
    image = null
    draw()
    status.textContent = pending.length + " held · press Send when you are done"
  })

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
    const note = typedNote()
    const items = note ? pending.concat([note]) : pending
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
      image = null
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
