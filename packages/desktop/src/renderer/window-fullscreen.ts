import { api } from "./api"
import { createSignal } from "solid-js"

const [windowFullscreen, setWindowFullscreen] = createSignal(false)

api.onWindowFullscreenChanged(setWindowFullscreen)
void api.getWindowFullscreen().then(setWindowFullscreen)

export { windowFullscreen }
