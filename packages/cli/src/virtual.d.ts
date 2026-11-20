declare module "virtual:opencode-app-assets" {
  /** Each web UI file by path, reading its Brotli-compressed bytes. */
  const archive: Readonly<Record<string, () => Uint8Array>>
  export default archive
}
