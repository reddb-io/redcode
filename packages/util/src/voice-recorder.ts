/** Local capture shared by the Desktop composer and the CLI's browser recorder. */
export class VoiceRecorder {
  private stream?: MediaStream
  private recorder?: MediaRecorder
  private context?: AudioContext
  private timer?: ReturnType<typeof setInterval>
  private limit?: ReturnType<typeof setTimeout>
  private chunks: Blob[] = []
  private completed?: Promise<Blob>

  async start(input: {
    signal: AbortSignal
    device?: string
    update: (value: { seconds: number; level: number }) => void
    finish: () => void
  }) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("unavailable")
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(input.device ? { deviceId: { exact: input.device } } : {}),
      },
      video: false,
    })
    if (input.signal.aborted) {
      stream.getTracks().forEach((track) => track.stop())
      throw new DOMException("Cancelled", "AbortError")
    }
    this.stream = stream
    input.signal.addEventListener("abort", () => this.cancel(), { once: true })
    try {
      this.context = new AudioContext()
      await this.context.resume()
      input.signal.throwIfAborted()
      const analyser = this.context.createAnalyser()
      analyser.fftSize = 256
      this.context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      const started = performance.now()
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      )
      this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      this.completed = new Promise<Blob>((resolve, reject) => {
        this.recorder!.ondataavailable = (event) => {
          if (event.data.size) this.chunks.push(event.data)
        }
        this.recorder!.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder?.mimeType }))
        this.recorder!.onerror = () => {
          this.releaseMicrophone()
          reject(new Error("capture"))
          input.finish()
        }
      })
      // Cancellation can happen without a caller waiting for the final audio.
      void this.completed.catch(() => undefined)
      stream.getAudioTracks().forEach((track) => {
        track.onended = input.finish
      })
      this.recorder.start(250)
      this.timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples)
        input.update({
          seconds: Math.floor((performance.now() - started) / 1000),
          level: Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) * 4),
        })
      }, 100)
      this.limit = setTimeout(input.finish, 300_000)
    } catch (error) {
      this.cancel()
      throw error
    }
  }

  async stop() {
    const context = this.context
    this.releaseMicrophone()
    try {
      const recording = await this.completed
      if (!recording?.size || !context) throw new Error("empty")
      const decoded = await context.decodeAudioData(await recording.arrayBuffer())
      const offline = new OfflineAudioContext(1, Math.min(4_800_000, Math.ceil(decoded.duration * 16_000)), 16_000)
      const source = offline.createBufferSource()
      source.buffer = decoded
      source.connect(offline.destination)
      source.start()
      const pcm = (await offline.startRendering()).getChannelData(0)
      const wav = new ArrayBuffer(44 + pcm.length * 2)
      const data = new DataView(wav)
      const ascii = (offset: number, value: string) =>
        Array.from(value).forEach((char, index) => data.setUint8(offset + index, char.charCodeAt(0)))
      ascii(0, "RIFF")
      data.setUint32(4, wav.byteLength - 8, true)
      ascii(8, "WAVE")
      ascii(12, "fmt ")
      data.setUint32(16, 16, true)
      data.setUint16(20, 1, true)
      data.setUint16(22, 1, true)
      data.setUint32(24, 16_000, true)
      data.setUint32(28, 32_000, true)
      data.setUint16(32, 2, true)
      data.setUint16(34, 16, true)
      ascii(36, "data")
      data.setUint32(40, pcm.length * 2, true)
      pcm.forEach((sample, index) => {
        const value = Math.max(-1, Math.min(1, sample))
        data.setInt16(44 + index * 2, value * (value < 0 ? 0x8000 : 0x7fff), true)
      })
      return new Blob([wav], { type: "audio/wav" })
    } finally {
      this.chunks = []
      this.context = undefined
      await context?.close().catch(() => undefined)
    }
  }

  cancel() {
    this.releaseMicrophone()
    this.chunks = []
    void this.context?.close().catch(() => undefined)
    this.context = undefined
  }

  private releaseMicrophone() {
    clearInterval(this.timer)
    clearTimeout(this.limit)
    if (this.recorder?.state === "recording") this.recorder.stop()
    this.stream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    this.stream = undefined
  }
}

export async function voiceAudioBase64(audio: Blob) {
  const data = new Uint8Array(await audio.arrayBuffer())
  return btoa(
    Array.from({ length: Math.ceil(data.length / 8192) }, (_, index) =>
      String.fromCharCode(...data.subarray(index * 8192, (index + 1) * 8192)),
    ).join(""),
  )
}
