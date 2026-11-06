/** Single-use Scribe connection. The server's API key never enters this client. */
export class VoiceRealtime {
  private socket?: WebSocket
  private committed: string[] = []
  private partial = ""
  private broken = false
  private finishing?: (complete: boolean) => void
  private pending?: Promise<boolean>
  private samples = 0
  private failure?: string

  constructor(private update: (text: string) => void) {}

  get text() {
    return [...this.committed, this.partial].filter(Boolean).join(" ")
  }

  async start(access: { token: string; url: string; language?: string }, signal: AbortSignal) {
    signal.throwIfAborted()
    const url = new URL(access.url)
    url.searchParams.set("model_id", "scribe_v2_realtime")
    url.searchParams.set("token", access.token)
    url.searchParams.set("audio_format", "pcm_16000")
    url.searchParams.set("commit_strategy", "manual")
    if (access.language) url.searchParams.set("language_code", access.language)
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      throw new Error(`Could not open the realtime WebSocket at ${url.origin}${url.pathname}. Check the endpoint and browser network policy.`)
    }
    this.socket = socket
    signal.addEventListener("abort", () => this.cancel(), { once: true })
    await new Promise<void>((resolve, reject) => {
      let ready = false
      const timeout = setTimeout(() => { this.broken = true; socket.close(); reject(new Error("Realtime connection timed out")) }, 15_000)
      socket.onmessage = (event) => {
        let message: { message_type?: string; text?: string }
        try { message = JSON.parse(String(event.data)) } catch { return }
        if (message.message_type === "session_started") {
          ready = true
          clearTimeout(timeout)
          resolve()
        } else if (message.message_type === "partial_transcript") {
          this.partial = typeof message.text === "string" ? message.text.trim() : ""
          this.update(this.text)
        } else if (message.message_type === "committed_transcript") {
          const text = typeof message.text === "string" ? message.text.trim() : ""
          if (text) this.committed.push(text)
          this.partial = ""
          this.update(this.text)
          this.finishing?.(true)
        } else if (message.message_type && /(?:error|exceeded|rate_limited|queue_overflow)/.test(message.message_type)) {
          this.broken = true
          const type = /^[a-z_]{1,80}$/.test(message.message_type) ? message.message_type : "provider_error"
          this.failure = `Realtime provider event: ${type}. Check API key permissions and quota.`
          if (!ready) { clearTimeout(timeout); reject(new Error(this.failure)) }
          this.finishing?.(false)
        }
      }
      socket.onerror = () => { this.broken = true; this.failure = `WebSocket connection to ${url.origin}${url.pathname} failed. The browser does not expose handshake status; check browser network logs, proxy, firewall and TLS.`; if (!ready) { clearTimeout(timeout); reject(new Error(this.failure)) }; this.finishing?.(false) }
      socket.onclose = (event) => { this.broken = true; this.failure ??= `WebSocket closed (code ${event.code}) at ${url.origin}${url.pathname}. Check network and provider access.`; if (!ready) { clearTimeout(timeout); reject(new Error(this.failure)) }; this.finishing?.(false) }
    })
    signal.throwIfAborted()
  }

  send(pcm: Uint8Array) {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN || this.broken) return
    if (socket.bufferedAmount > 1_000_000) { this.broken = true; this.failure = "Realtime audio queue overflowed; check network throughput."; socket.close(); return }
    let binary = ""
    for (const byte of pcm) binary += String.fromCharCode(byte)
    try {
      socket.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: btoa(binary), sample_rate: 16_000 }))
      this.samples += pcm.length / 2
      if (this.samples >= 80_000 && !this.pending) {
        this.samples = 0
        const pending = this.commit()
        this.pending = pending
        void pending.then((complete) => {
          if (!complete) this.broken = true
          if (this.pending === pending) this.pending = undefined
        })
      }
    } catch { this.broken = true; this.failure = "Realtime audio could not be sent over the WebSocket."; socket.close() }
  }

  private async commit(): Promise<boolean> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN || this.broken) return false
    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => { this.finishing = undefined; resolve(false) }, 5000)
      this.finishing = (value) => { clearTimeout(timeout); this.finishing = undefined; resolve(value) }
      try { socket.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: "", sample_rate: 16_000, commit: true })) }
      catch { this.finishing?.(false) }
    })
  }

  async finish(): Promise<{ text: string; complete: boolean; detail?: string }> {
    if (this.pending && !(await this.pending)) {
      const text = this.text
      this.cancel()
      return { text, complete: false, detail: this.failure ?? "Realtime segment confirmation timed out." }
    }
    const complete = await this.commit()
    const text = this.text
    this.cancel()
    return complete ? { text, complete } : { text, complete, detail: this.failure ?? "Realtime final confirmation timed out." }
  }

  cancel() {
    this.finishing?.(false)
    this.socket?.close()
    this.socket = undefined
  }
}
