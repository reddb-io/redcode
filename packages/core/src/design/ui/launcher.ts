export * as DesignLauncher from "./launcher.js"

import { appearance } from "./brand.gen.js"

export function page(input: {
  authenticated: boolean
  projects: readonly { sessionID: string; title: string; directory: string }[]
  reviews: readonly { title: string; url: string; directory: string }[]
}) {
  return shell(
    `${
      !input.authenticated
        ? `<p>Connect this browser to Redcode once with <code>redcode pair</code>, open the link it prints, then return to <a href="/design">/design</a>.</p>`
        : `<h2>Start a Design session</h2><p>Choose a project loaded in Redcode. The new session uses its current directory and model.</p>
    ${
      input.projects.length
        ? `<form>${input.projects.map((project, index) => `<label><input type="radio" name="source" value="${escape(project.sessionID)}" ${index === 0 ? "checked" : ""}><span>${escape(project.title)}<small>${escape(project.directory)}</small></span></label>`).join("")}<button type="submit">New Design session</button><p id="error" role="alert"></p></form>`
        : `<p>No project is loaded yet. Open a project in Redcode and <a href="/design">refresh this page</a>.</p>`
    }
    ${input.reviews.length ? `<h2>Continue a Design session</h2><ul>${input.reviews.map((review) => `<li><a href="${escape(review.url)}">${escape(review.title)}</a><small>${escape(review.directory)}</small></li>`).join("")}</ul>` : ""}`
    }`,
    `const form = root.querySelector('form');
  if (form) form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    root.getElementById('error').textContent = '';
    try {
      const response = await fetch('/design/new', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:new FormData(form).get('source')})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to start Design');
      location.assign(result.url);
    } catch (error) {
      root.getElementById('error').textContent = error instanceof Error ? error.message : 'Unable to start Design';
      button.disabled = false;
    }
  };`,
  )
}

/**
 * The page a review or presentation answers a browser with when it is not signed in: a review link that expired,
 * a cookie that lapsed, or a browser that never connected. It names every way back in; none of them needs the
 * Design session to restart. `retry` is the page's own address without its spent ticket.
 */
export function denied(input: { sessionID: string; retry: string; expired: boolean }) {
  return shell(`<h2>Sign in to this Design review</h2>
  <p>${
    input.expired
      ? "This review link has expired. A review link works for 10 minutes; the browser that opens it stays signed in while the review is in use."
      : "This browser is not signed in to Redcode."
  } The Design session is unaffected: nothing needs to restart.</p>
  <p>Get back in with any of these:</p>
  <ul>
  <li>Open the review from Redcode: the session's Design panel in the desktop or web app opens it signed in.</li>
  <li>Run <code>redcode design ${escape(input.sessionID)}</code> on the Redcode machine for a fresh link.</li>
  <li>Connect this browser once with <code>redcode pair</code>; review links then open here directly.</li>
  </ul>
  <p><a href="${escape(input.retry)}">Try again</a></p>`)
}

/** A Design entry page: the brand header over `body`, styled with the design system inside a shadow root. */
function shell(body: string, script = "") {
  const content = `<style>${appearance.css}</style><style>
  :host{display:block;color-scheme:light dark;min-height:100vh;background:var(--reddb-color-background);color:var(--reddb-color-foreground);font:14px/1.5 var(--reddb-font-family-sans,system-ui)}
  *{box-sizing:border-box}main{max-width:760px;margin:auto;padding:32px 24px}header{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--reddb-color-elevation-base-border);padding-bottom:20px}header img{width:24px;height:24px}h1{font-size:22px;margin:0}h2{font-size:16px;margin:28px 0 12px}p,small{color:var(--reddb-color-ink-muted)}small{display:block;overflow-wrap:anywhere}label{display:flex;align-items:flex-start;gap:12px;padding:14px 0;border-bottom:1px solid var(--reddb-color-elevation-base-border)}label span{min-width:0}button{margin-top:20px;padding:10px 16px;border:0;border-radius:var(--reddb-radius-md);background:var(--reddb-color-primary);color:var(--reddb-color-on-primary);font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:wait}a{color:var(--reddb-color-primary)}li{margin:12px 0}#error{color:var(--reddb-color-feedback-danger-foreground)}
  </style><main><header><img src="${appearance.favicon}" alt="RedDB"><h1>Design · Redcode</h1></header>
  ${body}
  </main>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Design · Redcode</title><link rel="icon" href="${appearance.favicon}"><style>body{margin:0}</style></head><body><div id="launcher"></div><script>
  const host = document.getElementById('launcher');
  host.dataset.theme = 'application';
  host.dataset.density = 'compact';
  host.dataset.colorScheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = ${JSON.stringify(content).replaceAll("<", "\\u003c")};
  ${script}
  </script></body></html>`
}

function escape(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
}
