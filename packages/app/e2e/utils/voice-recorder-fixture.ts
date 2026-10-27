import { startVoiceCapture } from "../../../tui/src/util/voice-capture"

const recorder = startVoiceCapture({
  signal: new AbortController().signal,
  transcribe: async (audio) => {
    const wav = Buffer.from(audio, "base64")
    if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.readUInt32LE(24) !== 16_000 || wav.length < 32_044)
      throw new Error("Invalid captured WAV")
    return "spoken from the CLI recorder"
  },
  accept: (text) => {
    process.stdout.write(JSON.stringify({ accepted: text }) + "\n")
    return true
  },
})
process.stdout.write(JSON.stringify({ url: recorder.url }) + "\n")
await recorder.result
