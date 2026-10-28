import type { Page } from "@playwright/test"

export async function observeMicrophone(page: Page) {
  const observed = Promise.withResolvers<string | undefined>()
  await page.exposeBinding("reportMicrophone", (_, device: string | undefined) => observed.resolve(device))
  await page.evaluate(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints)
      const report = window as Window & { reportMicrophone?: (device: string | undefined) => void }
      report.reportMicrophone?.(stream.getAudioTracks()[0]?.getSettings().deviceId)
      return stream
    }
  })
  return { device: observed.promise }
}
