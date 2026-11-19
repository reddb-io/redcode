/// <reference lib="dom" />

/**
 * The microphone of a design granted live use of it. The design's frame stays sandboxed without an origin of its
 * own, and browsers refuse devices to such a frame, so the trusted page that holds the frame captures the
 * microphone and sends its samples over a MessagePort; inside the frame, getUserMedia answers with a MediaStream
 * rebuilt from them, so MediaRecorder, Web Audio and streaming clients work unchanged. Both functions are
 * serialized on their own into their pages.
 */

/** Runs in the trusted page: answers the frame's microphone requests while it shows the design. */
export function liveHost(frame: () => Window | null | undefined) {
  const open = new Set<() => void>()
  addEventListener("message", (event) => {
    if (event.source !== frame() || event.data?.type !== "design:microphone" || !event.ports[0]) return
    const port = event.ports[0]
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
        const stop = () => {
          open.delete(stop)
          for (const track of stream.getTracks()) track.stop()
          void context.close()
          port.close()
        }
        open.add(stop)
        port.onmessage = (message) => {
          if (message.data === "stop") stop()
        }
        void context.resume()
        port.postMessage({ sampleRate: context.sampleRate })
      })
      .catch((error: unknown) => {
        port.postMessage({ error: error instanceof DOMException ? error.name : "NotAllowedError" })
        port.close()
      })
  })
  /** Stops every capture; the page calls it when the frame loads another document. */
  return () => {
    for (const stop of [...open]) stop()
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
      channel.port1.onmessage = (event) => {
        if (event.data instanceof Float32Array) {
          // A second of audio at most waits for a consumer that stopped reading.
          if (queue.push(event.data) > 24) queue.shift()
          return
        }
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
        track.stop = () => {
          stop()
          channel.port1.postMessage("stop")
          channel.port1.close()
          void context.close()
        }
        resolve(destination.stream)
      }
      parent.postMessage({ type: "design:microphone" }, "*", [channel.port2])
    })
}
