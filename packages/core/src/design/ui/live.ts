/// <reference lib="dom" />

/**
 * The microphone of a design granted live use of it. The design's frame stays sandboxed without an origin of its
 * own, and browsers refuse devices to such a frame, so the trusted page that holds the frame captures the
 * microphone and sends its samples over a MessagePort; inside the frame, getUserMedia answers with a MediaStream
 * rebuilt from them, so MediaRecorder, Web Audio and streaming clients work unchanged. Both functions are
 * serialized on their own into their pages.
 */

/**
 * Runs in the trusted page: answers the frame's microphone requests while it shows the design. The page owns the
 * microphone: while it is off a request waits, and turning it off ends every track the frame was given.
 */
export function liveHost(frame: () => Window | null | undefined, on = true) {
  const state = { on }
  const waiting = new Set<MessagePort>()
  const open = new Set<(ended: boolean) => void>()
  const capture = (port: MessagePort) => {
    // Browsers offer no microphone to a page outside a secure context, such as one opened over plain http on the LAN.
    if (!navigator.mediaDevices) {
      port.postMessage({ error: "NotSupportedError" })
      return port.close()
    }
    void navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        const context = new AudioContext()
        const source = context.createMediaStreamSource(stream)
        const processor = context.createScriptProcessor(2048, 1, 1)
        processor.onaudioprocess = (audio) => {
          const samples = audio.inputBuffer.getChannelData(0).slice()
          port.postMessage(samples, [samples.buffer])
        }
        source.connect(processor)
        processor.connect(context.destination)
        const stop = (ended: boolean) => {
          open.delete(stop)
          for (const track of stream.getTracks()) track.stop()
          void context.close()
          if (ended) port.postMessage("ended")
          port.close()
        }
        open.add(stop)
        port.onmessage = (message) => {
          if (message.data === "stop") stop(false)
        }
        void context.resume()
        port.postMessage({ sampleRate: context.sampleRate })
      })
      .catch((error: unknown) => {
        port.postMessage({ error: error instanceof DOMException ? error.name : "NotAllowedError" })
        port.close()
      })
  }
  addEventListener("message", (event) => {
    if (event.source !== frame() || event.data?.type !== "design:microphone" || !event.ports[0]) return
    if (state.on) return capture(event.ports[0])
    waiting.add(event.ports[0])
  })
  const stopAll = (ended: boolean) => {
    for (const stop of [...open]) stop(ended)
  }
  return {
    /** Turns the microphone on, answering every waiting request, or off, ending every track handed out. */
    set: (value: boolean) => {
      state.on = value
      if (!value) return stopAll(true)
      for (const port of [...waiting]) capture(port)
      waiting.clear()
    },
    /** Forgets the frame's requests and captures; the page calls it when the frame loads another document. */
    release: () => {
      for (const port of waiting) port.close()
      waiting.clear()
      stopAll(false)
    },
  }
}

/** Runs first in the design's frame: getUserMedia for audio asks the trusted page. */
export function liveFrame() {
  const devices = navigator.mediaDevices ?? {}
  if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: devices })
  devices.getUserMedia = (constraints?: MediaStreamConstraints) =>
    new Promise<MediaStream>((resolve, reject) => {
      if (!constraints?.audio || constraints.video)
        return reject(new DOMException("Only the microphone is available to this design", "NotAllowedError"))
      const channel = new MessageChannel()
      const queue: Float32Array[] = []
      // Set once the track exists: ends it when the presenter turns the microphone off.
      let ended: (() => void) | undefined
      channel.port1.onmessage = (event) => {
        if (event.data instanceof Float32Array) {
          // A second of audio at most waits for a consumer that stopped reading.
          if (queue.push(event.data) > 24) queue.shift()
          return
        }
        if (event.data === "ended") return ended?.()
        if (event.data?.error) {
          channel.port1.close()
          return reject(new DOMException("The microphone is unavailable", event.data.error))
        }
        const context = new AudioContext({ sampleRate: event.data.sampleRate })
        const processor = context.createScriptProcessor(2048, 0, 1)
        const destination = context.createMediaStreamDestination()
        processor.onaudioprocess = (audio) => {
          const output = audio.outputBuffer.getChannelData(0)
          output.fill(0)
          const next = queue.shift()
          if (next) output.set(next.subarray(0, output.length))
        }
        processor.connect(destination)
        void context.resume()
        const track = destination.stream.getAudioTracks()[0]!
        const stop = track.stop.bind(track)
        const close = () => {
          stop()
          channel.port1.close()
          void context.close()
        }
        track.stop = () => {
          channel.port1.postMessage("stop")
          close()
        }
        // The track ends the way one does when its device goes away.
        ended = () => {
          close()
          track.dispatchEvent(new Event("ended"))
        }
        resolve(destination.stream)
      }
      parent.postMessage({ type: "design:microphone" }, "*", [channel.port2])
    })
}
