import { app, webContents } from "electron"
import { readFile } from "node:fs/promises"

/** Current process samples; Linux RSS comes from procfs because Electron omits it there. */
export async function sampleDesktopMemory() {
  const contents = webContents
    .getAllWebContents()
    .filter((contents) => !contents.isDestroyed())
    .map((contents) => ({ id: contents.id, type: contents.getType(), pid: contents.getOSProcessId() }))

  return Promise.all(
    app.getAppMetrics().map(async (metric) => {
      const status =
        process.platform === "linux"
          ? await readFile(`/proc/${metric.pid}/status`, "utf8").catch(() => undefined)
          : undefined
      const rss = status?.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]
      const swap = status?.match(/^VmSwap:\s+(\d+)\s+kB$/m)?.[1]

      return {
        pid: metric.pid,
        createdAt: metric.creationTime,
        type: metric.type,
        residentBytes:
          process.platform === "linux"
            ? rss === undefined
              ? null
              : Number(rss) * 1024
            : metric.memory?.workingSetSize == null
              ? null
              : metric.memory.workingSetSize * 1024,
        swapBytes: swap === undefined ? null : Number(swap) * 1024,
        cpuPercent: metric.cpu.percentCPUUsage,
        contents: contents.filter((contents) => contents.pid === metric.pid),
      }
    }),
  )
}
