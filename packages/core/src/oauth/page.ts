// Branded HTML pages for local OAuth callback servers.
//
// These are served by the loopback HTTP servers that finish an OAuth exchange
// (MCP, Codex/ChatGPT, xAI, Snowflake, DigitalOcean, ...). The functions return
// a fully self-contained HTML string with no external assets, so they work
// offline and drop into any transport (`res.end(...)`, Effect `response.end`,
// etc.).
//
// The Application theme, fonts and Base Kit illustrations are embedded from the
// pinned Design System delivery, so the loopback page remains self-contained.

import { appearance, fonts } from "../design/ui/brand.gen.js"
import { illustrations } from "./illustrations.gen.js"

export interface CallbackPageOptions {
  /** Friendly integration name shown as a subtitle, e.g. "xAI", "Snowflake", "MCP". */
  provider?: string
  /** Attempt to close the window shortly after success. Defaults to true. */
  autoClose?: boolean
}

export function success(options?: CallbackPageOptions) {
  const provider = options?.provider
  return renderDocument({
    title: "Authorization successful",
    body: renderCard({
      status: "success",
      headline: "Authorization successful",
      message: provider ? `Redcode is now connected to ${escapeHtml(provider)}.` : "Redcode is now authorized.",
      footnote: "You can close this window.",
    }),
    script: options?.autoClose === false ? undefined : AUTO_CLOSE_SCRIPT,
  })
}

export function error(detail: string, options?: CallbackPageOptions) {
  const provider = options?.provider
  return renderDocument({
    title: "Authorization failed",
    body: renderCard({
      status: "error",
      headline: "Authorization failed",
      message: provider
        ? `Redcode couldn't finish connecting to ${escapeHtml(provider)}.`
        : "Redcode couldn't complete authorization.",
      detail,
      footnote: "Close this window and try again from Redcode.",
    }),
  })
}

export interface BootstrapOptions {
  /** Same-origin path the in-browser script POSTs the parsed callback to. */
  tokenPath: string
  provider?: string
}

// For flows where the credential arrives in the URL fragment (implicit grant),
// the browser must relay it back to the loopback server. This renders a pending
// page whose script reads the fragment, POSTs it to `tokenPath`, then resolves
// to the success or error state in place.
export function bootstrap(options: BootstrapOptions) {
  return renderDocument({
    title: "Finishing sign-in",
    body: renderCard({
      status: "pending",
      headline: "Finishing sign-in",
      message: options.provider
        ? `Completing your ${escapeHtml(options.provider)} authorization.`
        : "Completing authorization.",
      footnote: "You can close this window once sign-in finishes.",
    }),
    script: bootstrapScript(options),
  })
}

export * as OauthCallbackPage from "./page.js"

type Status = "pending" | "success" | "error"

function renderCard(input: { status: Status; headline: string; message: string; detail?: string; footnote: string }) {
  const detail = input.detail?.trim()
  return `<main class="page" id="oc-card" data-status="${input.status}" role="status" aria-live="polite">
      <div class="brand"><img src="${appearance.favicon}" alt="" /><span>redcode</span></div>
      <div class="content">
        <div class="illustration" aria-hidden="true">
          <span class="art art-pending">${illustrations.pending}</span>
          <span class="art art-success">${illustrations.success}</span>
          <span class="art art-error">${illustrations.error}</span>
        </div>
        <div class="eyebrow">Account connection</div>
        <h1 class="headline" id="oc-headline">${escapeHtml(input.headline)}</h1>
        <p class="message" id="oc-message">${input.message}</p>
        <pre class="detail" id="oc-detail"${detail ? "" : " hidden"}>${detail ? escapeHtml(detail) : ""}</pre>
        <p class="footnote" id="oc-footnote">${escapeHtml(input.footnote)}</p>
      </div>
    </main>`
}

function renderDocument(input: { title: string; body: string; script?: string }) {
  return `<!doctype html>
<html lang="en" data-theme="application" data-density="compact">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(input.title)} · Redcode</title>
    <link rel="icon" href="${appearance.favicon}" />
    <style>${appearance.css}\n${fonts}\n${STYLES}</style>
  </head>
  <body>
    ${input.body}${input.script ? `\n    <script>${input.script}</script>` : ""}
  </body>
</html>`
}

const AUTO_CLOSE_SCRIPT = `setTimeout(function(){try{window.close()}catch(e){}},2500)`

function bootstrapScript(options: BootstrapOptions) {
  return `var PROVIDER=${scriptString(options.provider ?? "")};
var TOKEN_URL=new URL(${scriptString(options.tokenPath)},window.location.origin).href;
(function(){
  var card=document.getElementById("oc-card"),headline=document.getElementById("oc-headline"),message=document.getElementById("oc-message"),detail=document.getElementById("oc-detail"),footnote=document.getElementById("oc-footnote");
  function fail(text){card.dataset.status="error";headline.textContent="Authorization failed";message.textContent=PROVIDER?("Redcode couldn't finish connecting to "+PROVIDER+"."):"Redcode couldn't complete authorization.";if(text){detail.textContent=text;detail.hidden=false}footnote.textContent="Close this window and try again from Redcode."}
  function ok(){card.dataset.status="success";headline.textContent="Authorization successful";message.textContent=PROVIDER?("Redcode is now connected to "+PROVIDER+"."):"Redcode is now authorized.";detail.hidden=true;footnote.textContent="You can close this window.";setTimeout(function(){try{window.close()}catch(e){}},2500)}
  try{
    var hash=new URLSearchParams((window.location.hash||"").slice(1));
    var search=new URLSearchParams(window.location.search||"");
    var err=hash.get("error")||search.get("error");
    var errDescription=hash.get("error_description")||search.get("error_description");
    var body=err?{error:err,error_description:errDescription||""}:{access_token:hash.get("access_token")||"",expires_in:hash.get("expires_in")||"0",state:hash.get("state")||""};
    fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(res){
      if(!res.ok)return res.text().catch(function(){return""}).then(function(t){throw new Error(t||("callback failed ("+res.status+")"))});
      if(err){fail(errDescription||err);return}
      ok();
    }).catch(function(e){fail(String(e&&e.message?e.message:e))});
  }catch(e){fail(String(e&&e.message?e.message:e))}
})()`
}

function scriptString(value: string) {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

// The browser chooses the OS color scheme; the embedded Application theme supplies all materials.
const STYLES = `
  :root { color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    :root[data-theme="application"] { --reddb-scheme-not-light: ; --reddb-scheme-not-dark: initial; }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--reddb-color-elevation-sunken-surface);
    color: var(--reddb-color-foreground);
    font-family: var(--reddb-font-family-sans);
    line-height: var(--reddb-line-height-normal);
    -webkit-font-smoothing: antialiased;
  }
  .page {
    width: min(100%, 32rem);
    background: var(--reddb-color-elevation-base-surface);
    border: 1px solid var(--reddb-color-elevation-base-border);
    border-radius: var(--reddb-radius-lg);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 18px 22px;
    border-bottom: 1px solid var(--reddb-color-elevation-base-border);
    color: var(--reddb-color-foreground);
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: -0.025em;
  }
  .brand img { width: 26px; height: 26px; border-radius: 4px; }
  .content { padding: 20px 32px 32px; text-align: center; }
  .illustration { width: min(100%, 240px); margin: 0 auto 12px; }
  .art { display: none; }
  .art svg { display: block; width: 100%; height: auto; }
  .page[data-status="pending"] .art-pending,
  .page[data-status="success"] .art-success,
  .page[data-status="error"] .art-error { display: block; }
  .eyebrow {
    margin-bottom: 8px;
    color: var(--reddb-color-ink-muted);
    font-size: var(--reddb-font-size-xs);
    font-weight: 600;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .headline { margin: 0; font-size: var(--reddb-font-size-2xl); font-weight: 600; line-height: 1.25; }
  .message { margin: 10px 0 0; color: var(--reddb-color-ink-muted); font-size: var(--reddb-font-size-sm); }
  .detail {
    margin: 20px 0 0;
    padding: 12px 14px;
    text-align: left;
    font-family: var(--reddb-font-family-mono);
    font-size: var(--reddb-font-size-xs);
    line-height: 1.55;
    color: var(--reddb-color-feedback-danger-foreground);
    background: var(--reddb-color-feedback-danger-surface);
    border: 1px solid var(--reddb-color-feedback-danger-border);
    border-radius: var(--reddb-radius-md);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 10rem;
    overflow: auto;
  }
  .detail[hidden] { display: none; }
  .footnote {
    margin: 24px 0 0;
    padding-top: 18px;
    border-top: 1px solid var(--reddb-color-elevation-base-border);
    color: var(--reddb-color-ink-muted);
    font-size: var(--reddb-font-size-xs);
  }
  @media (max-width: 420px) {
    body { padding: 16px; }
    .content { padding: 16px 20px 24px; }
    .illustration { width: min(100%, 200px); }
  }
`
