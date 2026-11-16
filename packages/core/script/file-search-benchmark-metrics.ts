/** Windows process counters include every native FFF thread and allocation. */
import { dlopen, FFIType, ptr } from "bun:ffi"

const library = dlopen("kernel32.dll", {
  OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
  CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  GetProcessTimes: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  QueryProcessCycleTime: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.ptr },
  Thread32First: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  Thread32Next: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  K32GetProcessMemoryInfo: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
})

export function openProcessMetrics(pid: number) {
  if (process.arch !== "x64" && process.arch !== "arm64") throw new Error("Windows metrics require a 64-bit process")
  const handle = library.symbols.OpenProcess(0x410, 0, pid)
  if (!handle) return
  const times = Array.from({ length: 4 }, () => Buffer.alloc(8))
  // DWORD cb, DWORD faults, then nine 64-bit SIZE_T fields.
  const counters = Buffer.alloc(80)
  const cycleCounter = Buffer.alloc(8)
  counters.writeUInt32LE(counters.length)
  return {
    cpu() {
      if (!library.symbols.GetProcessTimes(handle, ptr(times[0]!), ptr(times[1]!), ptr(times[2]!), ptr(times[3]!)))
        throw new Error(`GetProcessTimes failed for benchmark PID ${pid}`)
      return { user: Number(times[3]!.readBigUInt64LE()) / 10, system: Number(times[2]!.readBigUInt64LE()) / 10 }
    },
    cycles() {
      if (!library.symbols.QueryProcessCycleTime(handle, ptr(cycleCounter)))
        throw new Error(`QueryProcessCycleTime failed for benchmark PID ${pid}`)
      return cycleCounter.readBigUInt64LE()
    },
    threads() {
      const snapshot = library.symbols.CreateToolhelp32Snapshot(4, 0)
      if (!snapshot) return null
      const entry = Buffer.alloc(28)
      entry.writeUInt32LE(entry.length)
      try {
        if (!library.symbols.Thread32First(snapshot, ptr(entry))) return null
        let count = 0
        do {
          if (entry.readUInt32LE(12) === pid) count++
          entry.writeUInt32LE(entry.length)
        } while (library.symbols.Thread32Next(snapshot, ptr(entry)))
        return count
      } finally {
        library.symbols.CloseHandle(snapshot)
      }
    },
    memory() {
      if (!library.symbols.K32GetProcessMemoryInfo(handle, ptr(counters), counters.length))
        return { workingSet: null, peakWorkingSet: null, privateCommitted: null, peakPrivateCommitted: null }
      return {
        workingSet: Number(counters.readBigUInt64LE(16)),
        peakWorkingSet: Number(counters.readBigUInt64LE(8)),
        privateCommitted: Number(counters.readBigUInt64LE(72)),
        peakPrivateCommitted: Number(counters.readBigUInt64LE(64)),
      }
    },
    close() {
      library.symbols.CloseHandle(handle)
    },
  }
}
