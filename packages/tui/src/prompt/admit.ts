// Sending a prompt is its admission, not its turn.
//
// `prompt_async` answers once the server has durably admitted the prompt to the session inbox; the
// turn runs detached. The long request that waited for the whole turn could fail after the prompt
// had landed, and the person, told "Failed to send prompt", sent it again as a second prompt.
//
// Every submit names its own message ID, and a retry sends the same one: the server treats a repeat
// of an admitted ID with the same content as the same request, so a response lost after admission
// never becomes a second copy. Only failures that can be transient are retried (no response at all,
// a timeout, rate limiting, a server error); a refusal is final at once.

import { SessionV1 } from "@reddb-io/redcode-schema/v1/session"

export type AdmitResponse = { error?: unknown; response?: { status: number } }

export type AdmitOutcome = { ok: true; messageID: string } | { ok: false; messageID: string; error: unknown }

/** Waits before each retry; the first attempt goes at once. */
export const RETRY_DELAYS = [250, 1000, 3000]

export async function admitPrompt(input: {
  send: (messageID: string) => Promise<AdmitResponse>
  messageID?: string
  delays?: readonly number[]
  sleep?: (ms: number) => Promise<void>
}): Promise<AdmitOutcome> {
  const messageID = input.messageID ?? SessionV1.MessageID.ascending()
  const delays = input.delays ?? RETRY_DELAYS
  const sleep = input.sleep ?? ((ms: number) => Bun.sleep(ms))
  const attempt = async (index: number): Promise<AdmitOutcome> => {
    const result = await input.send(messageID).catch((error: unknown): AdmitResponse => ({ error }))
    if (result.error === undefined) return { ok: true, messageID }
    const delay = delays[index]
    if (delay === undefined || !transient(result)) return { ok: false, messageID, error: result.error }
    await sleep(delay)
    return attempt(index + 1)
  }
  return attempt(0)
}

/** Whether a failed send may succeed if sent again unchanged. */
export function transient(result: AdmitResponse) {
  const status = result.response?.status
  if (status === undefined) return true
  return status === 408 || status === 429 || status >= 500
}
