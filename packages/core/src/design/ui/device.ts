/// <reference lib="dom" />

import type { Design } from "@opencode/schema/design"

/**
 * The simulated device a prototype runs on: battery, network, location, tilt and shake, the clock and vibration,
 * read through the browser's own APIs (navigator.getBattery, navigator.onLine and connection, fetch,
 * navigator.geolocation, deviceorientation and devicemotion, Date, navigator.vibrate). Runs first in the design's
 * frame and in the audit's page. The state starts as `window.__redcodeDevice`, which the review and the audit set
 * before the prototype's scripts, and changes with a `design:device` message; a `design:device-shake` message
 * shakes the device. Without a state the device is a charged, online phone at the real time and place it was
 * granted, or none. Serialized on its own into the page.
 */
export function simulate() {
  const HANDLE = "__redcodeSimulated"
  if (Object.prototype.hasOwnProperty.call(window, HANDLE)) return
  Object.defineProperty(window, HANDLE, { value: true })
  const global = window as unknown as {
    __redcodeDevice?: Design.DeviceState | null
    __redcodeLocation?: {
      watch: (success: (position: GeolocationPosition) => void, failure: (error: GeolocationPositionError) => void) => () => void
    }
  }
  const RealDate = Date
  const state = { device: {} as Design.DeviceState, offset: 0 }

  // Clock: Date without arguments and Date.now answer the simulated time, which keeps running.
  function SimulatedDate(this: unknown, ...args: ConstructorParameters<DateConstructor>) {
    if (!new.target) return new RealDate(RealDate.now() + state.offset).toString()
    return args.length ? new RealDate(...args) : new RealDate(RealDate.now() + state.offset)
  }
  SimulatedDate.prototype = RealDate.prototype
  Object.assign(SimulatedDate, {
    now: () => RealDate.now() + state.offset,
    parse: RealDate.parse,
    UTC: RealDate.UTC,
  })
  window.Date = SimulatedDate as unknown as DateConstructor

  // Battery: always the simulated phone's, never the laptop's.
  const battery = Object.assign(new EventTarget(), {
    onchargingchange: null as ((event: Event) => void) | null,
    onlevelchange: null as ((event: Event) => void) | null,
    onchargingtimechange: null,
    ondischargingtimechange: null,
  })
  Object.defineProperties(battery, {
    level: { get: () => state.device.battery?.level ?? 1 },
    charging: { get: () => state.device.battery?.charging ?? true },
    chargingTime: { get: () => ((state.device.battery?.charging ?? true) ? 0 : Infinity) },
    dischargingTime: { get: () => ((state.device.battery?.charging ?? true) ? Infinity : 3600 * 6) },
  })
  const fire = (target: EventTarget & Record<string, unknown>, type: string) => {
    const event = new Event(type)
    target.dispatchEvent(event)
    const handler = target[`on${type}`]
    if (typeof handler === "function") handler.call(target, event)
  }
  Object.defineProperty(navigator, "getBattery", { configurable: true, value: () => Promise.resolve(battery) })

  // Network: offline fails fetch the way a dropped connection does; slow delays it.
  const connection = Object.assign(new EventTarget(), { onchange: null })
  const slow = () => state.device.network === "slow"
  Object.defineProperties(connection, {
    effectiveType: { get: () => (slow() ? "3g" : "4g") },
    downlink: { get: () => (slow() ? 0.4 : 10) },
    rtt: { get: () => (slow() ? 400 : 50) },
    saveData: { get: () => false },
  })
  const nativeOnline = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine")?.get
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => (state.device.network ? state.device.network !== "offline" : (nativeOnline?.call(navigator) ?? true)),
  })
  Object.defineProperty(navigator, "connection", { configurable: true, value: connection })
  const nativeFetch = window.fetch.bind(window)
  window.fetch = Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      if (state.device.network === "offline") throw new TypeError("Failed to fetch")
      if (slow()) await new Promise((resolve) => setTimeout(resolve, 1500))
      return nativeFetch(...args)
    },
    { preconnect: window.fetch.preconnect },
  )

  // Location: the simulated place, else the real one when the design was granted it, else refused.
  const failure = (code: number, message: string) =>
    ({ code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) as GeolocationPositionError
  const position = (place: NonNullable<Design.DeviceState["location"]>) => {
    const coords = {
      latitude: place.latitude,
      longitude: place.longitude,
      accuracy: place.accuracy ?? 10,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    }
    const timestamp = RealDate.now() + state.offset
    return { coords: { ...coords, toJSON: () => coords }, timestamp, toJSON: () => ({ coords, timestamp }) } as unknown as GeolocationPosition
  }
  const watchers = new Map<number, { success: PositionCallback; failure?: PositionErrorCallback | null; stop?: () => void }>()
  const counter = { next: 1 }
  const follow = (id: number) => {
    const watcher = watchers.get(id)
    if (!watcher) return
    watcher.stop?.()
    watcher.stop = undefined
    const place = state.device.location
    if (place) return void setTimeout(() => watchers.get(id) === watcher && watcher.success(position(place)))
    if (global.__redcodeLocation)
      return void (watcher.stop = global.__redcodeLocation.watch(watcher.success, (error) => watcher.failure?.(error)))
    setTimeout(() => watcher.failure?.(failure(1, "User denied Geolocation")))
  }
  const geolocation = {
    getCurrentPosition: (success: PositionCallback, error?: PositionErrorCallback | null) => {
      const id = geolocation.watchPosition(
        (value) => {
          geolocation.clearWatch(id)
          success(value)
        },
        (value) => {
          geolocation.clearWatch(id)
          error?.(value)
        },
      )
    },
    watchPosition: (success: PositionCallback, error?: PositionErrorCallback | null) => {
      const id = counter.next++
      watchers.set(id, { success, failure: error })
      follow(id)
      return id
    },
    clearWatch: (id: number) => {
      watchers.get(id)?.stop?.()
      watchers.delete(id)
    },
  }
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: geolocation })

  // Vibration: the review shows it, since the computer cannot.
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    value: (pattern: VibratePattern) => {
      if (parent !== window) parent.postMessage({ type: "design:vibrate", pattern }, "*")
      return true
    },
  })

  const tilt = () => {
    const orientation = state.device.orientation
    if (!orientation || typeof DeviceOrientationEvent !== "function") return
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { ...orientation, absolute: false }))
  }
  const shake = () => {
    if (typeof DeviceMotionEvent !== "function") return
    // A few strong jolts, the pattern shake detectors look for.
    for (const [index, x] of [18, -18, 18, -18, 12, -12].entries())
      setTimeout(
        () =>
          window.dispatchEvent(
            new DeviceMotionEvent("devicemotion", {
              acceleration: { x, y: 0, z: 0 },
              accelerationIncludingGravity: { x, y: 0, z: 9.8 },
              rotationRate: { alpha: 0, beta: 0, gamma: 0 },
              interval: 16,
            }),
          ),
        index * 80,
      )
  }

  /** Takes a new state, telling the prototype what changed the way the real APIs do. */
  const apply = (next: Design.DeviceState) => {
    const before = state.device
    state.device = next
    state.offset = next.clock ? RealDate.parse(next.clock) - RealDate.now() : 0
    if (before.battery?.level !== next.battery?.level) fire(battery as never, "levelchange")
    if (before.battery?.charging !== next.battery?.charging) fire(battery as never, "chargingchange")
    if (before.network !== next.network) {
      const online = next.network !== "offline"
      if ((before.network !== "offline") !== online) window.dispatchEvent(new Event(online ? "online" : "offline"))
      fire(connection as never, "change")
    }
    if (JSON.stringify(before.location) !== JSON.stringify(next.location)) for (const id of watchers.keys()) follow(id)
    if (JSON.stringify(before.orientation) !== JSON.stringify(next.orientation)) tilt()
  }
  // The review sets the state before this runs; the audit's init scripts set it after, before the prototype's own.
  const initial = global.__redcodeDevice
  Object.defineProperty(window, "__redcodeDevice", {
    configurable: true,
    get: () => state.device,
    set: (value: Design.DeviceState | null | undefined) => apply(value ?? {}),
  })
  apply(initial ?? {})
  addEventListener("load", tilt)
  addEventListener("message", (event) => {
    if (event.source !== parent || parent === window) return
    if (event.data?.type === "design:device" && event.data.state && typeof event.data.state === "object")
      apply(event.data.state)
    if (event.data?.type === "design:device-shake") shake()
  })
}
