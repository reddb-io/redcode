export interface ExportWarning {
  readonly kind: string
  readonly ref: string
  readonly reason?: string
}

export interface BuildOptions {
  readonly baseDir?: string
  readonly confineDir?: string
  readonly readLocalFile?: (
    absPath: string,
    readOptions?: {
      allowOutsideRoot?: boolean
      maxAssetBytes?: number
      maxBundleBytes?: number
      maxBundleRemaining?: number
    },
  ) => Promise<Uint8Array>
  readonly resolveAbsolute?: (refPath: string) => string | null
  readonly maxAssetBytes?: number
  readonly maxBundleBytes?: number
  readonly maxDepth?: number
}

export function buildSelfContainedHtml(
  html: string,
  options?: BuildOptions,
): Promise<{ html: string; warnings: ExportWarning[] }>
export function exportFileName(file: string): string
export function splitExportWarnings(warnings: readonly ExportWarning[]): {
  unresolved: ExportWarning[]
  notices: ExportWarning[]
}
export function exportWarningSummaries(warnings: readonly ExportWarning[]): ExportWarning[]
