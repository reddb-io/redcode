/** Coordinate a user-requested service worker update across controlled windows. */
export function startWebUpdate(input: { ready: (apply: () => void) => void; beforeReload?: () => void }) {
  if (!("serviceWorker" in navigator)) return () => {}
  const service = navigator.serviceWorker
  let disposed = false
  let controlled = !!service.controller
  let notified: ServiceWorker | null = null
  let registration: ServiceWorkerRegistration | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let checking = false
  let checkedAt = 0
  const watched = new Set<ServiceWorker>()
  const reload = () => {
    if (!controlled) {
      controlled = true
      return
    }
    try {
      input.beforeReload?.()
    } finally {
      window.location.reload()
    }
  }
  const show = () => {
    const worker = registration?.waiting
    if (!worker || !service.controller || notified === worker || disposed) return
    notified = worker
    input.ready(() => registration?.waiting?.postMessage({ type: "SKIP_WAITING" }))
  }
  const observe = () => {
    const worker = registration?.installing
    if (worker && !watched.has(worker)) {
      watched.add(worker)
      worker.addEventListener("statechange", show)
    }
    show()
  }
  const check = () => {
    if (!registration || checking || document.visibilityState === "hidden" || !navigator.onLine) return
    if (Date.now() - checkedAt < 60_000) return
    checkedAt = Date.now()
    checking = true
    void registration
      .update()
      .catch(() => {})
      .finally(() => {
        checking = false
      })
  }
  const visible = () => {
    if (document.visibilityState === "visible") check()
  }
  service.addEventListener("controllerchange", reload)
  window.addEventListener("online", check)
  document.addEventListener("visibilitychange", visible)
  void service
    .register("/sw.js")
    .then((value) => {
      if (disposed) return
      registration = value
      value.addEventListener("updatefound", observe)
      observe()
      check()
      timer = setInterval(check, 10 * 60_000)
    })
    .catch(() => {})
  return () => {
    disposed = true
    if (timer) clearInterval(timer)
    service.removeEventListener("controllerchange", reload)
    window.removeEventListener("online", check)
    document.removeEventListener("visibilitychange", visible)
    registration?.removeEventListener("updatefound", observe)
    for (const worker of watched) worker.removeEventListener("statechange", show)
  }
}
