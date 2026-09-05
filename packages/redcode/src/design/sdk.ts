/**
 * What the prototype gets, and nothing more.
 *
 * Injected into every HTML document served from a prototype directory. It can highlight an element,
 * ask the person what should change about it, and hand that to the shell. It cannot reach the
 * network — the serving policy forbids it — and the shell ignores anything it says beyond two
 * message types. So this is a proposal mechanism, not a channel.
 *
 * It lives in a shadow root so the prototype's own CSS cannot deform it and its CSS cannot leak
 * into the prototype being reviewed.
 */

/** A readable name for an element, short enough to sit in a transcript line. */
export const LABEL_PARTS = 3

export function sdkScript() {
  return `(() => {
  if (window.__redcodeDesign) return
  window.__redcodeDesign = true
  const post = (type, payload) => parent.postMessage({ source: "redcode-design", v: 1, type, payload }, "*")

  const label = (el) => {
    const id = el.id ? "#" + el.id : ""
    const cls = (el.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0, 2)
    return (el.tagName.toLowerCase() + id + (cls.length ? "." + cls.join(".") : "")).slice(0, 200)
  }

  // A path a person can read and a model can find again. Ids short-circuit it; otherwise position
  // among siblings of the same tag, bounded so a deep tree cannot produce an essay.
  const selector = (el) => {
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && parts.length < 6 && node !== document.body) {
      if (node.id) { parts.unshift("#" + node.id); break }
      const tag = node.tagName.toLowerCase()
      const siblings = node.parentElement ? [...node.parentElement.children].filter((x) => x.tagName === node.tagName) : []
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")" : tag)
      node = node.parentElement
    }
    return parts.join(" > ").slice(0, 512)
  }

  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:auto 0 0 auto;z-index:2147483647"
  const root = host.attachShadow({ mode: "closed" })
  root.innerHTML = \`<style>
    :host { all: initial }
    .card { position: fixed; right: 12px; bottom: 12px; width: 280px; padding: 10px;
            font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; color: #111; background: #fff;
            border: 1px solid #0002; border-radius: 8px; box-shadow: 0 6px 24px #0002; display: none }
    .card[data-open] { display: block }
    .what { font-weight: 600; margin-bottom: 6px; word-break: break-all }
    textarea { width: 100%; min-height: 64px; font: inherit; padding: 6px; border: 1px solid #0003;
               border-radius: 6px; resize: vertical }
    .row { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px }
    button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid #0003;
             background: #fff; cursor: pointer }
    .hint { position: fixed; right: 12px; bottom: 12px; padding: 6px 10px; border-radius: 999px;
            font: 12px ui-sans-serif, system-ui, sans-serif; background: #111; color: #fff; opacity: .85 }
  </style>
  <div class="hint">alt-click anything to annotate</div>
  <div class="card"><div class="what"></div><textarea></textarea>
    <div class="row"><button data-cancel>Cancel</button><button data-add>Add note</button></div></div>\`
  document.documentElement.append(host)

  const card = root.querySelector(".card")
  const what = root.querySelector(".what")
  const area = root.querySelector("textarea")
  const hint = root.querySelector(".hint")
  let target = null

  const close = () => { card.removeAttribute("data-open"); hint.style.display = ""; area.value = ""; target = null }

  // Alt-click, so an ordinary click still exercises the prototype: reviewing an interactive thing
  // means being able to interact with it.
  document.addEventListener("click", (event) => {
    if (!event.altKey) return
    const el = event.target
    if (!el || el.nodeType !== 1 || host.contains(el)) return
    event.preventDefault()
    event.stopPropagation()
    target = { selector: selector(el), label: label(el), selection: String(getSelection() || "").slice(0, 2000) }
    what.textContent = target.label
    card.setAttribute("data-open", "")
    hint.style.display = "none"
    area.focus()
  }, true)

  root.querySelector("[data-cancel]").addEventListener("click", close)
  root.querySelector("[data-add]").addEventListener("click", () => {
    const text = area.value.trim()
    if (!text || !target) return close()
    post("annotate", { ...target, text })
    close()
  })
  area.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close()
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) root.querySelector("[data-add]").click()
  })

  post("ready", {})
})()`
}

/** Put the SDK in the document without disturbing what the model wrote. */
export function injectSDK(html: string) {
  const script = `<script>${sdkScript()}</script>`
  const head = html.match(/<head\b[^>]*>/i)
  if (head?.index !== undefined) {
    const at = head.index + head[0].length
    return html.slice(0, at) + script + html.slice(at)
  }
  const body = html.match(/<body\b[^>]*>/i)
  if (body?.index !== undefined) {
    const at = body.index + body[0].length
    return html.slice(0, at) + script + html.slice(at)
  }
  return script + html
}

export * as DesignSDK from "./sdk"
