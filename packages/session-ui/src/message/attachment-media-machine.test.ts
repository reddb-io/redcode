import { describe, expect, test } from "bun:test"
import type { PromptAttachment } from "@opencode/client/promise"
import {
  ATTACHMENT_MEDIA_TIMEOUT_MS,
  DISPOSED_ATTACHMENT_MEDIA_EVENT,
  INITIAL_ATTACHMENT_MEDIA_STATE,
  resolveAttachmentMediaTarget,
  transitionAttachmentMedia,
  viewAttachmentMedia,
  type AttachmentMediaEvent,
  type AttachmentMediaState,
} from "./attachment-media-machine"

const hashA = `media:${"a".repeat(64)}`
const hashB = `media:${"b".repeat(64)}`

function media(uri: string, mime = "image/png"): PromptAttachment {
  return { mime, source: { type: "inline" }, name: "screenshot.png", uri } as PromptAttachment
}

const reader = { hasReader: true }
const targetA = resolveAttachmentMediaTarget(media(hashA), reader)
const targetB = resolveAttachmentMediaTarget(media(hashB), reader)

function replay(events: AttachmentMediaEvent[], state = INITIAL_ATTACHMENT_MEDIA_STATE) {
  return events.reduce<AttachmentMediaState>((current, event) => transitionAttachmentMedia(current, event).state, state)
}

const readyA = replay([
  { type: "target.synced", target: targetA },
  { type: "read.succeeded", attempt: 1, src: "blob:a" },
])

describe("transitionAttachmentMedia", () => {
  test("reads a media reference with a bounded timeout", () => {
    const next = transitionAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, { type: "target.synced", target: targetA })
    expect(next.effects).toEqual([
      { type: "read", attempt: 1, uri: hashA, mime: "image/png", timeoutMs: ATTACHMENT_MEDIA_TIMEOUT_MS },
    ])
    expect(viewAttachmentMedia(next.state, targetA)).toMatchObject({ status: "loading", placeholder: true })
    expect(viewAttachmentMedia(readyA, targetA)).toMatchObject({ status: "ready", src: "blob:a", clickable: true })
  })

  test("switching slots never shows the previous image and ignores its completion", () => {
    expect(viewAttachmentMedia(readyA, targetB).src).toBeUndefined()
    const loadingA = transitionAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, {
      type: "target.synced",
      target: targetA,
    }).state
    const switched = transitionAttachmentMedia(loadingA, { type: "target.synced", target: targetB })
    expect(switched.effects[0]).toEqual({ type: "cancel" })
    const stale = transitionAttachmentMedia(switched.state, { type: "read.succeeded", attempt: 1, src: "blob:a" })
    expect(stale.state).toBe(switched.state)
    expect(viewAttachmentMedia(stale.state, targetB).status).toBe("loading")
  })

  for (const failure of [
    { type: "read.failed", attempt: 1 },
    { type: "read.succeeded", attempt: 1, src: "" },
    { type: "read.timed-out", attempt: 1 },
  ] as const) {
    test(`${failure.type} settles as failed and supports retry`, () => {
      const settled = transitionAttachmentMedia(
        transitionAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, { type: "target.synced", target: targetA }).state,
        failure,
      )
      expect(settled.effects).toEqual([{ type: "cancel" }])
      expect(viewAttachmentMedia(settled.state, targetA)).toMatchObject({ status: "failed", canRetry: true })
      const retry = transitionAttachmentMedia(settled.state, { type: "retry.requested", target: targetA })
      expect(retry.effects).toEqual([
        { type: "read", attempt: 2, uri: hashA, mime: "image/png", timeoutMs: ATTACHMENT_MEDIA_TIMEOUT_MS },
      ])
    })
  }

  test("a media ref without a reader is failed but not clickable", () => {
    const target = resolveAttachmentMediaTarget(media(hashA), { hasReader: false })
    expect(viewAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, target)).toMatchObject({
      status: "failed",
      clickable: false,
      canRetry: false,
    })
  })

  test("inline, direct, cached and non-image attachments read nothing", () => {
    const inline: PromptAttachment = { mime: "image/png", source: { type: "inline" }, data: "AAAA" }
    const direct: PromptAttachment = { mime: "image/png", source: { type: "uri", uri: "blob:x" }, data: "" }
    const cached = resolveAttachmentMediaTarget(media(hashA), { hasReader: true, peekMedia: () => "blob:cached" })
    expect(resolveAttachmentMediaTarget(inline, reader)).toEqual({ kind: "direct", src: "data:image/png;base64,AAAA" })
    expect(resolveAttachmentMediaTarget(direct, reader)).toEqual({ kind: "direct", src: "blob:x" })
    expect(cached).toEqual({ kind: "direct", src: "blob:cached" })
    expect(resolveAttachmentMediaTarget(media(hashA, "application/pdf"), reader)).toEqual({ kind: "none" })
  })

  test("disposing cancels the active read and ignores later completion", () => {
    const loading = transitionAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, {
      type: "target.synced",
      target: targetA,
    }).state
    const disposed = transitionAttachmentMedia(loading, DISPOSED_ATTACHMENT_MEDIA_EVENT)
    expect(disposed.effects).toEqual([{ type: "cancel" }])
    expect(transitionAttachmentMedia(disposed.state, { type: "read.succeeded", attempt: 1, src: "blob:a" })).toEqual({
      state: disposed.state,
      effects: [],
    })
  })
})
