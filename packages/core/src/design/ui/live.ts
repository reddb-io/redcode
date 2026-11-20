/// <reference lib="dom" />

/**
 * The microphone and camera of a design granted live use of them. The design's frame stays sandboxed without an
 * origin of its own, and browsers refuse devices to such a frame, so the trusted page that holds the frame
 * captures the device and forwards it over a MessagePort: audio as sample blocks, video as ImageBitmaps. Inside
 * the frame, getUserMedia answers with a MediaStream rebuilt from them, so MediaRecorder, Web Audio, <video>,
 * canvas and streaming clients work unchanged. Both functions are serialized on their own into their pages.
 */

export type LiveDevice = "microphone" | "camera" | "location"

/**
 * Runs in the trusted page: answers the frame's device requests while it shows the design. `frame` names the
 * window allowed to ask for a device, or nothing when the design was not granted it. The page owns each device:
 * while one is off a request for it waits, and turning it off ends every track of it the frame was given.
 */
export function liveHost(frame: (device: LiveDevice) => Window | null | undefined, on = true) {
  const state = { microphone: on, camera: on, location: on }
  const waiting = { microphone: new Set<MessagePort>(), camera: new Set<MessagePort>(), location: new Set<MessagePort>() }
  const open = {
    microphone: new Set<(ended: boolean) => void>(),
    camera: new Set<(ended: boolean) => void>(),
    location: new Set<(ended: boolean) => void>(),
  }
  const capture = (device: LiveDevice, port: MessagePort) => {
    if (device === "location") return locate(port)
    // Browsers offer no device to a page outside a secure context, such as one opened over plain http on the LAN.
    if (!navigator.mediaDevices) {
      port.postMessage({ error: "NotSupportedError" })
      return port.close()
    }
    void navigator.mediaDevices
      .getUserMedia(
        device === "microphone"
          ? { audio: { echoCancellation: true, noiseSuppression: true } }
          : { video: { width: { ideal: 640 }, height: { ideal: 480 } } },
      )
      .then(async (stream) => {
        const finish = device === "microphone" ? forwardAudio(stream, port) : await forwardVideo(stream, port)
        const stop = (ended: boolean) => {
          open[device].delete(stop)
          finish()
          for (const track of stream.getTracks()) track.stop()
          if (ended) port.postMessage("ended")
          port.close()
        }
        open[device].add(stop)
        port.onmessage = (message) => {
          if (message.data === "stop") stop(false)
        }
      })
      .catch((error: unknown) => {
        port.postMessage({ error: error instanceof DOMException ? error.name : "NotAllowedError" })
        port.close()
      })
  }
  /** Follows the computer's position for the frame until it stops or the presenter turns location off. */
  const locate = (port: MessagePort) => {
    if (!navigator.geolocation) {
      port.postMessage({ positionError: { code: 2, message: "Location is unavailable" } })
      return port.close()
    }
    const watch = navigator.geolocation.watchPosition(
      (position) =>
        port.postMessage({
          position: {
            coords: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              altitude: position.coords.altitude,
              altitudeAccuracy: position.coords.altitudeAccuracy,
              heading: position.coords.heading,
              speed: position.coords.speed,
            },
            timestamp: position.timestamp,
          },
        }),
      (error) => port.postMessage({ positionError: { code: error.code, message: error.message } }),
      { enableHighAccuracy: true },
    )
    const stop = (ended: boolean) => {
      open.location.delete(stop)
      navigator.geolocation.clearWatch(watch)
      if (ended) port.postMessage("ended")
      port.close()
    }
    open.location.add(stop)
    port.onmessage = (message) => {
      if (message.data === "stop") stop(false)
    }
  }
  const forwardAudio = (stream: MediaStream, port: MessagePort) => {
    const context = new AudioContext()
    const processor = context.createScriptProcessor(2048, 1, 1)
    processor.onaudioprocess = (audio) => {
      const samples = audio.inputBuffer.getChannelData(0).slice()
      port.postMessage(samples, [samples.buffer])
    }
    context.createMediaStreamSource(stream).connect(processor)
    processor.connect(context.destination)
    void context.resume()
    port.postMessage({ sampleRate: context.sampleRate })
    return () => void context.close()
  }
  const forwardVideo = async (stream: MediaStream, port: MessagePort) => {
    const video = document.createElement("video")
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    port.postMessage({ width: video.videoWidth || 640, height: video.videoHeight || 480 })
    const pending = { frame: false }
    // About 30 frames a second; a frame still being copied is not queued behind another.
    const timer = setInterval(() => {
      if (pending.frame || video.readyState < 2) return
      pending.frame = true
      void createImageBitmap(video)
        .then((bitmap) => port.postMessage(bitmap, [bitmap]))
        .catch(() => undefined)
        .finally(() => (pending.frame = false))
    }, 33)
    return () => {
      clearInterval(timer)
      video.srcObject = null
    }
  }
  addEventListener("message", (event) => {
    const device: unknown = event.data?.type === "design:media" ? event.data.device : undefined
    if (
      (device !== "microphone" && device !== "camera" && device !== "location") ||
      !event.ports[0] ||
      event.source !== frame(device)
    )
      return
    if (state[device]) return capture(device, event.ports[0])
    waiting[device].add(event.ports[0])
  })
  const stopAll = (device: LiveDevice, ended: boolean) => {
    for (const stop of [...open[device]]) stop(ended)
  }
  return {
    /** Turns a device on, answering every waiting request for it, or off, ending every track of it handed out. */
    set: (device: LiveDevice, value: boolean) => {
      state[device] = value
      if (!value) return stopAll(device, true)
      for (const port of [...waiting[device]]) capture(device, port)
      waiting[device].clear()
    },
    /** Forgets the frame's requests and captures; the page calls it when the frame loads another document. */
    release: () => {
      for (const device of ["microphone", "camera", "location"] as const) {
        for (const port of waiting[device]) port.close()
        waiting[device].clear()
        stopAll(device, false)
      }
    },
  }
}

/**
 * Runs first in the design's frame: getUserMedia for audio or video asks the trusted page, and so does the real
 * location, which the simulated device (./device) reaches through `__redcodeLocation` when no place is simulated.
 */
export function liveFrame() {
  Object.defineProperty(window, "__redcodeLocation", {
    value: {
      watch: (success: PositionCallback, failure: PositionErrorCallback) => {
        const channel = new MessageChannel()
        const fail = (code: number, message: string) =>
          failure({ code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
        channel.port1.onmessage = (event) => {
          if (event.data === "ended") return fail(2, "The presenter turned location off")
          if (event.data?.positionError) return fail(event.data.positionError.code, event.data.positionError.message)
          if (event.data?.position) {
            const coords = event.data.position.coords
            success({
              coords: { ...coords, toJSON: () => coords },
              timestamp: event.data.position.timestamp,
              toJSON: () => event.data.position,
            } as GeolocationPosition)
          }
        }
        parent.postMessage({ type: "design:media", device: "location" }, "*", [channel.port2])
        return () => {
          channel.port1.postMessage("stop")
          channel.port1.close()
        }
      },
    },
  })
  const devices = navigator.mediaDevices ?? {}
  if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: devices })
  /** One track of a device, rebuilt from what the trusted page forwards. */
  const request = (device: "microphone" | "camera") =>
    new Promise<MediaStreamTrack>((resolve, reject) => {
      const channel = new MessageChannel()
      const audio: Float32Array[] = []
      const video = { context: undefined as CanvasRenderingContext2D | null | undefined }
      // Set once the track exists: ends it when the presenter turns the device off.
      let ended: (() => void) | undefined
      channel.port1.onmessage = (event) => {
        if (event.data instanceof Float32Array) {
          // A second of audio at most waits for a consumer that stopped reading.
          if (audio.push(event.data) > 24) audio.shift()
          return
        }
        if (event.data instanceof ImageBitmap) {
          video.context?.drawImage(event.data, 0, 0)
          event.data.close()
          return
        }
        if (event.data === "ended") return ended?.()
        if (event.data?.error) {
          channel.port1.close()
          return reject(new DOMException(`The ${device} is unavailable`, event.data.error))
        }
        const built = device === "microphone" ? microphone(event.data.sampleRate) : camera(event.data)
        const track = built.track
        const stop = track.stop.bind(track)
        const close = () => {
          // A deck stops its tracks after the presenter ended them; that device is already released.
          if (track.readyState === "ended") return
          stop()
          built.close()
          channel.port1.close()
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
        resolve(track)
      }
      const microphone = (sampleRate: number) => {
        const context = new AudioContext({ sampleRate })
        const processor = context.createScriptProcessor(2048, 0, 1)
        const destination = context.createMediaStreamDestination()
        processor.onaudioprocess = (event) => {
          const output = event.outputBuffer.getChannelData(0)
          output.fill(0)
          const next = audio.shift()
          if (next) output.set(next.subarray(0, output.length))
        }
        processor.connect(destination)
        void context.resume()
        return { track: destination.stream.getAudioTracks()[0]!, close: () => void context.close() }
      }
      const camera = (size: { width: number; height: number }) => {
        const canvas = document.createElement("canvas")
        canvas.width = size.width
        canvas.height = size.height
        video.context = canvas.getContext("2d")
        return { track: canvas.captureStream(30).getVideoTracks()[0]!, close: () => (video.context = undefined) }
      }
      parent.postMessage({ type: "design:media", device }, "*", [channel.port2])
    })
  devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const wanted = [
      ...(constraints?.audio ? (["microphone"] as const) : []),
      ...(constraints?.video ? (["camera"] as const) : []),
    ]
    if (!wanted.length) throw new TypeError("getUserMedia needs audio or video")
    const results = await Promise.allSettled(wanted.map(request))
    const tracks = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    const failed = results.find((result) => result.status === "rejected")
    if (!failed) return new MediaStream(tracks)
    for (const track of tracks) track.stop()
    throw failed.reason
  }
}

export type LiveService = "systemOne" | "transcription"

/**
 * Runs in the trusted page: carries the frame's requests to the user's own Redcode connections, so the design never
 * holds a key. `frame` names the window allowed to use a service, or nothing when the design was not granted it;
 * `call` sends one request to the design's routes.
 */
export function liveAsk(
  frame: (service: LiveService) => Window | null | undefined,
  call: (service: LiveService, body: unknown) => Promise<Response>,
) {
  addEventListener("message", (event) => {
    const service: unknown = event.data?.type === "design:ask" ? event.data.service : undefined
    const port = event.ports[0]
    if ((service !== "systemOne" && service !== "transcription") || !port || event.source !== frame(service)) return
    void call(service, event.data.body)
      .then(async (response) => {
        const value: { message?: unknown } | undefined = await response.json().catch(() => undefined)
        port.postMessage(
          response.ok
            ? { result: value }
            : { error: typeof value?.message === "string" ? value.message : `Redcode answered ${response.status}` },
        )
      })
      .catch(() => port.postMessage({ error: "Redcode could not be reached" }))
      .finally(() => port.close())
  })
}

/**
 * Runs first in the design's frame: `window.redcode` asks System One about a text, transcribes a recording, and
 * transcribes the microphone as the presenter speaks, all through the trusted page and the user's connections.
 */
export function liveAskFrame() {
  const ask = (service: "systemOne" | "transcription", body: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = (event) => {
        channel.port1.close()
        if (event.data?.error !== undefined) return reject(new Error(String(event.data.error)))
        resolve(event.data?.result)
      }
      parent.postMessage({ type: "design:ask", service, body }, "*", [channel.port2])
    })
  /** 16 kHz mono 16-bit WAV, the recording dictation takes, as base64. */
  const wav = (samples: Float32Array, rate: number) => {
    const length = Math.floor((samples.length * 16000) / rate)
    const view = new DataView(new ArrayBuffer(44 + length * 2))
    const text = (offset: number, value: string) =>
      [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
    text(0, "RIFF")
    view.setUint32(4, 36 + length * 2, true)
    text(8, "WAVE")
    text(12, "fmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, 16000, true)
    view.setUint32(28, 32000, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, "data")
    view.setUint32(40, length * 2, true)
    for (const index of Array.from({ length }, (_, item) => item)) {
      // Linear interpolation between the two nearest source samples.
      const position = (index * rate) / 16000
      const before = samples[Math.floor(position)] ?? 0
      const after = samples[Math.min(samples.length - 1, Math.floor(position) + 1)] ?? before
      const value = Math.max(-1, Math.min(1, before + (after - before) * (position - Math.floor(position))))
      view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
    }
    const bytes = new Uint8Array(view.buffer)
    const chunks = Array.from({ length: Math.ceil(bytes.length / 0x8000) }, (_, index) =>
      String.fromCharCode(...bytes.subarray(index * 0x8000, (index + 1) * 0x8000)),
    )
    return btoa(chunks.join(""))
  }
  const transcribe = async (audio: Blob | Float32Array, sampleRate = 48000) => {
    const decoded =
      audio instanceof Float32Array
        ? { samples: audio, rate: sampleRate }
        : await new OfflineAudioContext(1, 1, 16000)
            .decodeAudioData(await audio.arrayBuffer())
            .then((buffer) => ({ samples: buffer.getChannelData(0), rate: buffer.sampleRate }))
    const result = (await ask("transcription", { audio: wav(decoded.samples, decoded.rate) })) as { text: string }
    return result.text
  }
  const decide = async (input: { text: string; questions: Record<string, unknown> }) =>
    ((await ask("systemOne", input)) as { answers: Record<string, unknown> }).answers
  const listen = (options: { seconds?: number; onText: (text: string) => void; onError?: (error: Error) => void }) => {
    const state = { stopped: false, blocks: [] as Float32Array[], stop: () => {} }
    const fail = (error: unknown) => options.onError?.(error instanceof Error ? error : new Error(String(error)))
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (state.stopped) return stream.getTracks().forEach((track) => track.stop())
        const context = new AudioContext()
        const processor = context.createScriptProcessor(4096, 1, 1)
        processor.onaudioprocess = (event) => void state.blocks.push(event.inputBuffer.getChannelData(0).slice())
        context.createMediaStreamSource(stream).connect(processor)
        processor.connect(context.destination)
        void context.resume()
        const timer = setInterval(
          () => {
            const blocks = state.blocks.splice(0)
            const samples = new Float32Array(blocks.reduce((total, block) => total + block.length, 0))
            blocks.reduce((offset, block) => (samples.set(block, offset), offset + block.length), 0)
            // Silence costs a request and transcribes to nothing.
            const loudness = Math.sqrt(samples.reduce((total, sample) => total + sample * sample, 0) / (samples.length || 1))
            if (loudness < 0.01) return
            void transcribe(samples, context.sampleRate)
              .then((text) => text.trim() && !state.stopped && options.onText(text.trim()))
              .catch(fail)
          },
          Math.min(30, Math.max(2, options.seconds ?? 4)) * 1000,
        )
        const track = stream.getAudioTracks()[0]
        track?.addEventListener("ended", () => fail(new Error("The microphone was turned off")))
        state.stop = () => {
          clearInterval(timer)
          stream.getTracks().forEach((item) => item.stop())
          void context.close()
        }
      })
      .catch(fail)
    return {
      stop: () => {
        state.stopped = true
        state.stop()
      },
    }
  }
  Object.defineProperty(window, "redcode", { value: Object.freeze({ decide, transcribe, listen }) })
}
