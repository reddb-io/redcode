/** Only the app's top-level renderer can capture audio; camera and embedded content stay denied. */
export function allowsAudioCapture(input: { renderer: boolean; mainFrame: boolean; types?: readonly string[] }) {
  return input.renderer && input.mainFrame && !!input.types?.length && input.types.every((type) => type === "audio")
}
