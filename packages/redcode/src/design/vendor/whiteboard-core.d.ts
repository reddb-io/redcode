export const WHITEBOARD_PROMPT_TAG: "whiteboard"
export const EXCALIDRAW_SCENE_TARGET_TYPE: "excalidraw-scene"
export const WHITEBOARD_TEXT_METRICS_VERSION: number
export const SUMMARY_MAX_LINES: number
export const SUMMARY_MAX_LINE_CHARS: number

export interface SceneStats {
  added: number
  removed: number
  moved: number
  relabeled: number
  drawn: number
}

export interface ExcalidrawSceneTarget {
  type: "excalidraw-scene"
  diagramIndex: number
  diagramId: string
  sourceHash: string
  scenePath: string
  previewPath: string
  imageFallback: boolean
  stats: SceneStats
}

export function sanitizeWhiteboardAppState(appState: unknown): Record<string, unknown>
export function sanitizeWhiteboardScene<T>(scene: T): T
export function normalizeMermaidLabelLineBreaks(text: string): string
export function restoreMermaidLabelLineBreaks(
  elements: unknown[],
  adapters?: { measure?: (element: unknown) => { width: number; height: number } },
): unknown[]
export function sanitizeSceneLink(url: unknown): string
export function sceneIsImageFallback(elements: unknown): boolean
export function findDuplicateElementIds(elements: unknown): string[]
export function convertExcalidrawSkeletonsAfterFontsLoad<T, E>(
  skeletons: T[],
  adapters: { convert: (skeletons: T[]) => E[]; loadFonts: (elements: E[]) => Promise<unknown> },
): Promise<E[]>
export function repairSavedSceneTextMetrics<E>(
  elements: E[],
  adapters: { measure: (element: E) => { width: number; height: number } },
): { elements: E[]; repaired: number }
export function createWhiteboardPersistencePayload(
  state: unknown,
  scene: unknown,
): { sourceHash: string; textMetricsVersion: number; scene: unknown; baseline: { elements: unknown[] } }
export function savedSceneHasPreservableEdits(saved: unknown): boolean
export function resolveWhiteboardInitAction(saved: unknown, currentSourceHash: string): "convert" | "restore" | "prompt"
export function summarizeSceneEdits(
  baselineElements: unknown,
  editedElements: unknown,
  options?: { maxLines?: number },
): { lines: string[]; stats: SceneStats; totalChanges: number }
export function normalizeExcalidrawSceneTarget(target: Record<string, unknown>): ExcalidrawSceneTarget
