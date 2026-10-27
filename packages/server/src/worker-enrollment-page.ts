export const workerEnrollmentPage = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Join as a Redcode worker</title>
<style>
:root{color-scheme:light dark;font:15px/1.6 system-ui}body{max-width:620px;margin:10vh auto;padding:24px}
h1{font-size:26px}p{opacity:.8}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;border:1px solid #8886;border-radius:8px}
button{font:inherit;padding:8px 16px;border:1px solid #8886;border-radius:6px;cursor:pointer}
</style>
<h1>Join as a Redcode worker</h1>
<p>Run this command on the worker machine with Redcode installed. It will ask for a project directory and the worker address that the coordinator can reach.</p>
<pre id="command">This invitation link is incomplete.</pre><button id="copy" hidden>Copy command</button>
<p>The invitation expires after 10 minutes and works once. The coordinator checks the worker connection before adding it. Keep this link private.</p>
<p>Use a LAN address on your network, or HTTPS or a VPN address over the internet. Both machines must be able to reach each other. A local-only server needs to be configured for remote access first.</p>
<p id="status" role="status"></p>
<script>
const code = location.hash.slice(1)
if (/^[A-Za-z0-9_-]{43}$/.test(code) && /^[a-zA-Z0-9.:[\\]%-]+$/.test(location.hostname)) {
  const command = "redcode workers join '" + location.origin + "/auth/worker#" + code + "'"
  document.getElementById('command').textContent = command
  const copy = document.getElementById('copy')
  copy.hidden = false
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(command); document.getElementById('status').textContent = 'Command copied.' }
    catch { document.getElementById('status').textContent = 'Select and copy the command above.' }
  }
}
</script></html>`
